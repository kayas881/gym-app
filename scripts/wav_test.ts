import assert from "node:assert/strict";
import test from "node:test";
import { concatInt16, encodeWavPcm16, pcmDurationMs } from "../lib/wav.ts";

test("encodeWavPcm16 writes a RIFF header and the PCM payload", () => {
  const pcm = new Uint8Array([0, 0, 1, 0, 255, 255, 0, 0]);
  const wav = new Uint8Array(encodeWavPcm16(pcm, 16000, 1));
  const ascii = String.fromCharCode(...wav.subarray(0, 12));
  assert.equal(ascii.startsWith("RIFF"), true);
  assert.equal(ascii.endsWith("WAVE"), true);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.equal(wav.byteLength, 52);
});

test("pcmDurationMs matches sample count", () => {
  const pcm = new Uint8Array(16000 * 2);
  assert.equal(pcmDurationMs(pcm, 16000, 1), 1000);
});

test("concatInt16 joins chunks", () => {
  const out = concatInt16([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
  assert.deepEqual([...out], [1, 2, 3, 4]);
});
