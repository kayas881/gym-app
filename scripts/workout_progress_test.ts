import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HistorySession,
  type HistorySet,
  compareMetric,
  computeAllExerciseProgress,
  computeExerciseProgress,
  computeExerciseRecords,
  computeOverallStats,
  epley1RM,
  exerciseKey,
  exerciseRecordBanner,
  formatVolume,
  recordIsFromSession,
  setVolume,
} from "../lib/workout-progress.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function set(partial: Partial<HistorySet> & Pick<HistorySet, "clientId" | "exercise">): HistorySet {
  return {
    sessionId: partial.sessionId ?? "ses-1",
    startedOn: partial.startedOn ?? "2026-10-01",
    weightKg: partial.weightKg ?? null,
    reps: partial.reps ?? null,
    rir: partial.rir ?? null,
    createdAt: partial.createdAt ?? `${partial.startedOn ?? "2026-10-01"}T08:00:00.000Z`,
    ...partial,
  };
}

function session(
  id: string,
  startedOn: string,
  sets: HistorySet[],
): HistorySession {
  return {
    id,
    startedOn,
    createdAt: `${startedOn}T07:00:00.000Z`,
    sets: sets.map((row) => ({ ...row, sessionId: id, startedOn })),
  };
}

test("epley1RM is weight * (1 + reps / 30)", () => {
  assert.equal(epley1RM(100, 1), 100 * (1 + 1 / 30));
  assert.equal(epley1RM(60, 6), 60 * (1 + 6 / 30));
  assert.equal(epley1RM(40, 0), null);
  assert.equal(setVolume(40, 8), 320);
  assert.equal(setVolume(null, 8), null);
  assert.equal(setVolume(40, null), null);
});

test("exercise variations stay separate after whitespace fold", () => {
  assert.equal(exerciseKey("Bench  press"), "bench press");
  assert.equal(exerciseKey("Incline bench press"), "incline bench press");
  const sessions = [
    session("a", "2026-10-01", [
      set({ clientId: "1", exercise: "Bench press", weightKg: 40, reps: 8 }),
    ]),
    session("b", "2026-10-08", [
      set({ clientId: "2", exercise: "Incline bench press", weightKg: 80, reps: 5 }),
    ]),
  ];
  const all = computeAllExerciseProgress(sessions);
  assert.equal(all.length, 2);
  const bench = computeExerciseProgress(sessions, "bench press");
  assert.equal(bench?.records.heaviestSet?.value, 40);
  const incline = computeExerciseProgress(sessions, "incline bench press");
  assert.equal(incline?.records.heaviestSet?.value, 80);
});

test("historical records pick the first time a mark was hit", () => {
  const sets = [
    set({ clientId: "early", exercise: "Squat", weightKg: 80, reps: 8, startedOn: "2026-09-01", createdAt: "2026-09-01T08:00:00.000Z", sessionId: "s1" }),
    set({ clientId: "later", exercise: "Squat", weightKg: 80, reps: 8, startedOn: "2026-10-01", createdAt: "2026-10-01T08:00:00.000Z", sessionId: "s2" }),
    set({ clientId: "heavier", exercise: "Squat", weightKg: 90, reps: 3, startedOn: "2026-10-15", createdAt: "2026-10-15T08:00:00.000Z", sessionId: "s3" }),
    set({ clientId: "reps", exercise: "Squat", weightKg: 40, reps: 12, startedOn: "2026-09-10", createdAt: "2026-09-10T08:00:00.000Z", sessionId: "s4" }),
  ];
  const records = computeExerciseRecords(sets);
  assert.equal(records.heaviestSet?.value, 90);
  assert.equal(records.heaviestSet?.clientId, "heavier");
  assert.equal(records.heaviestSet?.startedOn, "2026-10-15");
  assert.equal(records.mostReps?.value, 12);
  assert.equal(records.mostReps?.startedOn, "2026-09-10");
  // 80×8 e1RM beats 90×3, and the first 80×8 keeps the date.
  assert.equal(records.bestE1rm?.value, epley1RM(80, 8));
  assert.equal(records.bestE1rm?.clientId, "early");
});

test("new personal record is the mark from the latest session", () => {
  const sessions = [
    session("old", "2026-10-01", [
      set({ clientId: "a", exercise: "Deadlift", weightKg: 100, reps: 3 }),
    ]),
    session("new", "2026-10-20", [
      set({ clientId: "b", exercise: "Deadlift", weightKg: 120, reps: 2 }),
    ]),
  ];
  const progress = computeExerciseProgress(sessions, "deadlift");
  assert.ok(progress);
  assert.equal(progress.records.heaviestSet?.value, 120);
  assert.equal(recordIsFromSession(progress.records.heaviestSet, progress.latest?.sessionId ?? null), true);
  assert.equal(exerciseRecordBanner(progress), "new_pr");
});

test("first exercise session is a baseline, not a broken record", () => {
  const sessions = [
    session("only", "2026-10-01", [
      set({ clientId: "a", exercise: "Deadlift", weightKg: 100, reps: 3 }),
    ]),
  ];
  const progress = computeExerciseProgress(sessions, "deadlift");
  assert.ok(progress);
  assert.equal(exerciseRecordBanner(progress), "baseline");
});

test("editing a historical set recalculates records", () => {
  const original = [
    set({ clientId: "keep", exercise: "Row", weightKg: 50, reps: 8, sessionId: "s1", startedOn: "2026-10-01" }),
    set({ clientId: "edit", exercise: "Row", weightKg: 70, reps: 6, sessionId: "s2", startedOn: "2026-10-08" }),
  ];
  assert.equal(computeExerciseRecords(original).heaviestSet?.value, 70);

  const edited = original.map((row) =>
    row.clientId === "edit" ? { ...row, weightKg: 45, reps: 10 } : row,
  );
  const afterEdit = computeExerciseRecords(edited);
  assert.equal(afterEdit.heaviestSet?.value, 50);
  assert.equal(afterEdit.mostReps?.value, 10);
  assert.equal(afterEdit.heaviestSet?.clientId, "keep");
});

test("deleting the record set hands the mark to the remaining history", () => {
  const original = [
    set({ clientId: "first", exercise: "Curl", weightKg: 12, reps: 10, sessionId: "s1", startedOn: "2026-10-01" }),
    set({ clientId: "pr", exercise: "Curl", weightKg: 16, reps: 8, sessionId: "s2", startedOn: "2026-10-08" }),
  ];
  assert.equal(computeExerciseRecords(original).heaviestSet?.clientId, "pr");
  const remaining = original.filter((row) => row.clientId !== "pr");
  assert.equal(computeExerciseRecords(remaining).heaviestSet?.clientId, "first");
  assert.equal(computeExerciseRecords(remaining).heaviestSet?.value, 12);
});

test("progress compares the last two sessions of the same exercise", () => {
  const sessions = [
    session("one", "2026-10-01", [
      set({ clientId: "1", exercise: "Press", weightKg: 20, reps: 8 }),
    ]),
    session("two", "2026-10-08", [
      set({ clientId: "2", exercise: "Press", weightKg: 22.5, reps: 8 }),
    ]),
  ];
  const progress = computeExerciseProgress(sessions, "press");
  assert.ok(progress);
  assert.equal(progress.latest?.topWeightKg, 22.5);
  assert.equal(progress.previous?.topWeightKg, 20);
  assert.equal(progress.weightTrend, "improved");
  assert.equal(progress.e1rmTrend, "improved");
  assert.equal(progress.volumeTrend, "improved");
  assert.equal(progress.overallTrend, "improved");
});

test("a lighter session is a decline, not mixed with another exercise", () => {
  const sessions = [
    session("one", "2026-10-01", [
      set({ clientId: "1", exercise: "Press", weightKg: 30, reps: 5 }),
      set({ clientId: "x", exercise: "Fly", weightKg: 10, reps: 12 }),
    ]),
    session("two", "2026-10-08", [
      set({ clientId: "2", exercise: "Press", weightKg: 25, reps: 5 }),
    ]),
  ];
  const press = computeExerciseProgress(sessions, "press");
  assert.equal(press?.weightTrend, "declined");
  assert.equal(press?.overallTrend, "declined");
  const fly = computeExerciseProgress(sessions, "fly");
  assert.equal(fly?.overallTrend, "insufficient");
  assert.equal(fly?.latest?.topWeightKg, 10);
});

test("missing RIR and missing load never become fabricated records", () => {
  const sets = [
    set({ clientId: "body", exercise: "Pull-up", weightKg: null, reps: 8, rir: null }),
    set({ clientId: "hold", exercise: "Pull-up", weightKg: 20, reps: null, rir: 2 }),
  ];
  const records = computeExerciseRecords(sets);
  assert.equal(records.heaviestSet?.value, 20);
  assert.equal(records.mostReps?.value, 8);
  assert.equal(records.bestE1rm, null);
  assert.equal(records.highestSessionVolume, null);
  assert.equal(computeOverallStats([session("s", "2026-10-01", sets)]).totalVolume, null);
});

test("highest session volume sums only complete sets", () => {
  const sessions = [
    session("light", "2026-10-01", [
      set({ clientId: "1", exercise: "Bench press", weightKg: 40, reps: 8 }),
      set({ clientId: "2", exercise: "Bench press", weightKg: 40, reps: 8 }),
    ]),
    session("heavy", "2026-10-08", [
      set({ clientId: "3", exercise: "Bench press", weightKg: 50, reps: 5 }),
      set({ clientId: "4", exercise: "Bench press", weightKg: null, reps: 5 }),
    ]),
  ];
  const records = computeExerciseProgress(sessions, "bench press")?.records;
  assert.equal(records?.highestSessionVolume?.value, 640);
  assert.equal(records?.highestSessionVolume?.sessionId, "light");
  assert.equal(records?.heaviestSet?.value, 50);
});

test("two members' sets stay isolated when computed separately", () => {
  const alice = [
    session("a1", "2026-10-01", [
      set({ clientId: "alice-1", exercise: "Squat", weightKg: 60, reps: 5 }),
    ]),
  ];
  const bob = [
    session("b1", "2026-10-01", [
      set({ clientId: "bob-1", exercise: "Squat", weightKg: 140, reps: 3 }),
    ]),
  ];
  assert.equal(computeExerciseProgress(alice, "squat")?.records.heaviestSet?.value, 60);
  assert.equal(computeExerciseProgress(bob, "squat")?.records.heaviestSet?.value, 140);
  assert.equal(
    computeExerciseProgress(alice, "squat")?.records.heaviestSet?.clientId.includes("bob"),
    false,
  );
});

test("empty history is zeros and empty lists", () => {
  assert.deepEqual(computeOverallStats([]), {
    sessionCount: 0,
    setCount: 0,
    exerciseCount: 0,
    totalVolume: null,
    lastWorkoutOn: null,
  });
  assert.deepEqual(computeAllExerciseProgress([]), []);
  assert.equal(computeExerciseProgress([], "bench press"), null);
  assert.equal(compareMetric(null, 10, 0.05), "insufficient");
  assert.equal(compareMetric(10, 10, 0.05), "unchanged");
});

test("progress screens are linked from the member tabs and home", () => {
  const layout = readFileSync(join(ROOT, "app/(member)/_layout.tsx"), "utf8");
  const home = readFileSync(join(ROOT, "app/(member)/home.tsx"), "utf8");
  assert.match(layout, /progress\/index/);
  assert.match(layout, /progress\/\[exerciseKey\]/);
  assert.match(home, /\/\(member\)\/progress/);
});

test("volume labels use kg·reps on progress and session screens", () => {
  const progress = readFileSync(join(ROOT, "app/(member)/progress/index.tsx"), "utf8");
  const detail = readFileSync(join(ROOT, "app/(member)/progress/[exerciseKey].tsx"), "utf8");
  const session = readFileSync(join(ROOT, "app/(member)/sessions/[sessionId].tsx"), "utf8");
  const card = readFileSync(join(ROOT, "components/SessionSummaryCard.tsx"), "utf8");
  assert.match(progress, /formatVolume/);
  assert.match(detail, /kg·reps/);
  assert.match(session, /formatVolume/);
  assert.match(card, /formatVolume/);
  assert.equal(formatVolume(400), "400 kg·reps");
});

test("voice logging hook does not import progress math", () => {
  const hook = readFileSync(join(ROOT, "hooks/usePushToTalkWorkout.ts"), "utf8");
  assert.equal(hook.includes("workout-progress"), false);
});
