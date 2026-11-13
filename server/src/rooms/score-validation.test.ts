import assert from "node:assert/strict";
import test from "node:test";
import { validateScore } from "./score-validation.js";

test("reaction time rejects impossible sub-100ms results", () => {
  assert.match(
    validateScore("reaction-time", { value: 99, unit: "ms" }) ?? "",
    /outside the accepted range/
  );
});

test("reaction time accepts a plausible result", () => {
  assert.equal(
    validateScore("reaction-time", { value: 184, unit: "ms" }),
    null
  );
});

test("each test requires its own score unit", () => {
  assert.match(
    validateScore("number-memory", { value: 8, unit: "level" }) ?? "",
    /Expected score unit digits/
  );
});

test("sequence-memory tests require whole-number levels", () => {
  assert.match(
    validateScore("chimp-test", { value: 4.5, unit: "level" }) ?? "",
    /whole-number/
  );
});

test("typing speed checks both WPM and optional accuracy", () => {
  assert.equal(
    validateScore("typing-speed", {
      value: 72,
      unit: "wpm",
      accuracy: 98
    }),
    null
  );
  assert.match(
    validateScore("typing-speed", {
      value: 72,
      unit: "wpm",
      accuracy: 120
    }) ?? "",
    /Accuracy/
  );
});
