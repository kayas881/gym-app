import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Sends push notifications for a newly created announcement.
 *
 * Recipients come from the `announcement_recipients` SQL function, so push
 * targeting is identical to what the in-app feed shows — the audience rules
 * live in exactly one place server-side.
 *
 * AUTH NOTE: verify_jwt is disabled because this app authenticates with Clerk,
 * whose tokens are not Supabase JWTs and would fail the gateway check. Access
 * is instead bounded by two conditions enforced below:
 *   1. `notified_at` must be null — each announcement can only ever notify once
 *   2. the announcement must be recent — a stale id cannot be replayed later
 * So the worst an unauthenticated caller can do is deliver a notification that
 * the app itself was about to send anyway. Tightening this further means a
 * pg_net trigger with a Vault-held secret, which is the natural next step.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts at most 100 messages per request.
const BATCH_SIZE = 100;
const MAX_ANNOUNCEMENT_AGE_MS = 10 * 60 * 1000;

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const { announcement_id } = await req.json().catch(() => ({}));
    if (!announcement_id) {
      return json({ error: "announcement_id is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: announcement, error: annError } = await supabase
      .from("announcements")
      .select("id, title, body, gym_id, created_at, notified_at")
      .eq("id", announcement_id)
      .maybeSingle();

    if (annError) return json({ error: annError.message }, 500);
    if (!announcement) return json({ error: "not found" }, 404);

    // Idempotency: never notify twice for the same announcement.
    if (announcement.notified_at) {
      return json({ skipped: "already notified" });
    }

    // Replay guard: only freshly created announcements may trigger a send.
    const age = Date.now() - new Date(announcement.created_at).getTime();
    if (age > MAX_ANNOUNCEMENT_AGE_MS) {
      return json({ skipped: "announcement too old to notify" });
    }

    // Claim it BEFORE sending. Two concurrent invocations would otherwise both
    // pass the check above and double-notify; whoever updates first wins.
    const { data: claimed, error: claimError } = await supabase
      .from("announcements")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", announcement_id)
      .is("notified_at", null)
      .select("id");

    if (claimError) return json({ error: claimError.message }, 500);
    if (!claimed || claimed.length === 0) {
      return json({ skipped: "claimed by a concurrent invocation" });
    }

    const { data: recipients, error: recError } = await supabase
      .rpc("announcement_recipients", { p_announcement_id: announcement_id });

    if (recError) return json({ error: recError.message }, 500);

    const profileIds = (recipients ?? []).map((r: { profile_id: string }) => r.profile_id);
    if (profileIds.length === 0) {
      return json({ sent: 0, reason: "no recipients for this audience" });
    }

    const { data: tokenRows, error: tokError } = await supabase
      .from("push_tokens")
      .select("token")
      .in("profile_id", profileIds);

    if (tokError) return json({ error: tokError.message }, 500);

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token);
    if (tokens.length === 0) {
      return json({ sent: 0, recipients: profileIds.length, reason: "no registered devices" });
    }

    const messages = tokens.map((to) => ({
      to,
      sound: "default",
      title: announcement.title,
      body: announcement.body,
      data: { type: "announcement", announcement_id, gym_id: announcement.gym_id },
      channelId: "default",
    }));

    const deadTokens: string[] = [];
    let sent = 0;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        console.error("[notify-announcement] Expo push failed:", await res.text());
        continue;
      }

      const payload = await res.json();
      const tickets: ExpoTicket[] = payload?.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent += 1;
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          // The app was uninstalled or the token rotated — stop sending to it.
          deadTokens.push(batch[idx].to);
        } else {
          console.warn("[notify-announcement] ticket error:", ticket.message);
        }
      });
    }

    if (deadTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", deadTokens);
    }

    return json({
      sent,
      recipients: profileIds.length,
      devices: tokens.length,
      pruned: deadTokens.length,
    });
  } catch (err) {
    console.error("[notify-announcement]", err);
    return json({ error: String(err) }, 500);
  }
});
