import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { LudoscopeAgentApi } from "../src/integration/api.js";
import { KnowledgeRegistry } from "../src/core/knowledge.js";
import { validateAnalysisReferences } from "../src/integration/integrity.js";
import type { ChroniclerAdapter } from "../src/integration/chronicler.js";

const mechanic = JSON.parse(
  await readFile(
    new URL("../examples/survival/mechanic.json", import.meta.url),
    "utf8",
  ),
);
const request = {
  api_version: "1.0" as const,
  request_id: "req.history-integrity",
  project_id: "project.history-integrity",
  task_id: "task.choice",
  timestamp: "2026-10-31T00:00:00Z",
  status: "submitted" as const,
  context: {
    subject: "Choice",
    author_goals: ["Expedition planning"],
    tags: ["choice"],
  },
};
const artifact = {
  id: "artifact.spec",
  project_id: request.project_id,
  kind: "specification",
  description: "Submitted specification fixture",
  revision: "v1",
};
type History = Awaited<ReturnType<ChroniclerAdapter["getProjectContext"]>>;
function history(decisions: History["decisions"]): History {
  return {
    project_id: request.project_id,
    decisions,
    experiments: [],
    rejected_alternatives: [],
  };
}
function adapter(data: History): ChroniclerAdapter {
  return {
    async getProjectContext() {
      return data;
    },
    async publishAnalysis() {
      throw new Error("Publication is not part of this test");
    },
  };
}

function testKnowledge(sourceTitle: string, version = 1) {
  return new KnowledgeRegistry({
    schema_version: "1.1",
    sources: [
      {
        id: "source.fixture",
        version,
        title: sourceTitle,
        authors: ["Test fixture"],
        url: "https://example.invalid/test-fixture",
        verification_status: "VERIFIED_SOURCE",
        accessed_at: "2026-10-31",
        license: "MIT test fixture",
        notes: "Synthetic registry fixture; not a real publication.",
      },
    ],
    entries: [
      {
        id: "knowledge.fixture",
        version: 1,
        kind: "Lens",
        title: "Choice fixture",
        description: "Original test-only choice question.",
        source_ids: ["source.fixture"],
        school: "test",
        tags: ["choice"],
        applicable_genres: [],
        applicable_stages: [],
        conditions: [],
        questions: ["Which outcome changes?"],
        recommendations: [],
        limitations: ["Test fixture only."],
        conflicting_entry_ids: [],
        related_entry_ids: [],
        verification_status: "EXPERT_INFERENCE",
        confidence: "unknown",
        evidence_locator: "test fixture",
        interpretation: "Test operationalization.",
      },
    ],
  });
}

describe("Optional history and immutable provenance", () => {
  it("continues local analysis when history repeats IDs or conflicts internally", async () => {
    const malformed = [
      history([
        { id: "decision.same", decision: "First", artifact_refs: [] },
        { id: "decision.same", decision: "Second", artifact_refs: [] },
      ]),
      history([
        { id: "decision.first", decision: "First", artifact_refs: [artifact] },
        {
          id: "decision.second",
          decision: "Second",
          artifact_refs: [{ ...artifact, revision: "v2" }],
        },
      ]),
    ];
    for (const data of malformed) {
      const api = await LudoscopeAgentApi.create({ chronicler: adapter(data) });
      const result = await api.call("analyze_mechanic", { request, mechanic });
      expect(result.status).toBe("partial");
      expect(result.history.available).toBe(false);
      expect(result.history.decision_ids).toEqual([]);
      expect(result.history.limitations.join(" ")).toContain("conflicting");
      expect(result.alternatives.length).toBeGreaterThan(1);
      validateAnalysisReferences(result);
    }
  });

  it("keeps current and prior artifacts when conflicting optional history is ignored", async () => {
    const local = await LudoscopeAgentApi.create();
    const prior = await local.call("analyze_mechanic", {
      request: { ...request, artifact_refs: [artifact] },
      mechanic,
    });
    const api = await LudoscopeAgentApi.create({
      chronicler: adapter(
        history([
          {
            id: "decision.remote",
            decision: "Remote snapshot",
            artifact_refs: [{ ...artifact, revision: "v2" }],
          },
        ]),
      ),
    });
    const current = await api.call("analyze_mechanic", {
      request: {
        ...request,
        request_id: "req.current",
        artifact_refs: [artifact],
      },
      mechanic,
    });
    const revised = await api.call("analyze_mechanic", {
      request: { ...request, request_id: "req.revised" },
      mechanic,
      prior_analysis: prior,
    });
    for (const result of [current, revised]) {
      expect(result.status).toBe("partial");
      expect(result.history.available).toBe(false);
      expect(result.artifact_refs).toEqual([artifact]);
      validateAnalysisReferences(result);
    }
  });

  it("keeps prior source evidence when a registry release changes provenance", async () => {
    const oldApi = await LudoscopeAgentApi.create({
      knowledge: testKnowledge("Original fixture title"),
    });
    const prior = await oldApi.call("analyze_mechanic", { request, mechanic });
    const oldEvidence = prior.evidence.find((e) => e.kind === "source")!;
    expect(oldEvidence).toBeDefined();
    // Content changes must also be safe when an upstream package forgot a version bump.
    const updatedApi = await LudoscopeAgentApi.create({
      knowledge: testKnowledge("Corrected fixture title"),
    });
    const revised = await updatedApi.call("analyze_mechanic", {
      request: { ...request, request_id: "req.registry-update" },
      mechanic,
      prior_analysis: prior,
    });
    const currentEvidence = revised.lenses[0].evidence[0];
    expect(currentEvidence.id).not.toBe(oldEvidence.id);
    expect(currentEvidence.description).toContain("Corrected fixture title");
    expect(revised.evidence).toContainEqual(oldEvidence);
    expect(revised.evidence).toContainEqual(currentEvidence);
    validateAnalysisReferences(revised);
  });

  it("distinguishes explicitly versioned source snapshots with unchanged text", async () => {
    const original = await LudoscopeAgentApi.create({
      knowledge: testKnowledge("Fixture title", 1),
    });
    const updated = await LudoscopeAgentApi.create({
      knowledge: testKnowledge("Fixture title", 2),
    });
    const first = await original.call("get_lens", {
      request,
      lens_id: "knowledge.fixture",
    });
    const second = await updated.call("get_lens", {
      request,
      lens_id: "knowledge.fixture",
    });
    expect(first.lenses[0].evidence[0].id).not.toBe(
      second.lenses[0].evidence[0].id,
    );
  });

  it("links revision recommendations to the prior computed result and retains its origin", async () => {
    const api = await LudoscopeAgentApi.create();
    const design = await api.call("analyze_mechanic", { request, mechanic });
    const hypothesis = design.hypotheses[0];
    const observed = await api.call("evaluate_playtest", {
      request: { ...request, request_id: "req.measured" },
      prior_analysis: design,
      data_origin: "engineering_test",
      observations: [
        {
          participant: "runner",
          kind: "measurement",
          metric: "rule_passes",
          value: 0,
          hypothesis: hypothesis.id,
        },
      ],
      criteria: [
        {
          hypothesis_id: hypothesis.id,
          metric: "rule_passes",
          operator: "gte",
          threshold: 1,
        },
      ],
    });
    const computed = observed.evidence.filter(
      (e) =>
        e.kind === "artifact" &&
        e.claim_type === "PROJECT_FACT" &&
        e.description.startsWith(hypothesis.id + ":"),
    );
    expect(computed.length).toBeGreaterThan(0);
    const revised = await api.call("analyze_mechanic", {
      request: { ...request, request_id: "req.after-measurement" },
      mechanic,
      prior_analysis: observed,
    });
    for (const result of [observed, revised]) {
      const recommendation = result.recommendations.find(
        (r) =>
          r.hypothesis_ids.includes(hypothesis.id) &&
          r.action.startsWith("Revisit "),
      )!;
      expect(recommendation).toBeDefined();
      for (const record of computed) {
        expect(recommendation.evidence_ids).toContain(record.id);
        expect(result.evidence).toContainEqual(record);
      }
      expect(result.evaluation?.claim_type).toBe("PROJECT_FACT");
      expect(result.evaluation?.participants).toBe(0);
      validateAnalysisReferences(result);
    }
  });
});
