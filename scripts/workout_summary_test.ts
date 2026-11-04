import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HistorySession,
  type HistorySet,
  classifyExercise,
  computeAllSessionSummaries,
  computeExerciseProgress,
  computeSessionSummary,
  computeWeeklyInsights,
  exerciseRecordBanner,
  exerciseRecordBannerLabel,
  formatVolume,
  historyFromSyncedSets,
  mergeTodayIntoHistory,
  weekMonday,
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

function session(id: string, startedOn: string, sets: HistorySet[]): HistorySession {
  return {
    id,
    startedOn,
    createdAt: `${startedOn}T07:00:00.000Z`,
    sets: sets.map((row) => ({ ...row, sessionId: id, startedOn })),
  };
}

test("empty session has no summary", () => {
  const empty = session("s0", "2026-10-01", []);
  assert.equal(computeSessionSummary(empty, [empty]), null);
  assert.deepEqual(computeAllSessionSummaries([]), []);
});

test("summary totals only complete volume and lists each exercise", () => {
  const day = session("s1", "2026-10-08", [
    set({ clientId: "1", exercise: "Bench press", weightKg: 40, reps: 8 }),
    set({ clientId: "2", exercise: "Bench press", weightKg: 40, reps: 8 }),
    set({ clientId: "3", exercise: "Row", weightKg: 30, reps: 10 }),
    set({ clientId: "4", exercise: "Pull-up", weightKg: null, reps: 6 }),
  ]);
  const summary = computeSessionSummary(day, [day]);
  assert.ok(summary);
  assert.equal(summary.setCount, 4);
  assert.equal(summary.exerciseCount, 3);
  assert.equal(summary.volume, 40 * 8 + 40 * 8 + 30 * 10);
  assert.equal(summary.previous, null);
  assert.equal(summary.volumeTrend, "insufficient");
  assert.equal(summary.exercises.find((row) => row.key === "bench press")?.setCount, 2);
  assert.match(summary.facts[0], /4 sets across 3 exercises/);
});

test("compares volume with the previous session of this member", () => {
  const first = session("s1", "2026-10-01", [
    set({ clientId: "a", exercise: "Squat", weightKg: 60, reps: 5 }),
  ]);
  const second = session("s2", "2026-10-08", [
    set({ clientId: "b", exercise: "Squat", weightKg: 70, reps: 5 }),
  ]);
  const all = [first, second];
  const summary = computeSessionSummary(second, all);
  assert.ok(summary);
  assert.equal(summary.previous?.sessionId, "s1");
  assert.equal(summary.volumeTrend, "improved");
  assert.ok(summary.facts.some((fact) => fact.includes("Volume up from 300 kg·reps")));
});

test("first session establishes baselines and does not count PRs", () => {
  const first = session("s1", "2026-10-01", [
    set({ clientId: "a", exercise: "Deadlift", weightKg: 100, reps: 3 }),
  ]);
  const summary = computeSessionSummary(first, [first]);
  assert.ok(summary);
  assert.equal(summary.prs.length, 0);
  assert.ok(summary.baselines.length >= 1);
  assert.ok(summary.baselines.some((mark) => mark.kind === "heaviest" && mark.value === 100));
  assert.equal(exerciseRecordBanner(computeExerciseProgress([first], "deadlift")!), "baseline");
  assert.equal(exerciseRecordBannerLabel("baseline"), "Baseline established");
});

test("second session with a heavier set counts as a broken PR", () => {
  const first = session("s1", "2026-10-01", [
    set({ clientId: "a", exercise: "Deadlift", weightKg: 100, reps: 3 }),
  ]);
  const second = session("s2", "2026-10-08", [
    set({ clientId: "b", exercise: "Deadlift", weightKg: 120, reps: 2 }),
  ]);
  const summary = computeSessionSummary(second, [first, second]);
  assert.ok(summary);
  assert.ok(summary.prs.some((pr) => pr.kind === "heaviest" && pr.value === 120));
  assert.equal(summary.baselines.some((mark) => mark.kind === "heaviest"), false);
  assert.ok(summary.facts.some((fact) => fact.includes("New heaviest set: Deadlift")));
  assert.equal(exerciseRecordBanner(computeExerciseProgress([first, second], "deadlift")!), "new_pr");
});

test("second session without improvement is not a PR", () => {
  const first = session("s1", "2026-10-01", [
    set({ clientId: "a", exercise: "Deadlift", weightKg: 100, reps: 5 }),
  ]);
  const second = session("s2", "2026-10-08", [
    set({ clientId: "b", exercise: "Deadlift", weightKg: 90, reps: 5 }),
  ]);
  const summary = computeSessionSummary(second, [first, second]);
  assert.ok(summary);
  assert.equal(summary.prs.length, 0);
  assert.equal(exerciseRecordBanner(computeExerciseProgress([first, second], "deadlift")!), "no_pr");
  assert.equal(exerciseRecordBannerLabel("no_pr"), "No new records this session");
});

test("formatVolume uses kg·reps and leaves heaviest in kg", () => {
  assert.equal(formatVolume(400), "400 kg·reps");
  const first = session("s1", "2026-10-01", [
    set({ clientId: "a", exercise: "Squat", weightKg: 80, reps: 5 }),
  ]);
  const summary = computeSessionSummary(first, [first]);
  assert.ok(summary?.facts.some((fact) => fact.includes("400 kg·reps total volume")));
  assert.ok(summary?.facts.some((fact) => fact.includes("Baseline heaviest set: Squat 80 kg")));
});

test("summaries only see the history they are given", () => {
  const alice = session("alice", "2026-10-08", [
    set({ clientId: "a1", exercise: "Press", weightKg: 20, reps: 8 }),
  ]);
  const aliceOnly = computeSessionSummary(alice, [alice]);
  assert.equal(aliceOnly?.previous, null);
  assert.equal(aliceOnly?.volume, 160);
  assert.equal(aliceOnly?.prs.some((pr) => pr.value === 80), false);
});

test("historyFromSyncedSets ignores unsaved rows", () => {
  const live = historyFromSyncedSets("ses-today", "2026-11-02", [
    {
      id: "pending",
      sessionId: null,
      exercise: "Curl",
      weightKg: 12,
      reps: 10,
      rir: null,
      createdAt: "2026-11-02T08:00:00.000Z",
      syncStatus: "pending",
    },
    {
      id: "saved",
      sessionId: "ses-today",
      exercise: "Curl",
      weightKg: 14,
      reps: 8,
      rir: 2,
      createdAt: "2026-11-02T08:01:00.000Z",
      syncStatus: "synced",
    },
  ]);
  assert.ok(live);
  assert.equal(live.sets.length, 1);
  assert.equal(live.sets[0].weightKg, 14);
  const merged = mergeTodayIntoHistory(live, [
    session("old", "2026-10-01", [set({ clientId: "x", exercise: "Curl", weightKg: 10, reps: 10 })]),
    session("ses-today", "2026-11-02", [set({ clientId: "stale", exercise: "Curl", weightKg: 8, reps: 8 })]),
  ]);
  assert.equal(merged[0].id, "ses-today");
  assert.equal(merged.filter((row) => row.id === "ses-today").length, 1);
  assert.equal(merged[0].sets[0].weightKg, 14);
});

test("exercise breakdown includes reps, volume and e1RM", () => {
  const day = session("s1", "2026-10-08", [
    set({ clientId: "1", exercise: "Bench press", weightKg: 40, reps: 8 }),
    set({ clientId: "2", exercise: "Bench press", weightKg: 50, reps: 5 }),
  ]);
  const bench = computeSessionSummary(day, [day])?.exercises[0];
  assert.ok(bench);
  assert.equal(bench.setCount, 2);
  assert.equal(bench.totalReps, 13);
  assert.equal(bench.volume, 40 * 8 + 50 * 5);
  assert.equal(bench.topWeightKg, 50);
  assert.ok(bench.bestE1rm && bench.bestE1rm > 50);
});

test("missing weight and reps stay out of averages and volume", () => {
  const day = session("s1", "2026-10-08", [
    set({ clientId: "1", exercise: "Pull-up", weightKg: null, reps: 6 }),
    set({ clientId: "2", exercise: "Hold", weightKg: 20, reps: null, rir: null }),
  ]);
  const summary = computeSessionSummary(day, [day]);
  assert.equal(summary?.volume, null);
  assert.equal(summary?.averageReps, 6);
  assert.equal(summary?.exercises.find((row) => row.key === "pull-up")?.bestE1rm, null);
});

test("duration uses first and last saved set timestamps", () => {
  const day = session("s1", "2026-10-08", [
    set({ clientId: "1", exercise: "Squat", weightKg: 60, reps: 5, createdAt: "2026-10-08T08:00:00.000Z" }),
    set({ clientId: "2", exercise: "Squat", weightKg: 60, reps: 5, createdAt: "2026-10-08T08:40:00.000Z" }),
  ]);
  const summary = computeSessionSummary(day, [day]);
  assert.equal(summary?.durationMs, 40 * 60 * 1000);
  const single = computeSessionSummary(
    session("s2", "2026-10-09", [
      set({ clientId: "3", exercise: "Squat", weightKg: 60, reps: 5 }),
    ]),
    [],
  );
  assert.equal(single?.durationMs, null);
});

test("classifyExercise maps known lifts and leaves unknown ones unclassified", () => {
  assert.equal(classifyExercise("Incline bench press").primary, "chest");
  assert.deepEqual(classifyExercise("Barbell row").secondary, ["biceps"]);
  assert.equal(classifyExercise("Romanian deadlift").primary, "hamstrings");
  assert.equal(classifyExercise("Mystery machine 3000").primary, "unclassified");
  assert.equal(classifyExercise("Mystery machine 3000").secondary.length, 0);
});

test("muscle volume is assigned to the primary group only", () => {
  const day = session("s1", "2026-10-08", [
    set({ clientId: "1", exercise: "Bench press", weightKg: 40, reps: 10 }),
  ]);
  const muscles = computeSessionSummary(day, [day])?.muscles ?? [];
  const chest = muscles.find((row) => row.group === "chest");
  const triceps = muscles.find((row) => row.group === "triceps");
  assert.equal(chest?.volume, 400);
  assert.equal(chest?.primarySetCount, 1);
  assert.equal(triceps?.volume, null);
  assert.equal(triceps?.secondarySetCount, 1);
});

test("editing or deleting a set rebuilds the summary", () => {
  const original = session("s1", "2026-10-08", [
    set({ clientId: "keep", exercise: "Squat", weightKg: 80, reps: 5 }),
    set({ clientId: "edit", exercise: "Squat", weightKg: 100, reps: 3 }),
  ]);
  assert.equal(computeSessionSummary(original, [original])?.volume, 80 * 5 + 100 * 3);
  const edited = session("s1", "2026-10-08", [
    set({ clientId: "keep", exercise: "Squat", weightKg: 80, reps: 5 }),
    set({ clientId: "edit", exercise: "Squat", weightKg: 70, reps: 5 }),
  ]);
  assert.equal(computeSessionSummary(edited, [edited])?.volume, 80 * 5 + 70 * 5);
  const remaining = session("s1", "2026-10-08", [
    set({ clientId: "keep", exercise: "Squat", weightKg: 80, reps: 5 }),
  ]);
  assert.equal(computeSessionSummary(remaining, [remaining])?.volume, 400);
});

test("weekly insights compare this Monday-Sunday block with the previous week", () => {
  assert.equal(weekMonday("2026-11-04"), "2026-11-02");
  const sessions = [
    session("a", "2026-10-27", [set({ clientId: "1", exercise: "Squat", weightKg: 50, reps: 5 })]),
    session("b", "2026-11-03", [set({ clientId: "2", exercise: "Squat", weightKg: 80, reps: 5 })]),
    session("c", "2026-11-04", [set({ clientId: "3", exercise: "Squat", weightKg: 80, reps: 5 })]),
  ];
  const week = computeWeeklyInsights(sessions, "2026-11-04");
  assert.equal(week.weekStart, "2026-11-02");
  assert.equal(week.sessionCount, 2);
  assert.equal(week.setCount, 2);
  assert.equal(week.volume, 800);
  assert.equal(week.previous?.sessionCount, 1);
  assert.equal(week.volumeTrend, "improved");
  const firstWeek = computeWeeklyInsights([sessions[1]], "2026-11-04");
  assert.equal(firstWeek.previous, null);
  assert.equal(firstWeek.volumeTrend, "insufficient");
});

test("session screens are linked from progress and the live log screen", () => {
  const layout = readFileSync(join(ROOT, "app/(member)/_layout.tsx"), "utf8");
  const progress = readFileSync(join(ROOT, "app/(member)/progress/index.tsx"), "utf8");
  const session = readFileSync(join(ROOT, "app/(member)/session.tsx"), "utf8");
  assert.match(layout, /sessions\/index/);
  assert.match(layout, /sessions\/\[sessionId\]/);
  assert.match(progress, /\/\(member\)\/sessions/);
  assert.match(session, /SessionSummaryCard/);
  assert.equal(session.includes("usePushToTalkWorkout"), true);
});
