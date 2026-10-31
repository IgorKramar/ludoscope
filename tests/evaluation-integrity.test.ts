import { describe, expect, it } from "vitest";
import { EvaluationEngine } from "../src/integration/engines.js";
import { PlaytestEvaluation } from "../src/integration/contracts.js";
const request = {
  api_version: "1.0",
  request_id: "req.evaluation-integrity",
  project_id: "project.integrity",
  timestamp: "2026-10-31T00:00:00Z",
  status: "submitted",
  context: { subject: "Explicit multi-criterion experiment" },
};
const row = (
  metric: string,
  value: number,
  hypothesis = "hypothesis.choice",
) => ({
  participant: "participant.1",
  kind: "measurement",
  metric,
  value,
  hypothesis,
});
const criterion = (
  metric: string,
  threshold = 1,
  hypothesis_id = "hypothesis.choice",
) => ({
  hypothesis_id,
  metric,
  operator: "gte",
  threshold,
});
const evaluate = (
  observations: ReturnType<typeof row>[],
  criteria: ReturnType<typeof criterion>[],
) => {
  const checks = new EvaluationEngine().evaluate({
    request,
    data_origin: "engineering_test",
    observations,
    criteria,
  });
  return PlaytestEvaluation.parse(checks.evaluation);
};
describe("Evaluation integrity", () => {
  it("returns one contradicted outcome when any required criterion fails", () => {
    const result = evaluate(
      [row("metric.a", 2), row("metric.b", 0)],
      [criterion("metric.a"), criterion("metric.b")],
    );
    expect(result.hypothesis_outcomes).toHaveLength(1);
    expect(result.hypothesis_outcomes[0].status).toBe(
      "descriptively_contradicted",
    );
    expect(result.hypothesis_outcomes[0].rationale).toContain("metric.a");
    expect(result.hypothesis_outcomes[0].rationale).toContain("metric.b");
  });
  it("requires every criterion to have linked passing measurements", () => {
    const missing = evaluate(
      [row("metric.a", 2), row("metric.b", 9, "hypothesis.other")],
      [criterion("metric.a"), criterion("metric.b")],
    );
    expect(missing.hypothesis_outcomes[0].status).toBe("inconclusive");
    const complete = evaluate(
      [row("metric.a", 2), row("metric.b", 3)],
      [criterion("metric.a"), criterion("metric.b")],
    );
    expect(complete.hypothesis_outcomes).toHaveLength(1);
    expect(complete.hypothesis_outcomes[0].status).toBe(
      "descriptively_supported",
    );
  });
  it("keeps hypotheses independent and a measured failure contradicts a partial conjunction", () => {
    const result = evaluate(
      [row("metric.a", 0), row("metric.a", 5, "hypothesis.other")],
      [
        criterion("metric.a"),
        criterion("metric.missing"),
        criterion("metric.a", 1, "hypothesis.other"),
      ],
    );
    expect(
      result.hypothesis_outcomes.map((o) => [o.hypothesis_id, o.status]),
    ).toEqual([
      ["hypothesis.choice", "descriptively_contradicted"],
      ["hypothesis.other", "descriptively_supported"],
    ]);
  });
  it("computes finite means for large finite measurements", () => {
    const large = evaluate(
      [
        row("metric.large", Number.MAX_VALUE),
        row("metric.large", Number.MAX_VALUE),
      ],
      [criterion("metric.large", Number.MAX_VALUE)],
    );
    expect(large.metrics[0].mean).toBe(Number.MAX_VALUE);
    expect(large.hypothesis_outcomes[0].status).toBe("descriptively_supported");
    const cancelling = evaluate(
      [
        row("metric.large", -Number.MAX_VALUE),
        row("metric.large", Number.MAX_VALUE),
      ],
      [criterion("metric.large", 0)],
    );
    expect(cancelling.metrics[0].mean).toBe(0);
  });
  it("rejects excessive metric cardinality before building the output", () => {
    expect(() =>
      evaluate(
        Array.from({ length: 101 }, (_, i) => row(`metric.m${i}`, i)),
        [],
      ),
    ).toThrow(/100 distinct measured metrics/);
    expect(
      evaluate(
        Array.from({ length: 100 }, (_, i) => row(`metric.m${i}`, i)),
        [],
      ).metrics,
    ).toHaveLength(100);
  });
  it("bounds explanations for large groups", () => {
    const metrics = Array.from({ length: 100 }, (_, i) => `metric.m${i}`);
    const result = evaluate(
      metrics.map((m) => row(m, 1)),
      metrics.map((m) => criterion(m)),
    );
    expect(result.hypothesis_outcomes).toHaveLength(1);
    expect(result.hypothesis_outcomes[0].rationale.length).toBeLessThanOrEqual(
      4000,
    );
    expect(result.hypothesis_outcomes[0].status).toBe(
      "descriptively_supported",
    );
  });
});
