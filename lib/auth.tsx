import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/expo';
import { SupabaseClient } from '@supabase/supabase-js';
import { createClerkSupabaseClient } from './supabase';
import { registerPushToken, unregisterPushToken } from './notifications';

// Types
export type UserRole = 'owner' | 'staff' | 'member' | null;

export interface Profile {
  id: string;
  clerk_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  photo_url: string | null;
  date_of_birth: string | null;
  gender: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  health_notes: string | null;
  fitness_goal: string | null;
  preferred_gym_timing: string | null;
}

export interface GymMembership {
  id: string;
  gym_id: string;
  role: UserRole;
  status: 'pending' | 'active' | 'expired' | 'rejected';
  // Needed for time-slot announcement targeting. preferred_time_slot is the
  // member's explicit choice; auto_time_slot is detected from check-in history
  // by the trigger in migration 005.
  preferred_time_slot: 'morning' | 'afternoon' | 'evening' | null;
  auto_time_slot: 'morning' | 'afternoon' | 'evening' | null;
  gym: {
    id: string;
    name: string;
    logo_url: string | null;
  };
}

interface AuthContextValue {
  // Auth state
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;

  // Profile state
  profile: Profile | null;
  isProfileComplete: boolean;
  profileLoading: boolean;

  // Gym membership state
  currentMembership: GymMembership | null;
  role: UserRole;
  gymId: string | null;
  membershipLoading: boolean;

  // Supabase client (authenticated)
  supabase: SupabaseClient;

  // Actions
  refreshProfile: () => Promise<void>;
  refreshMembership: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut: clerkSignOut } = useClerkAuth();
  const { user } = useUser();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentMembership, setCurrentMembership] = useState<GymMembership | null>(null);

  // Which identity each fetch has actually completed for. The loading flags are
  // derived from these rather than set imperatively: a plain boolean could still
  // read `false` from a previous session in the window between signing in and
  // the fetch starting, which let index.tsx redirect to setup-gym before the
  // membership query had run at all.
  const [profileFetchedFor, setProfileFetchedFor] = useState<string | null>(null);
  const [membershipFetchedFor, setMembershipFetchedFor] = useState<string | null>(null);

  // Clerk hands back a new `getToken` identity on some renders. Reading it
  // through a ref keeps the Supabase client referentially stable, so
  // refreshProfile/refreshMembership (and the effects that depend on them)
  // don't get recreated every render — that caused an infinite update loop.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  // Create Supabase client with Clerk session token
  const supabase = useMemo(() => {
    // Use the native Clerk session token — no JWT template needed
    return createClerkSupabaseClient(() => getTokenRef.current());
  }, []);

  // Authorise the Realtime WebSocket separately from HTTP.
  //
  // createClerkSupabaseClient injects the Clerk token through `global.fetch`,
  // which only covers REST calls — the Realtime socket never goes through it.
  // Without setAuth the socket connects with just the anon key, and RLS on
  // staff_chat_messages / announcements silently drops every row, so
  // subscriptions appear connected but deliver nothing.
  //
  // Clerk session tokens are short-lived (~60s), so this refreshes on a timer;
  // a stale socket token stops delivering events the same way a missing one does.
  useEffect(() => {
    if (!isSignedIn) return;

    let cancelled = false;
    const syncRealtimeAuth = async () => {
      try {
        const token = await getTokenRef.current();
        if (!cancelled && token) {
          supabase.realtime.setAuth(token);
        }
      } catch (err) {
        console.warn('[Auth] Could not set realtime auth:', err);
      }
    };

    syncRealtimeAuth();
    const interval = setInterval(syncRealtimeAuth, 45_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSignedIn, supabase]);

  // Check if profile has required fields filled.
  // `phone` is the marker that the user actually went through the
  // complete-profile screen — full_name and email are populated automatically
  // from Clerk when the row is first created, so they can't gate on their own.
  const isProfileComplete = useMemo(() => {
    if (!profile) return false;
    return !!(profile.full_name && profile.email && profile.phone);
  }, [profile]);

  // Still loading until the fetch has completed for THIS signed-in user /
  // profile. Deriving it this way means a newly signed-in user is never briefly
  // reported as "loaded with no membership".
  const profileLoading = !!(isSignedIn && userId) && profileFetchedFor !== userId;
  const membershipLoading = !!profile?.id && membershipFetchedFor !== profile.id;

  // Current role from membership
  const role = currentMembership?.role ?? null;
  const gymId = currentMembership?.gym_id ?? null;

  // Derive plain strings from the Clerk user so this callback doesn't depend on
  // the `user` object's identity, which changes on every render.
  const clerkEmail = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const clerkFullName =
    (user?.unsafeMetadata?.fullName as string | undefined) ??
    user?.fullName ??
    user?.firstName ??
    '';

  // Fetch profile from Supabase
  const refreshProfile = useCallback(async () => {
    if (!isSignedIn || !userId) {
      setProfile(null);
      setProfileFetchedFor(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Error fetching profile:', error);
        return;
      }

      if (data) {
        setProfile(data);
        return;
      }

      // Profile doesn't exist yet — user just signed up via Clerk.
      // Create a basic profile from Clerk user data.
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          clerk_id: userId,
          email: clerkEmail,
          full_name: clerkFullName || 'New User',
        })
        .select()
        .single();

      if (!insertError) {
        setProfile(newProfile);
        return;
      }

      // A concurrent call already created the row — read it back instead of
      // reporting the unique-constraint violation as a failure.
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('profiles')
          .select('*')
          .eq('clerk_id', userId)
          .maybeSingle();

        if (existing) {
          setProfile(existing);
          return;
        }
      }

      console.error('[Auth] Error creating profile:', insertError);
    } catch (err) {
      console.error('[Auth] Unexpected error in refreshProfile:', err);
    } finally {
      // Mark resolved even on failure, so a hard error doesn't leave the app
      // spinning on the loading screen forever.
      setProfileFetchedFor(userId);
    }
  }, [isSignedIn, userId, supabase, clerkEmail, clerkFullName]);

  // Fetch gym membership from Supabase
  const refreshMembership = useCallback(async () => {
    const profileId = profile?.id;
    if (!profileId) {
      setCurrentMembership(null);
      setMembershipFetchedFor(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('gym_members')
        .select(`
          id,
          gym_id,
          role,
          status,
          preferred_time_slot,
          auto_time_slot,
          gym:gyms (
            id,
            name,
            logo_url
          )
        `)
        .eq('profile_id', profile.id)
        .in('status', ['active', 'pending'])
        .order('joined_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Error fetching membership:', error);
      } else {
        // `data` is null when the user has no membership yet.
        setCurrentMembership((data as unknown as GymMembership) ?? null);
      }
    } catch (err) {
      console.error('[Auth] Unexpected error in refreshMembership:', err);
    } finally {
      setMembershipFetchedFor(profileId);
    }
  }, [profile?.id, supabase]);

  // Sign out.
  // Deliberately does NOT clear profile/membership up front. Clearing them
  // while Clerk still reports isSignedIn === true makes isProfileComplete flip
  // to false for a frame, and index.tsx reads that as "signed in, profile
  // incomplete" and flashes the complete-profile screen on the way out. The
  // effect below already clears everything once isSignedIn goes false, and
  // index.tsx checks !isSignedIn before it looks at the profile.
  const handleSignOut = useCallback(async () => {
    // Remove this device's push token first — after signOut the Supabase
    // client no longer has a token, so the delete would fail RLS.
    await unregisterPushToken(supabase);
    await clerkSignOut();
  }, [clerkSignOut, supabase]);

  // Fetch profile when auth state changes
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      refreshProfile();
    } else if (isLoaded && !isSignedIn) {
      setProfile(null);
      setCurrentMembership(null);
      setProfileFetchedFor(null);
      setMembershipFetchedFor(null);
    }
  }, [isLoaded, isSignedIn, refreshProfile]);

  // Register this device for push once we know which profile it belongs to.
  // Deliberately fire-and-forget: registerPushToken swallows the normal
  // failure cases (emulator, Expo Go, permission declined) and returns null,
  // and nothing in the app should block on notifications being available.
  useEffect(() => {
    if (!profile?.id) return;
    registerPushToken(supabase, profile.id);
  }, [profile?.id, supabase]);

  // Fetch membership when profile is loaded
  useEffect(() => {
    if (profile?.id) {
      refreshMembership();
    }
  }, [profile?.id, refreshMembership]);

  const value: AuthContextValue = {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    userId: userId ?? null,
    profile,
    isProfileComplete,
    profileLoading,
    currentMembership,
    role,
    gymId,
    membershipLoading,
    supabase,
    refreshProfile,
    refreshMembership,
    signOut: handleSignOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAppAuth must be used within an AuthProvider');
  }
  return context;
}
