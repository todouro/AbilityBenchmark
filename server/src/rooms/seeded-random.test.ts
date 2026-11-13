import assert from "node:assert/strict";
import test from "node:test";
import { createSeededRandom, seededIntegers, seededShuffle } from "@ability-benchmark/shared";

test("the same seed generates the same random sequence", () => {
  const first = createSeededRandom("round-seed");
  const second = createSeededRandom("round-seed");

  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second())
  );
});

test("seeded integer sequences and shuffles are repeatable", () => {
  assert.deepEqual(
    seededIntegers("round-seed", 12, 1, 9),
    seededIntegers("round-seed", 12, 1, 9)
  );
  assert.deepEqual(
    seededShuffle(["a", "b", "c", "d"], "round-seed"),
    seededShuffle(["a", "b", "c", "d"], "round-seed")
  );
});

test("seeded integer sequences reject invalid bounds", () => {
  assert.throws(() => seededIntegers("seed", -1, 0, 9), RangeError);
  assert.throws(() => seededIntegers("seed", 5, 10, 2), RangeError);
});
