// App-wide configuration constants
// IMPORTANT: In production, use environment variables via expo-constants

export const SUPABASE_URL = 'https://fqgvmxksmkfikjuzsiqe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Wq94YDuGWFOZ8YRiibgQ6Q_LTGcFZH_';

// Clerk publishable key - set this from your Clerk dashboard
export const CLERK_PUBLISHABLE_KEY = 'pk_test_aG9wZWZ1bC1sZW11ci00NTEwLmNsZXJrLmFjY291bnRzLmRldiQ';

// Time slot boundaries (24h format)
export const TIME_SLOTS = {
  morning: { start: 5, end: 11 },    // 5:00 AM - 10:59 AM
  afternoon: { start: 11, end: 16 },  // 11:00 AM - 3:59 PM
  evening: { start: 16, end: 21 },    // 4:00 PM - 8:59 PM
} as const;

export type TimeSlot = keyof typeof TIME_SLOTS;

// Receipt number prefix
export const RECEIPT_PREFIX = 'GYM';
