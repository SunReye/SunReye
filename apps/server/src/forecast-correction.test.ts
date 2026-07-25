import { describe, expect, test } from "bun:test";
import {
  type CorrectionModel,
  type Observation,
  type SkillStats,
  cellKey,
  correctionFactor,
  hourOf,
  learn,
  monthOf,
  skillImprovementPct,
} from "./forecast-correction";

const emptySkill: SkillStats = { maeRaw: 0, maeCorrected: 0, samples: 0 };

/** A steady stream of the same hour on different days, at a fixed ratio. */
const stream = (month: number, hour: number, ratio: number, days: number, expectedW = 5000) =>
  Array.from({ length: days }, (_, d): Observation => {
    const day = String(d + 1).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    const hh = String(hour).padStart(2, "0");
    return { localTime: `2026-${mm}-${day}T${hh}:00`, expectedW, actualW: expectedW * ratio };
  });

describe("time bucketing", () => {
  test("monthOf / hourOf read the local timestamp", () => {
    expect(monthOf("2026-07-24T13:15")).toBe(7);
    expect(hourOf("2026-07-24T13:15")).toBe(13);
    expect(cellKey(7, 13)).toBe("7:13");
  });
});

describe("correctionFactor", () => {
  test("unknown cell is a no-op (factor 1)", () => {
    expect(correctionFactor(new Map(), 7, 13)).toBe(1);
  });

  test("EWMA converges toward the observed ratio with enough weight", () => {
    const model: CorrectionModel = new Map();
    learn(model, emptySkill, stream(7, 13, 1.2, 120), 10_000);
    // With a full-confidence cell, shrinkage barely pulls it back from 1.2.
    expect(correctionFactor(model, 7, 13)).toBeGreaterThan(1.15);
    expect(correctionFactor(model, 7, 13)).toBeLessThanOrEqual(1.2);
  });

  test("shrinkage keeps a sparse cell close to 1.0", () => {
    const model: CorrectionModel = new Map();
    learn(model, emptySkill, stream(7, 13, 1.4, 1), 10_000);
    // One observation of a 1.4 ratio should nudge only slightly (weight 1, K 5).
    const f = correctionFactor(model, 7, 13);
    expect(f).toBeGreaterThan(1.0);
    expect(f).toBeLessThan(1.1);
  });

  test("applied factor is clamped to the safe band", () => {
    const model: CorrectionModel = new Map();
    learn(model, emptySkill, stream(7, 13, 5, 500), 10_000); // ratios clamped to 2.5 per-obs
    expect(correctionFactor(model, 7, 13)).toBeLessThanOrEqual(1.4);
    const low: CorrectionModel = new Map();
    learn(low, emptySkill, stream(7, 13, 0.01, 500), 10_000);
    expect(correctionFactor(low, 7, 13)).toBeGreaterThanOrEqual(0.6);
  });
});

describe("learn — exclusions", () => {
  test("dim hours (below the floor) are skipped", () => {
    const model: CorrectionModel = new Map();
    // expected 100 W against a 10 kW plant → below the 3% floor.
    const result = learn(model, emptySkill, stream(7, 13, 1.3, 30, 100), 10_000);
    expect(result.touched.size).toBe(0);
    expect(model.size).toBe(0);
  });

  test("saturated/likely-curtailed hours are skipped", () => {
    const model: CorrectionModel = new Map();
    // expected 9.5 kW against a 10 kW plant → above the 85% saturation ceiling.
    const result = learn(model, emptySkill, stream(7, 13, 1.0, 30, 9500), 10_000);
    expect(result.touched.size).toBe(0);
  });

  test("negative actuals are ignored", () => {
    const model: CorrectionModel = new Map();
    const bad: Observation[] = [{ localTime: "2026-07-01T13:00", expectedW: 5000, actualW: -10 }];
    expect(learn(model, emptySkill, bad, 10_000).touched.size).toBe(0);
  });
});

describe("skill", () => {
  test("a consistent bias yields a positive measured improvement", () => {
    // The plant steadily produces 20% below the model; the correction should
    // shrink the mean absolute error once it has learned the bias.
    const model: CorrectionModel = new Map();
    const { skill } = learn(model, emptySkill, stream(7, 13, 0.8, 90), 10_000);
    expect(skill.samples).toBeGreaterThan(0);
    expect(skill.maeCorrected).toBeLessThan(skill.maeRaw);
    expect(skillImprovementPct(skill)).toBeGreaterThan(0);
  });

  test("improvement is zero when there is no data", () => {
    expect(skillImprovementPct(emptySkill)).toBe(0);
  });
});
