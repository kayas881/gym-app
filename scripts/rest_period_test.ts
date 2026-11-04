import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRestSeconds,
  applyRestIntent,
  formatRestClock,
  idleRestSnapshot,
  parseRestCommand,
  pauseRestSnapshot,
  remainingMs,
  recommendedRestSec,
  restCategoryForExercise,
  resumeRestSnapshot,
  skipRestSnapshot,
  startRestSnapshot,
} from "../lib/rest-period.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("exercise categories map to the published rest defaults", () => {
  assert.equal(restCategoryForExercise("Back squat"), "heavy_compound");
  assert.equal(recommendedRestSec("Deadlift"), 180);
  assert.equal(recommendedRestSec("Incline bench press"), 120);
  assert.equal(recommendedRestSec("Bicep curl"), 90);
  assert.equal(recommendedRestSec("Plank"), 60);
  assert.equal(recommendedRestSec("Mystery machine"), 120);
});

test("timer remaining comes from wall-clock endsAt", () => {
  const started = startRestSnapshot(idleRestSnapshot(), {
    sourceSetId: "set-1",
    exercise: "Squat",
    weightKg: 80,
    reps: 5,
    durationSec: 120,
    recommendedSec: 180,
    category: "heavy_compound",
  }, 1_000_000);
  assert.equal(started.status, "running");
  assert.equal(remainingMs(started, 1_000_000), 120_000);
  assert.equal(remainingMs(started, 1_030_000), 90_000);
  assert.equal(formatRestClock(90_000), "1:30");
});

test("the same confirmed set does not start a second timer", () => {
  const first = startRestSnapshot(idleRestSnapshot(), {
    sourceSetId: "set-1",
    exercise: "Squat",
    weightKg: 80,
    reps: 5,
    durationSec: 120,
    recommendedSec: 180,
    category: "heavy_compound",
  }, 1_000_000);
  const retry = startRestSnapshot(first, {
    sourceSetId: "set-1",
    exercise: "Squat",
    weightKg: 80,
    reps: 5,
    durationSec: 90,
    recommendedSec: 180,
    category: "heavy_compound",
  }, 1_010_000);
  assert.equal(retry.endsAt, first.endsAt);
  assert.equal(retry.durationSec, 120);
});

test("a new set replaces the countdown", () => {
  const first = startRestSnapshot(idleRestSnapshot(), {
    sourceSetId: "set-1",
    exercise: "Squat",
    weightKg: 80,
    reps: 5,
    durationSec: 120,
    recommendedSec: 180,
    category: "heavy_compound",
  }, 1_000_000);
  const next = startRestSnapshot(first, {
    sourceSetId: "set-2",
    exercise: "Bench press",
    weightKg: 40,
    reps: 8,
    durationSec: 180,
    recommendedSec: 180,
    category: "heavy_compound",
  }, 1_050_000);
  assert.equal(next.sourceSetId, "set-2");
  assert.equal(next.durationSec, 180);
});

test("pause freezes remaining time and resume uses a new endsAt", () => {
  const running = startRestSnapshot(idleRestSnapshot(), {
    sourceSetId: "set-1",
    exercise: "Row",
    weightKg: 30,
    reps: 10,
    durationSec: 90,
    recommendedSec: 90,
    category: "isolation",
  }, 1_000_000);
  const paused = pauseRestSnapshot(running, 1_020_000);
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedRemainingMs, 70_000);
  assert.equal(remainingMs(paused, 1_080_000), 70_000);
  const resumed = resumeRestSnapshot(paused, 1_080_000);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.endsAt, 1_150_000);
});

test("add time, skip and voice intents", () => {
  const running = startRestSnapshot(idleRestSnapshot(), {
    sourceSetId: "set-1",
    exercise: "Curl",
    weightKg: 12,
    reps: 10,
    durationSec: 90,
    recommendedSec: 90,
    category: "isolation",
  }, 1_000_000);
  const added = addRestSeconds(running, 30, 1_000_000);
  assert.equal(remainingMs(added, 1_000_000), 120_000);
  const skipped = skipRestSnapshot(added, 1_010_000);
  assert.equal(skipped.status, "done");
  const spoken = applyRestIntent(running, { type: "query_remaining" }, 1_030_000);
  assert.match(spoken.reply, /1:00 left/);
});

test("voice parser handles rest commands and leaves set logs alone", () => {
  assert.equal(parseRestCommand("skip rest").status, "command");
  assert.equal(parseRestCommand("add 30 seconds").status, "command");
  assert.equal(parseRestCommand("add one minute").status, "command");
  assert.equal(parseRestCommand("pause timer").status, "command");
  assert.equal(parseRestCommand("resume timer").status, "command");
  assert.equal(parseRestCommand("how much rest is left").status, "command");
  assert.equal(parseRestCommand("rest").status, "ambiguous");
  assert.equal(parseRestCommand("bench 40 kilos 8 reps").status, "not_rest");
  const add = parseRestCommand("add 30 seconds");
  assert.equal(add.status === "command" && add.intent.type === "add" && add.intent.seconds === 30, true);
});

test("confirm starts the timer and discard does not", () => {
  const hook = readFileSync(join(ROOT, "hooks/usePushToTalkWorkout.ts"), "utf8");
  const save = hook.slice(hook.indexOf("const saveConfirmedFields"), hook.indexOf("const confirmDraft"));
  const cancel = hook.slice(hook.indexOf("const cancelDraft"), hook.indexOf("const applySet"));
  assert.match(save, /startRestAfterSet/);
  assert.equal(cancel.includes("startRestAfterSet"), false);
  assert.match(hook, /parseRestCommand/);
  assert.equal(hook.includes("extractWorkoutSet(spoken") && hook.indexOf("parseRestCommand") < hook.indexOf("extractWorkoutSet(spoken"), true);
});
