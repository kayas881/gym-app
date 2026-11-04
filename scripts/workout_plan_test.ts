import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupLibraryByMuscle,
  isDuplicateExerciseName,
  searchLibrary,
} from "../lib/exercise-library.ts";
import {
  addPlannedExercise,
  buildPlanSnapshot,
  comparePlanToSets,
  formatExerciseTarget,
  moveItem,
  priorSessionPerformance,
  skipPlannedExercise,
  weekdayFromIsoDate,
} from "../lib/workout-plan.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("library search finds bench and rejects duplicates", () => {
  const hits = searchLibrary("bench");
  assert.ok(hits.some((item) => item.key === "bench press"));
  assert.equal(isDuplicateExerciseName("Bench press"), true);
  assert.equal(isDuplicateExerciseName("Landmine press"), false);
});

test("library groups popular lifts by muscle for the picker", () => {
  const groups = groupLibraryByMuscle();
  const chest = groups.find((group) => group.key === "chest");
  const back = groups.find((group) => group.key === "back");
  assert.ok(chest?.exercises.some((item) => item.key === "bench press"));
  assert.ok(back?.exercises.some((item) => item.key === "barbell row"));
  assert.equal(chest?.exercises.some((item) => item.key === "barbell row"), false);
});

test("collapsed exercise summary keeps the form off the card", () => {
  assert.equal(
    formatExerciseTarget({
      key: "bench press",
      name: "Bench press",
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      weightKg: 60,
      rir: 2,
      restSeconds: 180,
      notes: "",
    }),
    "3 sets × 8–12 @ 60 kg · 180s rest",
  );
});

test("prior performance prefers the last finished session, not today's in-progress one", () => {
  const last = { sessionId: "old", weight: 40 };
  const today = { sessionId: "today", weight: 42 };
  assert.equal(priorSessionPerformance(last, null, "today")?.sessionId, "old");
  assert.equal(priorSessionPerformance(today, last, "today")?.sessionId, "old");
  assert.equal(priorSessionPerformance(today, last, "other")?.sessionId, "today");
});

test("weekday mapping uses Monday = 1", () => {
  assert.equal(weekdayFromIsoDate("2026-11-02"), 1);
  assert.equal(weekdayFromIsoDate("2026-11-08"), 7);
});

test("exercises can be reordered", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});

test("starting a plan then skipping still keeps logged sets in the comparison", () => {
  const plan = buildPlanSnapshot({
    routineId: "r1",
    routineName: "Push",
    dayId: "d1",
    dayLabel: "Day 1",
    exercises: [
      {
        key: "bench press",
        name: "Bench press",
        targetSets: 3,
        repsMin: 8,
        repsMax: 10,
        weightKg: 40,
        rir: 2,
        restSeconds: 180,
        notes: "",
      },
      {
        key: "overhead press",
        name: "Overhead press",
        targetSets: 3,
        repsMin: 8,
        repsMax: 8,
        weightKg: null,
        rir: null,
        restSeconds: 180,
        notes: "",
      },
    ],
    startedAt: "2026-11-04T08:00:00.000Z",
  });
  const skipped = skipPlannedExercise(plan, "overhead press");
  const compared = comparePlanToSets(skipped, [
    { exercise: "Bench press", weightKg: 40, reps: 8 },
    { exercise: "Bench press", weightKg: 40, reps: 8 },
  ]);
  assert.equal(compared.plannedExercises, 2);
  assert.equal(compared.completedExercises, 1);
  assert.equal(compared.skippedExercises, 1);
  assert.equal(compared.completedSets, 2);
  assert.equal(compared.plannedSets, 6);
});

test("adding an exercise during a workout does not drop confirmed sets", () => {
  const plan = buildPlanSnapshot({
    routineId: "r1",
    routineName: "Push",
    dayId: "d1",
    dayLabel: "Day 1",
    exercises: [
      {
        key: "bench press",
        name: "Bench press",
        targetSets: 3,
        repsMin: 8,
        repsMax: 10,
        weightKg: null,
        rir: null,
        restSeconds: 120,
        notes: "",
      },
    ],
  });
  const next = addPlannedExercise(plan, {
    key: "dip",
    name: "Dip",
    targetSets: 3,
    repsMin: 8,
    repsMax: 12,
    weightKg: null,
    rir: null,
    restSeconds: 120,
    notes: "",
  });
  const compared = comparePlanToSets(next, [
    { exercise: "Bench press", weightKg: 50, reps: 5 },
  ]);
  assert.equal(compared.completedSets, 1);
  assert.equal(next.exercises.length, 2);
});

test("edit routine picker shows added state, day chips and a done button", () => {
  const edit = readFileSync(join(ROOT, "app/(member)/workouts/edit.tsx"), "utf8");
  const picker = readFileSync(join(ROOT, "components/ExercisePicker.tsx"), "utf8");
  assert.match(edit, /Done/);
  assert.match(edit, /Each day is one workout/);
  assert.match(edit, /Copy exercises from another day/);
  assert.match(edit, /automaticallyAdjustKeyboardInsets/);
  assert.match(edit, /patchRoutines/);
  assert.match(picker, /Added/);
  assert.match(picker, /groupLibraryByMuscle/);
});

test("workout screens are linked and deleting a routine cannot cascade to sets", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/040_workout_routines.sql"), "utf8");
  const uncommented = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /workout_routines/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.equal(/DELETE CASCADE.*workout_sets/i.test(uncommented), false);
  assert.equal(/\bauth\.uid\(\)/.test(uncommented), false);
  const layout = readFileSync(join(ROOT, "app/(member)/_layout.tsx"), "utf8");
  const home = readFileSync(join(ROOT, "app/(member)/home.tsx"), "utf8");
  assert.match(layout, /workouts\/index/);
  assert.match(home, /\/\(member\)\/workouts/);
});
