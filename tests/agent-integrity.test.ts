import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { LudoscopeAgentApi } from "../src/integration/api.js";
import { mergeRecords, validateAnalysisReferences } from "../src/integration/integrity.js";
const mechanic = JSON.parse(await readFile(new URL("../examples/survival/mechanic.json", import.meta.url), "utf8"));
const request = {
  api_version: "1.0" as const, request_id: "req.integrity",
  project_id: "project.integrity", task_id: "task.hunger",
  timestamp: "2026-10-31T00:00:00Z", status: "submitted" as const,
  context: { subject: "Hunger", author_goals: ["Expedition planning"] },
};
const artifact = { id: "artifact.spec", project_id: request.project_id, kind: "specification", description: "Reviewed fixture", revision: "v1" };
const evidence = { id: "evidence.external", kind: "artifact" as const, claim_type: "UNVERIFIED" as const, artifact_id: artifact.id, locator: "fixture", description: "Submitted rules", limitations: ["Caller supplied"] };

describe("Agent reference integrity", () => {
  it("preserves artifact-backed evidence when the next request omits old artifacts", async () => {
    const api = await LudoscopeAgentApi.create();
    const prior = await api.call("analyze_mechanic", { request: { ...request, artifact_refs: [artifact], evidence: [evidence] }, mechanic });
    const revised = await api.call("analyze_mechanic", { request: { ...request, request_id: "req.revised" }, mechanic, prior_analysis: prior });
    expect(revised.artifact_refs).toContainEqual(artifact);
    expect(revised.evidence).toContainEqual(evidence);
    expect(() => validateAnalysisReferences(revised)).not.toThrow();
  });
  it("rejects a forged source record instead of silently replacing registry provenance", async () => {
    const api = await LudoscopeAgentApi.create();
    const result = await api.call("analyze_mechanic", { request, mechanic });
    const source = result.evidence.find((e) => e.kind === "source")!;
    expect(source).toBeDefined();
    await expect(api.call("analyze_mechanic", {
      request: { ...request, evidence: [{ ...source, description: "Forged provenance" }] }, mechanic,
    })).rejects.toThrow(/Conflicting evidence/);
  });
  it("rejects duplicate IDs, dangling artifacts and conflicting artifact revisions", async () => {
    const api = await LudoscopeAgentApi.create();
    await expect(api.call("get_capabilities", { request: { ...request, evidence: [evidence] } })).rejects.toThrow(/Unknown evidence artifact/);
    await expect(api.call("get_capabilities", { request: { ...request, artifact_refs: [artifact, artifact] } })).rejects.toThrow(/Duplicate artifact/);
    const prior = await api.call("analyze_mechanic", { request: { ...request, artifact_refs: [artifact] }, mechanic });
    await expect(api.call("analyze_mechanic", { request: { ...request, artifact_refs: [{ ...artifact, revision: "v2" }] }, mechanic, prior_analysis: prior })).rejects.toThrow(/Conflicting artifact/);
  });
  it("keeps the old hypothesis meaning and outcome after an author changes goals", async () => {
    const api = await LudoscopeAgentApi.create();
    const prior = await api.call("analyze_mechanic", { request, mechanic });
    const h = prior.hypotheses[0];
    const observed = await api.call("evaluate_playtest", {
      request: { ...request, request_id: "req.observed" }, prior_analysis: prior, data_origin: "engineering_test",
      observations: [{ participant: "runner", kind: "measurement", metric: "pass", value: 0, hypothesis: h.id }],
      criteria: [{ hypothesis_id: h.id, metric: "pass", operator: "gte", threshold: 1 }],
    });
    const revised = await api.call("analyze_mechanic", {
      request: { ...request, request_id: "req.new-goal", context: { ...request.context, author_goals: ["A quiet daily ritual"] } },
      mechanic, prior_analysis: observed,
    });
    expect(revised.hypotheses[0].id).not.toBe(h.id);
    expect(revised.hypotheses.find((x) => x.id === h.id)).toEqual(h);
    expect(revised.evaluation?.hypothesis_outcomes[0].hypothesis_id).toBe(h.id);
    expect(revised.recommendations.some((r) => r.hypothesis_ids.includes(h.id))).toBe(true);
    validateAnalysisReferences(revised);
  });
  it("rejects a criterion absent from supplied history and malformed publication links", async () => {
    const api = await LudoscopeAgentApi.create();
    const prior = await api.call("analyze_mechanic", { request, mechanic });
    await expect(api.call("evaluate_playtest", {
      request, prior_analysis: prior, data_origin: "simulation",
      observations: [{ participant: "model", kind: "measurement", metric: "pass", value: 1 }],
      criteria: [{ hypothesis_id: "hypothesis.missing", metric: "pass", operator: "gte", threshold: 1 }],
    })).rejects.toThrow(/Criterion hypothesis/);
    const broken = structuredClone(prior);
    broken.recommendations[0].evidence_ids = ["evidence.missing"];
    await expect(api.call("publish_analysis", { request, analysis: broken })).rejects.toThrow(/Unknown evidence reference/);
  });
  it("retains history artifacts and references their actual history record", async () => {
    const api = await LudoscopeAgentApi.create({ chronicler: {
      async getProjectContext() { return { project_id: request.project_id, decisions: [{ id: "decision.canon", decision: "Retain authored ritual", artifact_refs: [artifact] }], experiments: [], rejected_alternatives: [] }; },
      async publishAnalysis() { throw new Error("No publication authorized"); },
    } });
    const result = await api.call("analyze_mechanic", { request, mechanic });
    const finding = result.findings.find((f) => f.claim.includes("decision.canon"))!;
    expect(result.evidence.find((e) => e.id === finding.evidence_ids[0])?.artifact_id).toBe(artifact.id);
    validateAnalysisReferences(result);
  });
  it("changes experiment identity when its measured criterion changes", async () => {
    const api = await LudoscopeAgentApi.create();
    const prior = await api.call("analyze_mechanic", { request, mechanic });
    const input = { request, hypothesis: prior.hypotheses[0], participants: "Engineering harness", metrics: ["pass"], interpretation: "pass >= 1" };
    const first = await api.call("formulate_playtest", input);
    const changed = await api.call("formulate_playtest", { ...input, interpretation: "pass >= 2" });
    expect(changed.validation[0].id).not.toBe(first.validation[0].id);
  });
  it("fails explicitly at evidence capacity instead of dropping linked records", () => {
    expect(mergeRecords("evidence", [[{ id: "a", value: 1 }], [{ id: "a", value: 1 }]], 1)).toHaveLength(1);
    expect(() => mergeRecords("evidence", [[{ id: "a" }, { id: "b" }]], 1)).toThrow(/budget/);
  });
});
