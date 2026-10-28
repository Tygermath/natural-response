import assert from "node:assert/strict";
import test from "node:test";

// Fake browser: a speech engine whose utterances last 10 ms per character, and an audio
// context that records beeps. Everything is timestamped.
const t0 = performance.now();
const events = [];
const peaks = [];
const at = () => Math.round(performance.now() - t0);
let current = null;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [],
    addEventListener: (type, fn) => setTimeout(fn, 0),
    cancel: () => { if (current) { clearTimeout(current); current = null; } },
    speak(u) {
      events.push(["speak", at(), u.text]);
      u.onstart?.();
      current = setTimeout(() => { current = null; events.push(["end", at()]); u.onend?.(); }, u.text.length * 10);
    },
  },
  AudioContext: class {
    state = "running"; currentTime = 0; destination = {};
    createOscillator() { return { frequency: {}, connect: (g) => g, start: () => events.push(["beep", at()]), stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v) => { peaks.push(v); } }, connect: (d) => d }; }
  },
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { shadow, getRate, setRate } = await import("../public/app.mjs");

test("each sentence: read, recall pause 0.8x, beep, repeat pause 1x (min 0.8 s), next", async () => {
  const steps = [];
  const long = "This sentence is long enough to take well over one second to read aloud so the minimum does not apply here at all."; // ~1.2 s
  const short = "Hi.";                                                          // 30 ms
  await new Promise((done) => shadow(`${long} ${short}`, "card", { onStep: (i, n, phase) => steps.push([i, phase, at()]), onDone: done }));

  assert.deepEqual(steps.map(([i, p]) => [i, p]), [[0, "speak"], [0, "recall"], [0, "repeat"], [1, "speak"], [1, "recall"], [1, "repeat"]]);
  const [speak1, end1, beep1, speak2, end2, beep2] = events;
  assert.deepEqual([speak1[0], end1[0], beep1[0], speak2[0], end2[0], beep2[0]], ["speak", "end", "beep", "speak", "end", "beep"]);
  const read1 = end1[1] - speak1[1];
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 60, `${label}: ${actual} vs ${expected}`);
  near(beep1[1] - end1[1], 0.8 * read1, "recall pause after a long sentence");
  near(speak2[1] - beep1[1], read1, "repeat pause after a long sentence");
  const read2 = end2[1] - speak2[1];
  near(beep2[1] - end2[1], 0.8 * read2, "recall pause after a short sentence");
  const finished = steps.length && at();
  near(finished - beep2[1], 800, "a short sentence still gets 0.8 s to repeat");
});

test("speed is limited to 0.8–1.5", () => {
  setRate(2);
  globalThis.localStorage.getItem = () => "2";
  assert.equal(getRate(), 1.5);
  globalThis.localStorage.getItem = () => "0.5";
  assert.equal(getRate(), 0.8);
});

test("the shadowing beep peaks at 90% of full volume", () => {
  assert.equal(Math.max(...peaks), 0.9);
});
