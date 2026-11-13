import type { ScoreSubmission, TestId } from "@ability-benchmark/shared";

interface ScoreRule {
  unit: ScoreSubmission["unit"];
  min: number;
  max: number;
  integer?: boolean;
}

const SCORE_RULES: Record<TestId, ScoreRule> = {
  "reaction-time": { unit: "ms", min: 100, max: 10_000 },
  "aim-trainer": { unit: "ms/target", min: 1, max: 60_000 },
  "chimp-test": { unit: "level", min: 1, max: 100, integer: true },
  "number-memory": { unit: "digits", min: 1, max: 100, integer: true },
  "typing-speed": { unit: "wpm", min: 0, max: 300 }
};

export function validateScore(
  testId: TestId,
  score: ScoreSubmission
): string | null {
  if (!score || typeof score !== "object") {
    return "Score must be an object containing a numeric value and unit.";
  }

  const rule = SCORE_RULES[testId];

  if (!Number.isFinite(score.value)) {
    return "Score must be a finite number.";
  }

  if (score.unit !== rule.unit) {
    return "Expected score unit " + rule.unit + ".";
  }

  if (score.value < rule.min || score.value > rule.max) {
    return "Score is outside the accepted range for " + testId + ".";
  }

  if (rule.integer && !Number.isInteger(score.value)) {
    return "This test requires a whole-number score.";
  }

  if (
    score.accuracy !== undefined &&
    (!Number.isFinite(score.accuracy) ||
      score.accuracy < 0 ||
      score.accuracy > 100)
  ) {
    return "Accuracy must be between 0 and 100.";
  }

  if (testId !== "typing-speed" && score.accuracy !== undefined) {
    return "Accuracy is only accepted for the typing-speed test.";
  }

  return null;
}
