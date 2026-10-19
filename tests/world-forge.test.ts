import Ajv2020 from "ajv/dist/2020.js";
import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LudoscopeAgentApi,
  agentCapabilities,
} from "../src/integration/api.js";
import {
  operationInputs,
  operationOutputs,
  GameDesignAnalysis,
  type AgentOperation,
} from "../src/integration/contracts.js";
import {
  type ChroniclerAdapter,
  ProjectHistory,
} from "../src/integration/chronicler.js";
import { createServer } from "../src/mcp/server.js";
const mechanic = JSON.parse(
  await readFile(
    new URL("../examples/survival/mechanic.json", import.meta.url),
    "utf8",
  ),
);
const model = JSON.parse(
  await readFile(
    new URL("../examples/economic-tycoon/economy.json", import.meta.url),
    "utf8",
  ),
);
const request = {
  api_version: "1.0" as const,
  request_id: "req.1",
  project_id: "project.forge",
  task_id: "task.hunger",
  session_id: "session.1",
  agent_id: "agent.design",
  timestamp: "2026-10-19T09:00:00Z",
  status: "submitted" as const,
  artifact_refs: [
    {
      id: "artifact.spec",
      project_id: "project.forge",
      kind: "specification",
      description: "Submitted test fixture",
      revision: "git:fixture",
    },
  ],
  evidence: [],
  context: {
    subject: "hunger mechanic",
    genre: "survival",
    audience: "experienced players",
    author_goals: ["deliberate expedition planning"],
    creative_principles: ["Preserve authored quiet rituals"],
    constraints: ["No compulsory economy expansion"],
    tags: ["choice", "mastery"],
    system_types: ["mechanic"],
  },
};
const hypothesis = {
  id: "hypothesis.hunger",
  statement: "Players can identify a changed planning choice.",
  claim_type: "DESIGN_HYPOTHESIS" as const,
  falsification: "Linked measurement misses the predeclared threshold.",
  metric: "choice_count",
};
const valid: Record<AgentOperation, unknown> = {
  get_capabilities: { request },
  list_lenses: { request, query: "choice" },
  get_lens: { request, lens_id: "knowledge.lens_consequence" },
  analyze_concept: {
    request,
    concept: "Plan a dangerous expedition with limited food.",
    mechanics: [mechanic],
  },
  analyze_mechanic: { request, mechanic },
  analyze_game_loop: {
    request,
    steps: [
      {
        id: "step.plan",
        action: "plan",
        state_change: "route selected",
        feedback: "map",
        next: ["step.explore"],
      },
      {
        id: "step.explore",
        action: "explore",
        state_change: "supplies consumed",
        feedback: "inventory",
        next: ["step.plan"],
      },
    ],
  },
  evaluate_player_agency: { request, mechanic },
  analyze_progression: {
    request,
    learning: {
      skills: [
        {
          id: "skill.plan",
          requires: [],
          introduced_at: 0,
          practice: ["choose route"],
          variation: ["new weather"],
        },
      ],
    },
  },
  analyze_balance: { request, model },
  evaluate_systems: {
    request,
    graph: {
      schema_version: "1.0",
      nodes: [
        { id: "system.food", type: "System", label: "Food" },
        {
          id: "experience.planning",
          type: "ExperienceGoal",
          label: "Planning",
        },
      ],
      edges: [
        { from: "system.food", to: "experience.planning", type: "Enables" },
      ],
    },
  },
  review_gdd: {
    request,
    sections: [
      { id: "doc.vision", type: "vision", text: "Deliberate planning." },
    ],
  },
  generate_alternatives: { request, mechanic },
  formulate_playtest: {
    request,
    hypothesis,
    participants: "Recruit real consenting participants; no observations yet.",
    metrics: ["choice_count"],
    interpretation: "Compare linked measurements to the planned threshold.",
  },
  evaluate_playtest: {
    request,
    data_origin: "human_playtest",
    observations: [
      {
        participant: "player.1",
        kind: "measurement",
        metric: "choice_count",
        value: 2,
        hypothesis: "hypothesis.hunger",
      },
    ],
    criteria: [
      {
        hypothesis_id: "hypothesis.hunger",
        metric: "choice_count",
        operator: "gte",
        threshold: 3,
      },
    ],
  },
  compare_designs: {
    request,
    designs: [
      { id: "design.a", mechanic },
      { id: "design.b", mechanic: { ...mechanic, feedback: [] } },
    ],
  },
  publish_analysis: { request },
};
describe("WORLD FORGE FIP draft contracts", () => {
  it("exposes each requested capability with strict input/output schemas and engine ownership", async () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (s: string) =>
        s.endsWith("Z") && Number.isFinite(Date.parse(s)),
    });
    const api = await LudoscopeAgentApi.create();
    const capabilities = await api.invoke("get_capabilities", { request });
    expect(capabilities.capabilities).toHaveLength(16);
    expect(new Set(capabilities.capabilities.map((c) => c.engine)).size).toBe(
      5,
    );
    const analysis = await api.invoke("analyze_mechanic", {
      request,
      mechanic,
    });
    for (const name of Object.keys(operationInputs) as AgentOperation[]) {
      const input =
        name === "publish_analysis" ? { request, analysis } : valid[name];
      const result = await api.invoke(name, input);
      const inputSchema = JSON.parse(
        await readFile(
          new URL(
            `../contracts/fip/v1/operations/${name}.input.schema.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const outputSchema = JSON.parse(
        await readFile(
          new URL(
            `../contracts/fip/v1/operations/${name}.output.schema.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const checkInput = ajv.compile(inputSchema),
        checkOutput = ajv.compile(outputSchema);
      expect(checkInput(input), JSON.stringify(checkInput.errors)).toBe(true);
      expect(checkOutput(result), JSON.stringify(checkOutput.errors)).toBe(
        true,
      );

      expect(operationOutputs[name].safeParse(result).success, name).toBe(true);
      expect(result.project_id, name).toBe(request.project_id);
      expect(result.task_id, name).toBe(request.task_id);
      expect(result.request_id, name).toBe(request.request_id);
      expect(result.timestamp.endsWith("Z")).toBe(true);
      expect(result).not.toHaveProperty("context.unexpected");
      await expect(
        api.invoke(name, { ...(input as object), undeclared: true }),
      ).rejects.toThrow();
    }
  });
  it("rejects incompatible versions, non-UTC dates and cross-project artifacts or prior task results", async () => {
    const api = await LudoscopeAgentApi.create();
    for (const patch of [
      { api_version: "2.0" },
      { timestamp: "2026-10-19T10:00:00+01:00" },
      { artifact_refs: [{ ...request.artifact_refs[0], project_id: "other" }] },
    ])
      await expect(
        api.invoke("get_capabilities", { request: { ...request, ...patch } }),
      ).rejects.toThrow();
    const analysis = await api.invoke("analyze_mechanic", {
      request,
      mechanic,
    });
    await expect(
      api.invoke("analyze_mechanic", {
        request: { ...request, task_id: "task.other" },
        mechanic,
        prior_analysis: analysis,
      }),
    ).rejects.toThrow(/task_id/);
  });
  it("returns editable candidate specs and explicit limitations rather than a fun score", async () => {
    const api = await LudoscopeAgentApi.create();
    const a = await api.invoke("generate_alternatives", { request, mechanic });
    expect(a.alternatives.length).toBe(3);
    expect(
      a.alternatives.every((x) => x.mechanic && x.status === "candidate"),
    ).toBe(true);
    expect(a.alternatives[0].mechanic?.rules).toEqual(mechanic.rules);
    expect(a.context.creative_principles).toEqual(
      request.context.creative_principles,
    );
    expect(a.confidence.calibrated).toBe(false);
    expect(a.markdown).toContain("## Evidence");
    expect(a.evidence.some((e) => e.source_id && e.uri)).toBe(true);
    expect(a).not.toHaveProperty("fun_score");
  });
  it("distinguishes simulation and engineering rows from real human playtests", async () => {
    const api = await LudoscopeAgentApi.create();
    for (const data_origin of [
      "simulation",
      "engineering_test",
      "human_playtest",
    ] as const) {
      const r = await api.invoke("evaluate_playtest", {
        ...(valid.evaluate_playtest as object),
        data_origin,
      });
      expect(r.evaluation?.claim_type).toBe(
        data_origin === "simulation"
          ? "MODEL_RESULT"
          : data_origin === "engineering_test"
            ? "PROJECT_FACT"
            : "PLAYTEST_OBSERVATION",
      );
      expect(r.evaluation?.participants).toBe(
        data_origin === "human_playtest" ? 1 : 0,
      );
      expect(r.evaluation?.hypothesis_outcomes[0].status).toBe(
        "descriptively_contradicted",
      );
      expect(
        r.hypotheses.every((h) => h.claim_type === "DESIGN_HYPOTHESIS"),
      ).toBe(true);
    }
  });
  it("does not match unlinked observations to hypotheses and does not treat repeated rows as participants", async () => {
    const api = await LudoscopeAgentApi.create();
    const args = operationInputs.evaluate_playtest.parse(
      valid.evaluate_playtest,
    );
    const obs = {
      participant: "player.1",
      kind: "measurement",
      metric: "choice_count",
      value: 100,
    };
    const r = await api.invoke("evaluate_playtest", {
      ...args,
      observations: [obs, obs],
    });
    expect(r.evaluation?.participants).toBe(1);
    expect(r.evaluation?.hypothesis_outcomes[0].status).toBe("inconclusive");
  });
  it("enforces computation and input size budgets before expensive calculations", async () => {
    const api = await LudoscopeAgentApi.create();
    await expect(
      api.invoke("analyze_balance", {
        request,
        model: { ...model, steps: 501 },
      }),
    ).rejects.toThrow(/budget/);
    await expect(
      api.invoke("analyze_concept", {
        request,
        concept: "x".repeat(2 * 1024 * 1024),
      }),
    ).rejects.toThrow(/2 MiB/);
  });
});
function adapter(
  history: z.infer<typeof ProjectHistory>,
  publications: unknown[],
): ChroniclerAdapter {
  return {
    async getProjectContext() {
      return history;
    },
    async publishAnalysis(analysis) {
      publications.push(analysis);
      return { receipt_id: "receipt.1" };
    },
  };
}
const history = {
  project_id: request.project_id,
  decisions: [
    {
      id: "decision.1",
      decision: "Retain quiet player rituals.",
      artifact_refs: [],
    },
  ],
  experiments: [],
  rejected_alternatives: [
    {
      id: "rejected.1",
      title: "Delegate repeated execution",
      reason: "Conflicts with deliberate ritual.",
    },
  ],
};
describe("Optional Chronicler integration", () => {
  it("continues with explicit incomplete history when absent, failed, invalid or cross-project", async () => {
    for (const chronicler of [
      undefined,
      {
        async getProjectContext() {
          throw new Error("offline");
        },
        async publishAnalysis() {
          throw new Error("offline");
        },
      },
      adapter({ ...history, project_id: "other" }, []),
      {
        async getProjectContext() {
          return {} as never;
        },
        async publishAnalysis() {
          return { receipt_id: "r" };
        },
      },
    ]) {
      const api = await LudoscopeAgentApi.create({ chronicler });
      const result = await api.invoke("analyze_mechanic", {
        request,
        mechanic,
      });
      expect(result.status).toBe("partial");
      expect(result.history.available).toBe(false);
      expect(result.history.limitations.length).toBeGreaterThan(0);
      expect(result.alternatives.length).toBeGreaterThan(1);
    }
  });
  it("times out nonresponding history without blocking local analysis", async () => {
    const api = await LudoscopeAgentApi.create({
      chroniclerTimeoutMs: 5,
      chronicler: {
        async getProjectContext() {
          return new Promise(() => {});
        },
        async publishAnalysis() {
          throw new Error("unused");
        },
      },
    });
    const a = await api.invoke("analyze_mechanic", { request, mechanic });
    expect(a.history.available).toBe(false);
  });
  it("uses history decisions, avoids an exact rejected variant and flags repeated experiments", async () => {
    const questions = [
      {
        id: "experiment.old",
        question: hypothesis.statement,
        result: "Inconclusive; missing task logs.",
      },
    ];
    const api = await LudoscopeAgentApi.create({
      chronicler: adapter({ ...history, experiments: questions }, []),
    });
    const a = await api.invoke("generate_alternatives", {
      request,
      mechanic,
      allowed_changes: ["automation"],
    });
    expect(a.alternatives.map((x) => x.title)).not.toContain(
      "Delegate repeated execution",
    );
    expect(a.findings.some((f) => f.claim.includes("decision.1"))).toBe(true);
    expect(
      a.recommendations.some((r) =>
        r.tradeoffs.some((t) => t.includes("decision.1")),
      ),
    ).toBe(true);
    const p = await api.invoke("formulate_playtest", valid.formulate_playtest);
    expect(p.validation[0].prior_experiment_ids).toEqual(["experiment.old"]);
    expect(p.validation[0].repeat_rationale).toBeTruthy();
    expect(
      p.validation[0].limitations.some((x) => x.includes("missing task logs")),
    ).toBe(true);
  });
  it("never publishes during analysis or preview and denies commits without host authorization", async () => {
    const writes: unknown[] = [];
    const api = await LudoscopeAgentApi.create({
      chronicler: adapter(history, writes),
    });
    const a = await api.invoke("analyze_mechanic", { request, mechanic });
    expect(writes).toEqual([]);
    const preview = await api.invoke("publish_analysis", {
      request,
      analysis: a,
    });
    expect(preview.publication.state).toBe("preview");
    const deny = await api.invoke("publish_analysis", {
      request,
      analysis: a,
      commit: true,
    });
    expect(deny.publication.state).toBe("denied");
    expect(writes).toEqual([]);
  });
  it("reports unavailable publication without fabricating a receipt or losing correlation IDs", async () => {
    const offline = await LudoscopeAgentApi.create();
    const analysis = await offline.invoke("analyze_mechanic", {
      request,
      mechanic,
    });
    const result = await offline.invoke("publish_analysis", {
      request,
      analysis,
      commit: true,
    });
    expect(result.publication.state).toBe("unavailable");
    expect(result.publication.receipt_id).toBeUndefined();
    expect(result.task_id).toBe(request.task_id);
    const api = await LudoscopeAgentApi.create({
      chronicler: {
        async getProjectContext() {
          return history;
        },
        async publishAnalysis() {
          throw new Error("disconnected");
        },
      },
      authorizePublish: () => true,
    });
    const failed = await api.invoke("publish_analysis", {
      request,
      analysis,
      commit: true,
    });
    expect(failed.publication.state).toBe("unavailable");
    expect(failed.status).toBe("partial");
  });
  it("carries project/task through design, experiment, engineering feedback, revision and explicitly authorized publication", async () => {
    const writes: unknown[] = [];
    const api = await LudoscopeAgentApi.create({
      chronicler: adapter(history, writes),
      authorizePublish: (req, analysis) =>
        req.project_id === request.project_id &&
        analysis.task_id === request.task_id,
    });
    const design = await api.invoke("analyze_mechanic", { request, mechanic });
    const h = design.hypotheses[0];
    const experiment = await api.invoke("formulate_playtest", {
      request: { ...request, request_id: "req.experiment" },
      hypothesis: h,
      participants: "Engineering harness, no human participants.",
      method: "inspection",
      metrics: ["rule_passes"],
      interpretation: "A rule check must pass.",
    });
    const observed = await api.invoke("evaluate_playtest", {
      request: { ...request, request_id: "req.engineering" },
      prior_analysis: design,
      data_origin: "engineering_test",
      observations: [
        {
          participant: "runner.1",
          kind: "measurement",
          metric: "rule_passes",
          value: 0,
          hypothesis: h.id,
        },
      ],
      criteria: [
        {
          hypothesis_id: h.id,
          metric: "rule_passes",
          operator: "gte",
          threshold: 1,
        },
      ],
    });
    const revised = await api.invoke("analyze_mechanic", {
      request: { ...request, request_id: "req.revision" },
      mechanic: design.alternatives[1].mechanic,
      prior_analysis: observed,
    });
    expect(
      revised.recommendations.some(
        (r) => r.action.includes(h.id) && r.action.includes("Revisit"),
      ),
    ).toBe(true);
    expect(revised.evaluation?.claim_type).toBe("PROJECT_FACT");
    expect(revised.hypotheses[0].claim_type).toBe("DESIGN_HYPOTHESIS");
    const publication = await api.invoke("publish_analysis", {
      request: { ...request, request_id: "req.publish" },
      analysis: revised,
      commit: true,
    });
    expect(publication.publication.state).toBe("published");
    expect(writes).toHaveLength(1);
    for (const result of [design, experiment, observed, revised, publication]) {
      expect(result.project_id).toBe(request.project_id);
      expect(result.task_id).toBe(request.task_id);
    }
    expect((writes[0] as z.infer<typeof GameDesignAnalysis>).analysis_id).toBe(
      revised.analysis_id,
    );
  });
});
describe("Real MCP agent contract", () => {
  it("exposes the 15 requested tools plus authorized publication and validates calls through SDK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ludoscope-forge-"));
    const server = createServer(root);
    const client = new Client({
      name: "forge-orchestrator-test",
      version: "1.0",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const list = await client.listTools();
      for (const c of agentCapabilities) {
        const tool = list.tools.find((t) => t.name === c.operation)!;
        expect(tool).toBeDefined();
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.outputSchema).toBeDefined();
        const invalid = await client.callTool({
          name: c.operation,
          arguments: { undeclared: true },
        });
        expect(invalid.isError, c.operation).toBe(true);
      }
      const badModel = await client.callTool({
        name: "analyze_balance",
        arguments: { request, model: { ...model, steps: 501 } },
      });
      expect(badModel.isError).toBe(true);
      expect(badModel.structuredContent?.request_id).toBe(request.request_id);
      expect(badModel.structuredContent?.project_id).toBe(request.project_id);
      expect(
        GameDesignAnalysis.safeParse(badModel.structuredContent).success,
      ).toBe(true);
      const result = await client.callTool({
        name: "analyze_mechanic",
        arguments: { request, mechanic },
      });
      expect(result.isError).toBe(false);
      expect(
        GameDesignAnalysis.safeParse(result.structuredContent).success,
      ).toBe(true);
      expect(result.structuredContent?.task_id).toBe(request.task_id);
    } finally {
      await client.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
