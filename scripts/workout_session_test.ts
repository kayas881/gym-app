import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLocalSet,
  deleteWorkoutSet,
  fetchTodaySessionSets,
  getPendingSets,
  isUniqueViolation,
  mapRemoteSet,
  groupSetsByExercise,
  mergeSessionSets,
  newClientId,
  parseEnsureSessionResult,
  persistConfirmedSet,
  rememberPendingSet,
  replacePendingSets,
  resetPendingSetsForTests,
  updateWorkoutSet,
} from "../lib/workout-session.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type SessionRow = {
  id: string;
  profile_id: string;
  gym_member_id: string | null;
  started_on: string;
  created_at: string;
};

type SetRow = {
  id: string;
  session_id: string;
  client_id: string;
  exercise: string;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  created_at: string;
};

type Actor = {
  profileId: string;
  gymMemberId: string;
};

type MemoryDb = {
  sessions: SessionRow[];
  sets: SetRow[];
  failNextRpc?: boolean;
  failNextInsert?: boolean;
  today: string;
};

function ownsSession(db: MemoryDb, actor: Actor, sessionId: string): boolean {
  return db.sessions.some(
    (session) => session.id === sessionId && session.profile_id === actor.profileId,
  );
}

function createMemoryClient(db: MemoryDb, actor: Actor): SupabaseClient {
  const visibleSets = () =>
    db.sets.filter((row) => ownsSession(db, actor, row.session_id));

  const from = (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let orderKey: string | null = null;
    let orderAsc = true;
    let action: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;

    const builder: Record<string, unknown> = {};
    const run = async () => {
      if (table === "workout_sessions") {
        let rows = db.sessions.filter((row) => row.profile_id === actor.profileId) as unknown as Record<string, unknown>[];
        rows = rows.filter((row) => filters.every((fn) => fn(row)));
        return { rows, table };
      }
      if (table === "workout_sets") {
        if (action === "insert") {
          if (!payload) return { rows: [], table, error: { message: "missing payload" } };
          if (db.failNextInsert) {
            db.failNextInsert = false;
            return { rows: [], table, error: { message: "network down" } };
          }
          const sessionId = String(payload.session_id);
          if (!ownsSession(db, actor, sessionId)) {
            return { rows: [], table, error: { message: "rls blocked insert" } };
          }
          if (db.sets.some((row) => row.client_id === payload!.client_id)) {
            return { rows: [], table, error: { message: "duplicate", code: "23505" } };
          }
          const row: SetRow = {
            id: `srv-${db.sets.length + 1}`,
            session_id: sessionId,
            client_id: String(payload.client_id),
            exercise: String(payload.exercise),
            weight_kg: (payload.weight_kg as number | null) ?? null,
            reps: (payload.reps as number | null) ?? null,
            rir: (payload.rir as number | null) ?? null,
            created_at: new Date().toISOString(),
          };
          db.sets.push(row);
          return { rows: [row as unknown as Record<string, unknown>], table };
        }
        if (action === "update") {
          const matches = visibleSets().filter((row) =>
            filters.every((fn) => fn(row as unknown as Record<string, unknown>)),
          );
          for (const row of matches) {
            if (payload?.exercise !== undefined) row.exercise = String(payload.exercise);
            if (payload && "weight_kg" in payload) row.weight_kg = (payload.weight_kg as number | null) ?? null;
            if (payload && "reps" in payload) row.reps = (payload.reps as number | null) ?? null;
            if (payload && "rir" in payload) row.rir = (payload.rir as number | null) ?? null;
          }
          return { rows: matches as unknown as Record<string, unknown>[], table };
        }
        if (action === "delete") {
          const keep: SetRow[] = [];
          const removed: SetRow[] = [];
          for (const row of db.sets) {
            const visible = ownsSession(db, actor, row.session_id);
            const matched = filters.every((fn) => fn(row as unknown as Record<string, unknown>));
            if (visible && matched) {
              removed.push(row);
            } else {
              keep.push(row);
            }
          }
          db.sets = keep;
          return { rows: removed as unknown as Record<string, unknown>[], table };
        }
        let rows = visibleSets() as unknown as Record<string, unknown>[];
        rows = rows.filter((row) => filters.every((fn) => fn(row)));
        if (orderKey) {
          const key = orderKey;
          rows.sort((a, b) => {
            const av = String(a[key] ?? "");
            const bv = String(b[key] ?? "");
            return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        return { rows, table };
      }
      return { rows: [], table, error: { message: `unknown table ${table}` } };
    };

    const finish = async (mode: "single" | "maybe" | "many") => {
      const result = await run();
      if ("error" in result && result.error) {
        return { data: null, error: result.error };
      }
      if (mode === "many") {
        return { data: result.rows, error: null };
      }
      if (result.rows.length === 0) {
        return { data: null, error: mode === "single" ? { message: "no rows" } : null };
      }
      return { data: result.rows[0], error: null };
    };

    builder.select = () => builder;
    builder.insert = (value: Record<string, unknown>) => {
      action = "insert";
      payload = value;
      return builder;
    };
    builder.update = (value: Record<string, unknown>) => {
      action = "update";
      payload = value;
      return builder;
    };
    builder.delete = () => {
      action = "delete";
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.order = (column: string, opts?: { ascending?: boolean }) => {
      orderKey = column;
      orderAsc = opts?.ascending !== false;
      return builder;
    };
    builder.maybeSingle = () => finish("maybe");
    builder.single = () => finish("single");
    builder.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) =>
      finish("many").then(resolve, reject);
    return builder;
  };

  return {
    rpc: async (fn: string) => {
      if (fn !== "ensure_today_workout_session") {
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      }
      if (db.failNextRpc) {
        db.failNextRpc = false;
        return { data: null, error: { message: "network down" } };
      }
      let session = db.sessions.find(
        (row) => row.profile_id === actor.profileId && row.started_on === db.today,
      );
      if (!session) {
        session = {
          id: `ses-${actor.profileId}-${db.sessions.length + 1}`,
          profile_id: actor.profileId,
          gym_member_id: actor.gymMemberId,
          started_on: db.today,
          created_at: new Date().toISOString(),
        };
        db.sessions.push(session);
      }
      return {
        data: { ok: true, session_id: session.id, started_on: session.started_on },
        error: null,
      };
    },
    from,
  } as unknown as SupabaseClient;
}

const alice: Actor = { profileId: "profile-alice", gymMemberId: "gm-alice" };
const bob: Actor = { profileId: "profile-bob", gymMemberId: "gm-bob" };

function freshDb(): MemoryDb {
  return { sessions: [], sets: [], today: "2026-11-02" };
}

test("newClientId returns a UUID", () => {
  assert.match(newClientId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("parseEnsureSessionResult reads a successful RPC payload", () => {
  const parsed = parseEnsureSessionResult({
    ok: true,
    session_id: "ses-1",
    started_on: "2026-11-02",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.sessionId, "ses-1");
});

test("parseEnsureSessionResult keeps a not_authenticated failure", () => {
  const parsed = parseEnsureSessionResult({
    ok: false,
    reason: "not_authenticated",
    message: "You need to be signed in to save a set.",
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.retryable, false);
    assert.match(parsed.message, /signed in/);
  }
});

test("isUniqueViolation only matches 23505", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "42501" }), false);
  assert.equal(isUniqueViolation(null), false);
});

test("mergeSessionSets keeps unsynced local rows the server does not have", () => {
  const remote = [
    mapRemoteSet({
      id: "srv-1",
      session_id: "ses-1",
      client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      exercise: "Bench press",
      weight_kg: "40.00",
      reps: 10,
      rir: 2,
      created_at: "2026-11-02T04:00:00.000Z",
    }),
  ];
  const local = [
    buildLocalSet("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      exercise: "Squat",
      weightKg: 80,
      reps: 5,
      rir: null,
    }, "2026-11-02T04:01:00.000Z"),
  ];
  const merged = mergeSessionSets(remote, local);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].exercise, "Squat");
  assert.equal(merged[0].syncStatus, "pending");
  assert.equal(merged[1].exercise, "Bench press");
  assert.equal(merged[1].syncStatus, "synced");
  assert.equal(merged[1].weightKg, 40);
});

test("mergeSessionSets does not duplicate a retried client_id", () => {
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const remote = [
    mapRemoteSet({
      id: "srv-2",
      session_id: "ses-1",
      client_id: id,
      exercise: "Deadlift",
      weight_kg: 100,
      reps: 3,
      rir: 1,
      created_at: "2026-11-02T04:00:00.000Z",
    }),
  ];
  const local = [buildLocalSet(id, { exercise: "Deadlift", weightKg: 100, reps: 3, rir: 1 })];
  const merged = mergeSessionSets(remote, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].syncStatus, "synced");
});

test("session log groups confirmed sets by exercise", () => {
  const bench = buildLocalSet(newClientId(), { exercise: "Bench press", weightKg: 60, reps: 10, rir: 2 });
  const benchTwo = buildLocalSet(newClientId(), { exercise: "bench  press", weightKg: 60, reps: 8, rir: null });
  const row = buildLocalSet(newClientId(), { exercise: "Barbell row", weightKg: 50, reps: 8, rir: 2 });
  const groups = groupSetsByExercise([benchTwo, bench, row]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, "bench press");
  assert.equal(groups[0].sets.length, 2);
  assert.equal(groups[1].name, "Barbell row");
});

test("log a set uses tap-to-record and can discard before transcribe", () => {
  const session = readFileSync(join(ROOT, "app/(member)/session.tsx"), "utf8");
  const hook = readFileSync(join(ROOT, "hooks/usePushToTalkWorkout.ts"), "utf8");
  assert.match(session, /Tap the mic to start/);
  assert.match(session, /Discard/);
  assert.match(session, /groupSetsByExercise/);
  assert.match(hook, /cancelRecording/);
  assert.equal(/Hold the mic/.test(hook), false);
});

test("pending cache drops a set once it is synced", () => {
  resetPendingSetsForTests();
  const set = buildLocalSet(newClientId(), {
    exercise: "Row",
    weightKg: 30,
    reps: 12,
    rir: 3,
  });
  rememberPendingSet("profile-alice", "2026-11-02", set);
  assert.equal(getPendingSets("profile-alice", "2026-11-02").length, 1);
  replacePendingSets("profile-alice", "2026-11-02", [{ ...set, syncStatus: "synced" }]);
  assert.equal(getPendingSets("profile-alice", "2026-11-02").length, 0);
});

test("persistConfirmedSet saves, retrieves, edits and deletes a set", async () => {
  resetPendingSetsForTests();
  const db = freshDb();
  const client = createMemoryClient(db, alice);
  const clientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const saved = await persistConfirmedSet(client, {
    clientId,
    exercise: "Lat pulldown",
    weightKg: 43,
    reps: 8,
    rir: null,
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.ok(saved.sessionId);
  assert.ok(saved.serverId);

  const loaded = await fetchTodaySessionSets(client, db.today);
  assert.equal(loaded.sets.length, 1);
  assert.equal(loaded.sets[0].exercise, "Lat pulldown");
  assert.equal(loaded.sets[0].rir, null);
  assert.equal(loaded.sets[0].id, clientId);

  const updated = await updateWorkoutSet(client, clientId, {
    exercise: "Lat pulldown",
    weightKg: 45,
    reps: 8,
    rir: 2,
  });
  assert.equal(updated.ok, true);
  const afterUpdate = await fetchTodaySessionSets(client, db.today);
  assert.equal(afterUpdate.sets[0].weightKg, 45);
  assert.equal(afterUpdate.sets[0].rir, 2);

  const deleted = await deleteWorkoutSet(client, clientId);
  assert.equal(deleted.ok, true);
  if (deleted.ok) assert.equal(deleted.deleted, true);
  const afterDelete = await fetchTodaySessionSets(client, db.today);
  assert.equal(afterDelete.sets.length, 0);
});

test("retrying the same client_id does not insert a second row", async () => {
  const db = freshDb();
  const client = createMemoryClient(db, alice);
  const clientId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const first = await persistConfirmedSet(client, {
    clientId,
    exercise: "Press",
    weightKg: 20,
    reps: 10,
    rir: 1,
  });
  const second = await persistConfirmedSet(client, {
    clientId,
    exercise: "Press",
    weightKg: 20,
    reps: 10,
    rir: 1,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(db.sets.length, 1);
});

test("a failed network write leaves no server row for the caller to lose locally", async () => {
  const db = freshDb();
  db.failNextRpc = true;
  const client = createMemoryClient(db, alice);
  const local = buildLocalSet(newClientId(), {
    exercise: "Curl",
    weightKg: 12,
    reps: 10,
    rir: null,
  });
  const result = await persistConfirmedSet(client, {
    clientId: local.id,
    exercise: local.exercise,
    weightKg: local.weightKg,
    reps: local.reps,
    rir: local.rir,
  });
  assert.equal(result.ok, false);
  assert.equal(db.sets.length, 0);
  assert.equal(local.exercise, "Curl");
});

test("members cannot read, edit or delete each other's sets", async () => {
  const db = freshDb();
  const aliceClient = createMemoryClient(db, alice);
  const bobClient = createMemoryClient(db, bob);
  const aliceSetId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  const saved = await persistConfirmedSet(aliceClient, {
    clientId: aliceSetId,
    exercise: "Alice only",
    weightKg: 50,
    reps: 5,
    rir: 0,
  });
  assert.equal(saved.ok, true);

  const bobView = await fetchTodaySessionSets(bobClient, db.today);
  assert.equal(bobView.sets.length, 0);
  assert.equal(bobView.sessionId, null);

  const bobEdit = await updateWorkoutSet(bobClient, aliceSetId, {
    exercise: "Hijacked",
    weightKg: 1,
    reps: 1,
    rir: 1,
  });
  assert.equal(bobEdit.ok, false);

  const bobDelete = await deleteWorkoutSet(bobClient, aliceSetId);
  assert.equal(bobDelete.ok, true);
  if (bobDelete.ok) assert.equal(bobDelete.deleted, false);

  const aliceView = await fetchTodaySessionSets(aliceClient, db.today);
  assert.equal(aliceView.sets.length, 1);
  assert.equal(aliceView.sets[0].exercise, "Alice only");
});

test("discard path never writes: cancelDraft does not call persist helpers", () => {
  const hook = readFileSync(join(ROOT, "hooks/usePushToTalkWorkout.ts"), "utf8");
  const cancel = hook.slice(hook.indexOf("const cancelDraft"), hook.indexOf("const applySet"));
  assert.equal(cancel.includes("persistConfirmedSet"), false);
  assert.equal(cancel.includes("from('workout_"), false);
  assert.equal(cancel.includes("ensure_today_workout_session"), false);
});

test("migration 039 uses Clerk helpers and never auth.uid()", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/039_workout_sessions.sql"), "utf8");
  const uncommented = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.workout_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.workout_sets/);
  assert.match(sql, /get_current_profile_id\(\)/);
  assert.equal(/\bauth\.uid\(\)/.test(uncommented), false);
  assert.match(sql, /rir\s+INT/);
  assert.match(sql, /UNIQUE \(client_id\)/);
  assert.match(sql, /Asia\/Kolkata/);
});
