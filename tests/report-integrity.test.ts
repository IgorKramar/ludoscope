import { describe, it, expect } from "vitest";
import { LudoscopeAgentApi, renderAnalysis } from "../src/integration/api.js";
describe("Agent Markdown report", () => {
  it("exposes evaluation origin, metrics, criteria and author constraints", async () => {
    const api = await LudoscopeAgentApi.create();
    const result = await api.call("evaluate_playtest", {
      request: { api_version: "1.0", request_id: "req.report", project_id: "project.report", timestamp: "2026-10-31T00:00:00Z", status: "submitted", context: { subject: "Explicit rule", creative_principles: ["Keep quiet rituals"], constraints: ["Three rules"] } },
      data_origin: "simulation", observations: [{ participant: "model", kind: "measurement", metric: "errors", value: 2, hypothesis: "hypothesis.rule" }],
      criteria: [{ hypothesis_id: "hypothesis.rule", metric: "errors", operator: "lte", threshold: 0 }],
    });
    expect(result.markdown).toContain("## Evaluation");
    expect(result.markdown).toContain("MODEL");
    expect(result.markdown).toContain("**Declared human participants:** 0");
    expect(result.markdown).toContain("Keep quiet rituals");
    expect(result.markdown).toContain("Three rules");
    expect(result.markdown).toContain("**Tradeoffs**");
    expect(result.markdown).toContain("hypothesis.rule");
  });
  it("renders imported markup as text without raw images or HTML", async () => {
    const api = await LudoscopeAgentApi.create();
    const result = await api.call("analyze_concept", {
      request: { api_version: "1.0", request_id: "req.markup", project_id: "project.report", timestamp: "2026-10-31T00:00:00Z", status: "submitted", context: { subject: '<img src="https://example.invalid/track"> ![remote](https://example.invalid/image)' } },
      concept: "Choose one of two paths",
    });
    const rendered = renderAnalysis(result);
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('![remote]');
    expect(rendered).toContain("## Evidence");
  });
});
