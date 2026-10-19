// Executable contract demonstration: in-memory history and synthetic engineering rows, no actual players or Chronicler server.
import { readFile } from "node:fs/promises";
import { LudoscopeAgentApi } from "../../dist/integration/api.js";
const mechanic = JSON.parse(
  await readFile(new URL("../survival/mechanic.json", import.meta.url), "utf8"),
);
const publications = [];
const api = await LudoscopeAgentApi.create({
  chronicler: {
    async getProjectContext(request) {
      return {
        project_id: request.project_id,
        decisions: [
          {
            id: "decision.ritual",
            decision:
              "Preserve quiet rituals unless the author explicitly revises them.",
            artifact_refs: [],
          },
        ],
        experiments: [],
        rejected_alternatives: [],
      };
    },
    async publishAnalysis(analysis) {
      publications.push(analysis);
      return { receipt_id: "demo.receipt.1" };
    },
  },
  // Demonstration authorization only; production hosts must verify real user scope.
  authorizePublish: (request, analysis) =>
    request.project_id === "demo.forge" && analysis.task_id === "task.hunger",
});
const envelope = {
  api_version: "1.0",
  project_id: "demo.forge",
  task_id: "task.hunger",
  session_id: "session.demo",
  agent_id: "orchestrator.demo",
  status: "submitted",
  artifact_refs: [
    {
      id: "artifact.spec",
      project_id: "demo.forge",
      kind: "mechanic",
      revision: "fixture-v1",
      description: "Original demo specification",
    },
  ],
  evidence: [],
  context: {
    subject: "Hunger planning",
    author_goals: ["Meaningful expedition planning"],
    creative_principles: ["Preserve quiet rituals"],
    constraints: ["No automatic expansion into additional RPG systems"],
    tags: ["choice"],
    system_types: ["mechanic"],
  },
};
const request = (id) => ({
  ...envelope,
  request_id: id,
  timestamp: new Date().toISOString(),
});
const analysis = await api.call("analyze_mechanic", {
  request: request("request.design"),
  mechanic,
});
const hypothesis = analysis.hypotheses[0];
const plan = await api.call("formulate_playtest", {
  request: request("request.plan"),
  hypothesis,
  method: "inspection",
  participants: "Synthetic engineering harness, not human participants.",
  metrics: ["rule_passes"],
  interpretation:
    "Expect at least one successful rule check; this is not a player-experience result.",
});
const handoff = {
  project_id: analysis.project_id,
  task_id: analysis.task_id,
  mechanic: analysis.alternatives[1].mechanic,
  creative_principles: analysis.context.creative_principles,
  constraints: analysis.context.constraints,
  hypothesis_ids: analysis.hypotheses.map((h) => h.id),
  validation: plan.validation,
  artifact_refs: analysis.artifact_refs,
};
const evaluated = await api.call("evaluate_playtest", {
  request: request("request.test"),
  prior_analysis: analysis,
  data_origin: "engineering_test",
  observations: [
    {
      participant: "harness.demo",
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
const revised = await api.call("analyze_mechanic", {
  request: request("request.revise"),
  mechanic: handoff.mechanic,
  prior_analysis: evaluated,
});
const preview = await api.call("publish_analysis", {
  request: request("request.preview"),
  analysis: revised,
});
if (publications.length) throw new Error("Preview published unexpectedly");
const published = await api.call("publish_analysis", {
  request: request("request.publish"),
  analysis: revised,
  commit: true,
});
for (const result of [analysis, plan, evaluated, revised, published])
  if (
    result.project_id !== envelope.project_id ||
    result.task_id !== envelope.task_id
  )
    throw new Error("Correlation lost");
console.log(
  JSON.stringify(
    {
      scope:
        "In-memory adapter and synthetic engineering data; no human playtest or real Chronicler",
      project_id: published.project_id,
      task_id: published.task_id,
      alternatives: analysis.alternatives.map((a) => ({
        id: a.id,
        title: a.title,
      })),
      handoff,
      criterion_outcomes: evaluated.evaluation.hypothesis_outcomes,
      revised_recommendations: revised.recommendations,
      preview: preview.publication.state,
      publication: published.publication,
      publication_count: publications.length,
    },
    null,
    2,
  ),
);
