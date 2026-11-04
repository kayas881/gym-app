import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExtractedWorkoutSet,
  validateDraftFields,
} from "../lib/workout-set.ts";

test("parseExtractedWorkoutSet forces needsConfirmation", () => {
  const parsed = parseExtractedWorkoutSet({
    exercise: "Bench press",
    weightKg: 40,
    reps: 10,
    rir: 2,
    uncertainFields: ["rir"],
    needsConfirmation: false,
  });
  assert.equal(parsed.needsConfirmation, true);
  assert.equal(parsed.exercise, "Bench press");
  assert.deepEqual(parsed.uncertainFields, ["rir"]);
});

test("parseExtractedWorkoutSet rejects a missing contract field", () => {
  assert.throws(() =>
    parseExtractedWorkoutSet({
      exercise: "Squat",
      weightKg: 80,
      reps: 5,
      uncertainFields: [],
      needsConfirmation: true,
    }),
  );
});

test("validateDraftFields requires an exercise name", () => {
  const result = validateDraftFields({
    exercise: "  ",
    weightKg: "40",
    reps: "10",
    rir: "2",
  });
  assert.equal(result.ok, false);
});

test("validateDraftFields accepts a corrected set", () => {
  const result = validateDraftFields({
    exercise: "Lat pulldown",
    weightKg: "43",
    reps: "8",
    rir: "",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.exercise, "Lat pulldown");
    assert.equal(result.value.weightKg, 43);
    assert.equal(result.value.reps, 8);
    assert.equal(result.value.rir, null);
  }
});
