import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HistorySession, HistorySet } from "../lib/workout-progress.ts";
import {
  applyCoachingDecision,
  buildPlanSnapshot,
  coachingDecisionFor,
  parsePlanSnapshot,
  sessionTargetFor,
  type PlannedExercise,
} from "../lib/workout-plan.ts";
import {
  DEFAULT_WEIGHT_INCREMENTS_KG,
  formatLastRir,
  formatLastTime,
  formatSuggested,
  insightLabel,
  recommendNextSession,
  suggestionChangesTarget,
  weightIncrementKg,
} from "../lib/workout-coach.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function set(
  sessionId: string,
  startedOn: string,
  exercise: string,
  weightKg: number | null,
  reps: number | null,
  rir: number | null,
  index: number,
): HistorySet {
  return {
    clientId: `${sessionId}-${index}`,
    sessionId,
    startedOn,
    exercise,
    weightKg,
    reps,
    rir,
    createdAt: `${startedOn}T08:0${index}:00.000Z`,
  };
}

function session(
  id: string,
  startedOn: string,
  rows: Array<[string, number | null, number | null, number | null]>,
): HistorySession {
  return {
    id,
    startedOn,
    createdAt: `${startedOn}T08:00:00.000Z`,
    sets: rows.map((row, index) => set(id, startedOn, row[0], row[1], row[2], row[3], index)),
  };
}

function bench(partial: Partial<PlannedExercise> = {}): PlannedExercise {
  return {
    key: "bench press",
    name: "Bench press",
    targetSets: 3,
    repsMin: 8,
    repsMax: 10,
    weightKg: 60,
    rir: 2,
    restSeconds: 180,
    notes: "",
    ...partial,
  };
}

function triples(
  exercise: string,
  weight: number,
  reps: number,
  rir: number | null,
): Array<[string, number | null, number | null, number | null]> {
  return [
    [exercise, weight, reps, rir],
    [exercise, weight, reps, rir],
    [exercise, weight, reps, rir],
  ];
}

test("rep progression stays at the same weight and adds one rep", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 9, 2))],
    equipment: "barbell",
  });
  assert.equal(rec.action, "increase_reps");
  assert.equal(rec.suggestedWeightKg, 60);
  assert.equal(rec.suggestedReps, 10);
  assert.equal(rec.reason, "Continue progressing within your target rep range.");
  assert.equal(rec.reliable, true);
  assert.equal(formatSuggested(rec.suggestedWeightKg, rec.suggestedReps), "60 kg × 10 reps");
  assert.equal(formatLastTime(rec.last), "60 kg × 9 reps");
});

test("weight increases after every prescribed set hits the top of the range", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 2))],
    equipment: "barbell",
  });
  assert.equal(rec.action, "increase_weight");
  assert.equal(rec.suggestedWeightKg, 62.5);
  assert.equal(rec.suggestedReps, 8);
  assert.equal(rec.incrementKg, 2.5);
  assert.equal(rec.reliable, true);
});

test("RIR 0-1 blocks a weight increase even when reps hit the top", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 1))],
    equipment: "barbell",
  });
  assert.equal(rec.action, "hold");
  assert.equal(rec.suggestedWeightKg, 60);
  assert.equal(rec.suggestedReps, 10);
  assert.equal(rec.last?.rir, 1);
  assert.match(rec.reason, /RIR/);
});

test("missing RIR is left null and still allows a top-of-range weight increase", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, null))],
    equipment: "barbell",
  });
  assert.equal(rec.last?.rir, null);
  assert.equal(formatLastRir(rec.last), null);
  assert.equal(rec.action, "increase_weight");
  assert.equal(rec.suggestedWeightKg, 62.5);
});

test("incomplete history never recommends a load increase", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", [
        ["Bench press", 60, 10, 3],
        ["Bench press", 60, 10, 3],
      ]),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.action, "hold");
  assert.equal(rec.reliable, false);
  assert.equal(rec.suggestedWeightKg, 60);
  assert.match(rec.reason, /Not enough confirmed sets/);
});

test("a first session is insufficient history, not a plateau", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 8, 2))],
    equipment: "barbell",
  });
  assert.equal(rec.insight, "insufficient_history");
  assert.equal(insightLabel(rec.insight), "Insufficient history");
});

test("two unchanged workouts are not a plateau", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", triples("Bench press", 60, 8, 2)),
      session("s2", "2026-10-08", triples("Bench press", 60, 8, 2)),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.insight, "insufficient_history");
  assert.notEqual(rec.insight, "performance_plateau");
});

test("three unchanged workouts classify as a plateau", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", triples("Bench press", 60, 8, 2)),
      session("s2", "2026-10-08", triples("Bench press", 60, 8, 2)),
      session("s3", "2026-10-15", triples("Bench press", 60, 8, 2)),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.insight, "performance_plateau");
});

test("declining performance repeats the last load", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", triples("Bench press", 60, 10, 2)),
      session("s2", "2026-10-08", triples("Bench press", 55, 7, 1)),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.insight, "performance_declined");
  assert.equal(rec.action, "hold");
  assert.equal(rec.suggestedWeightKg, 55);
  assert.equal(rec.suggestedReps, 7);
});

test("equipment increments stay conservative and configurable", () => {
  assert.equal(DEFAULT_WEIGHT_INCREMENTS_KG.barbell, 2.5);
  assert.equal(DEFAULT_WEIGHT_INCREMENTS_KG.dumbbell, 2);
  assert.equal(DEFAULT_WEIGHT_INCREMENTS_KG.machine, 5);
  assert.equal(DEFAULT_WEIGHT_INCREMENTS_KG.bodyweight, 0);
  const dumbbell = recommendNextSession({
    plan: bench({ key: "shoulder press", name: "Shoulder press", repsMin: 10, repsMax: 12, weightKg: 20 }),
    history: [session("s1", "2026-10-01", triples("Shoulder press", 20, 12, 3))],
    equipment: "dumbbell",
  });
  assert.equal(dumbbell.suggestedWeightKg, 22);
  const machine = recommendNextSession({
    plan: bench({ key: "leg press", name: "Leg press", repsMin: 10, repsMax: 12, weightKg: 80 }),
    history: [session("s1", "2026-10-01", triples("Leg press", 80, 12, 3))],
    equipment: "machine",
  });
  assert.equal(machine.suggestedWeightKg, 85);
  const bodyweight = recommendNextSession({
    plan: bench({ key: "pull-up", name: "Pull-up", repsMin: 6, repsMax: 10, weightKg: null }),
    history: [session("s1", "2026-10-01", triples("Pull-up", 0, 10, 3))],
    equipment: "bodyweight",
  });
  assert.equal(bodyweight.action, "hold");
  assert.equal(bodyweight.suggestedWeightKg, 0);
  const custom = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 2))],
    equipment: "barbell",
    increments: { barbell: 5 },
  });
  assert.equal(weightIncrementKg("barbell", { barbell: 5 }), 5);
  assert.equal(custom.suggestedWeightKg, 65);
});

test("today's in-progress session cannot be used as last time", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("old", "2026-10-01", triples("Bench press", 60, 9, 2)),
      session("today", "2026-11-04", triples("Bench press", 80, 3, 0)),
    ],
    todaySessionId: "today",
    equipment: "barbell",
  });
  assert.equal(rec.last?.sessionId, "old");
  assert.equal(rec.suggestedWeightKg, 60);
  assert.equal(rec.suggestedReps, 10);
});

test("only equivalent exercise names feed the recommendation", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", [
        ...triples("Incline bench press", 40, 10, 3),
        ...triples("bench  press", 60, 9, 2),
      ]),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.last?.workingWeightKg, 60);
  assert.equal(rec.suggestedReps, 10);
});

test("one member's history cannot coach another member", () => {
  const alice = [session("a1", "2026-10-01", triples("Bench press", 40, 10, 3))];
  const bob = [session("b1", "2026-10-01", triples("Bench press", 100, 5, 1))];
  const forAlice = recommendNextSession({ plan: bench({ weightKg: 40, repsMin: 8, repsMax: 10 }), history: alice, equipment: "barbell" });
  const forBob = recommendNextSession({ plan: bench({ weightKg: 100, repsMin: 5, repsMax: 5 }), history: bob, equipment: "barbell" });
  assert.equal(forAlice.last?.workingWeightKg, 40);
  assert.equal(forBob.last?.workingWeightKg, 100);
  assert.notEqual(forAlice.suggestedWeightKg, forBob.last?.workingWeightKg);
});

test("accept, edit and ignore stay on the session snapshot and leave the plan targets alone", () => {
  const snapshot = buildPlanSnapshot({
    routineId: "r1",
    routineName: "Push",
    dayId: "d1",
    dayLabel: "Day 1",
    exercises: [bench()],
  });
  const accepted = applyCoachingDecision(snapshot, {
    key: "bench press",
    status: "accepted",
    weightKg: 62.5,
    reps: 8,
  });
  assert.equal(snapshot.coaching.length, 0);
  assert.equal(snapshot.exercises[0].weightKg, 60);
  assert.equal(accepted.exercises[0].weightKg, 60);
  assert.equal(coachingDecisionFor(accepted, "bench press")?.status, "accepted");
  assert.equal(sessionTargetFor(accepted.exercises[0], coachingDecisionFor(accepted, "bench press")).weightKg, 62.5);
  assert.equal(sessionTargetFor(accepted.exercises[0], coachingDecisionFor(accepted, "bench press")).repsMin, 8);

  const ignored = applyCoachingDecision(snapshot, {
    key: "bench press",
    status: "ignored",
    weightKg: 62.5,
    reps: 8,
  });
  assert.equal(sessionTargetFor(ignored.exercises[0], coachingDecisionFor(ignored, "bench press")).weightKg, 60);

  const edited = applyCoachingDecision(snapshot, {
    key: "bench press",
    status: "edited",
    weightKg: 65,
    reps: 9,
  });
  assert.equal(sessionTargetFor(edited.exercises[0], coachingDecisionFor(edited, "bench press")).weightKg, 65);
  assert.equal(sessionTargetFor(edited.exercises[0], coachingDecisionFor(edited, "bench press")).repsMin, 9);
});

test("old snapshots without coaching still parse", () => {
  const parsed = parsePlanSnapshot({
    routineId: "r1",
    dayId: "d1",
    exercises: [{ key: "bench press", name: "Bench press", targetSets: 3 }],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed?.coaching, []);
});

test("best e1RM is only displayed when the PR engine supplied it", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 2))],
    bestE1rm: 80,
    equipment: "barbell",
  });
  assert.equal(rec.bestE1rm, 80);
  const blank = recommendNextSession({
    plan: bench(),
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 2))],
    equipment: "barbell",
  });
  assert.equal(blank.bestE1rm, null);
});

test("consistent improvement needs three rising sessions", () => {
  const rec = recommendNextSession({
    plan: bench(),
    history: [
      session("s1", "2026-10-01", triples("Bench press", 50, 8, 3)),
      session("s2", "2026-10-08", triples("Bench press", 52.5, 8, 3)),
      session("s3", "2026-10-15", triples("Bench press", 55, 8, 3)),
    ],
    equipment: "barbell",
  });
  assert.equal(rec.insight, "consistent_improvement");
  assert.equal(rec.action, "increase_reps");
});

test("recommendation never mutates the caller's plan", () => {
  const plan = bench();
  recommendNextSession({
    plan,
    history: [session("s1", "2026-10-01", triples("Bench press", 60, 10, 2))],
    equipment: "barbell",
  });
  assert.equal(plan.weightKg, 60);
  assert.equal(plan.repsMin, 8);
  assert.equal(suggestionChangesTarget(plan, 62.5, 8), true);
  assert.equal(suggestionChangesTarget(plan, 60, 8), false);
});

test("active workout shows the coach card and no hosted schema is required", () => {
  const active = readFileSync(join(ROOT, "app/(member)/workouts/active.tsx"), "utf8");
  const coach = readFileSync(join(ROOT, "lib/workout-coach.ts"), "utf8");
  assert.match(active, /ExerciseCoachCard/);
  assert.match(active, /recommendNextSession/);
  assert.match(active, /applyCoachingDecision/);
  assert.equal(/\bauth\.uid\(\)/.test(coach), false);
  assert.match(coach, /never write/i);
});
