import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleTranscribeWorkoutAudio } from "./handler.ts";

/**
 * Transcribe one PTT clip for workout logging.
 *
 * Gateway JWT verification is off (see supabase/config.toml). Clerk session
 * tokens are verified inside the handler. MODEL_API_KEY never leaves this
 * function. This function does not write to the database.
 */
Deno.serve((req: Request) =>
  handleTranscribeWorkoutAudio(req, {
    env: (name) => Deno.env.get(name),
    fetch,
  })
);
