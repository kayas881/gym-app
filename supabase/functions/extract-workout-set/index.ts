import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleExtractWorkoutSet } from "./handler.ts";

/**
 * Extract one proposed workout set from a transcript.
 *
 * Gateway JWT verification is off (see supabase/config.toml). Clerk session
 * tokens are not Supabase JWTs, so the platform check would reject every
 * real Gymnos client. The handler verifies the Clerk session itself.
 *
 * This function does not write to the database.
 */
Deno.serve((req: Request) =>
  handleExtractWorkoutSet(req, {
    env: (name) => Deno.env.get(name),
    fetch,
  })
);
