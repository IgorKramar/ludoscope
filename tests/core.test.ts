import { describe, it, expect } from "vitest";
import { analyseSystems } from "../src/analysis/systems.js";
import { readFile } from "node:fs/promises";
import { Mechanic, Model, Claim, Document } from "../src/core/schemas.js";
import {
  validateGraph,
  impact,
  validateRules,
  mermaid,
} from "../src/core/graph.js";
import {
  simulate,
  economy,
  compare,
  sensitivity,
} from "../src/simulation/index.js";
import {
  mastery,
  narrative,
  procedural,
  importPlaytest,
  evaluatePlaytest,
  uxReview,
} from "../src/analysis/labs.js";
import {
  KnowledgeRegistry,
  registry,
  importKnowledge,
} from "../src/core/knowledge.js";
import { analyseMechanic } from "../src/analysis/mechanic.js";
const fixture = async (p: string) =>
  JSON.parse(await readFile(new URL("../" + p, import.meta.url), "utf8"));
const graph = {
  schema_version: "1.0",
  nodes: [
    { id: "a", type: "Mechanic", label: "A" },
    { id: "b", type: "System", label: "B" },
    { id: "c", type: "Resource", label: "C" },
    { id: "alone", type: "System", label: "Unconnected" },
  ],
  edges: [
    { from: "a", to: "b", type: "DependsOn" },
    { from: "b", to: "c", type: "Produces" },
  ],
};
const model = {
  id: "model.test",
  seed: 42,
  steps: 50,
  initial: { x: 5 },
  processes: [
    { id: "source", inputs: {}, outputs: { x: 1 }, probability: 0.5 },
  ],
  invariants: [{ resource: "x", max: 6 }],
};
describe("strict data contracts", () => {
  it("rejects undeclared fields, invented evidence and unbounded work", () => {
    expect(() =>
      Claim.parse({ claim: "Fun", claim_type: "PROVEN_FUN" }),
    ).toThrow();
    expect(() => Model.parse({ ...model, execute: "shell" })).toThrow();
    expect(() =>
      Model.parse({
        ...model,
        steps: 10000,
        processes: [
          { id: "source", inputs: {}, outputs: { x: 1 }, limit: 10000 },
        ],
      }),
    ).toThrow(/budget/);
    expect(() =>
      Model.parse({
        ...model,
        processes: [{ id: "bad", inputs: { unknown: 1 }, outputs: {} }],
      }),
    ).toThrow(/Unknown resource/);
    expect(() => Document.parse({ id: "doc.one" })).toThrow();
  });
});
describe("dependency graph and formal rules", () => {
  it("returns transitive conservative impact without isolated nodes", () => {
    expect(impact(graph, "a").affected.map((n) => n.id)).toEqual(["b", "c"]);
    expect(impact(graph, "a").paths.c).toEqual(["a", "b", "c"]);
    expect(mermaid(graph)).toContain("DependsOn");
  });
  it("rejects broken references, duplicate nodes and dependency cycles but permits feedback loops", () => {
    expect(() =>
      validateGraph({
        ...graph,
        edges: [{ from: "a", to: "missing", type: "Requires" }],
      }),
    ).toThrow();
    expect(() =>
      validateGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }),
    ).toThrow();
    expect(() =>
      validateGraph({
        ...graph,
        edges: [...graph.edges, { from: "b", to: "a", type: "Requires" }],
      }),
    ).toThrow();
    expect(() =>
      validateGraph({
        ...graph,
        edges: [...graph.edges, { from: "b", to: "a", type: "Reinforces" }],
      }),
    ).not.toThrow();
  });
  it("finds feedback SCCs and bounded interaction chains without asserting causality", () => {
    const cyclic = {
      ...graph,
      edges: [...graph.edges, { from: "c", to: "a", type: "Reinforces" }],
    };
    const result = analyseSystems(cyclic);
    expect(result.feedback_components).toHaveLength(1);
    expect(new Set(result.feedback_components[0].nodes)).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(result.feedback_components[0].claim_type).toBe("EXPERT_INFERENCE");
    expect(result.interaction_chains).toContainEqual(["a", "b", "c"]);
    expect(result.interaction_chains.every((p) => p.length <= 5)).toBe(true);
  });
  it("separates unreachable states, reachable deadlocks, and inability to finish", () => {
    const r = validateRules({
      initial: "start",
      states: ["start", "trap", "win", "unused"],
      terminal: ["win"],
      transitions: [{ from: "start", to: "trap", action: "risk" }],
    });
    expect(r.deadlocks).toEqual(["trap"]);
    expect(r.unreachable).toEqual(["win", "unused"]);
    expect(r.no_terminal_path).toEqual(["start", "trap"]);
  });
});
describe("simulation and economy", () => {
  it("replays seeded stochastic executions exactly and detects violations", () => {
    expect(simulate(model)).toEqual(simulate(model));
    expect(simulate(model).violations.length).toBeGreaterThan(0);
    expect(
      simulate({ ...model, invariants: [{ resource: "x", min: 10 }] })
        .violations[0].step,
    ).toBe(0);
    expect(
      simulate({
        ...model,
        processes: [{ id: "sink", inputs: { x: 100 }, outputs: { x: 1 } }],
      }).final.x,
    ).toBe(5);
  });
  it("checks cancellation, batch budgets and invalid seed ranges", () => {
    const abort = new AbortController();
    abort.abort();
    expect(() => simulate(model, abort.signal)).toThrow();
    expect(() => compare(model, [])).toThrow();
    expect(() => compare(model, [-1])).toThrow();
    expect(() => sensitivity(model, "missing", [1])).toThrow();
  });
  it("finds a reproducible conversion-gain witness in tycoon and contextualizes sources", async () => {
    const m = await fixture("examples/economic-tycoon/economy.json");
    const e = economy(m);
    expect(
      e.gain_witnesses.some((w) =>
        ["buy", "produce", "sell"].every((id) => w.processes.includes(id)),
      ),
    ).toBe(true);
    expect(simulate(m).final.money).toBe(20);
    expect(simulate(m).violations.length).toBeGreaterThan(0);
    expect(compare(m, [1, 2]).summary.money).toEqual({
      min: 20,
      max: 20,
      mean: 20,
    });
  });
});
describe("experience and research tools", () => {
  it("detects learning order problems and cycles without claiming observed mastery", () => {
    const skills = [
      {
        id: "advanced",
        requires: ["basic"],
        introduced_at: 0,
        practice: [],
        variation: [],
      },
      {
        id: "basic",
        requires: [],
        introduced_at: 2,
        practice: ["task"],
        variation: ["transfer"],
      },
    ];
    expect(mastery({ skills }).issues).toContain(
      "advanced precedes prerequisite basic",
    );
    expect(mastery({ skills }).claim_type).toBe("EXPERT_INFERENCE");
    expect(() =>
      mastery({
        skills: [
          { ...skills[0], requires: ["basic"] },
          { ...skills[1], requires: ["advanced"] },
        ],
      }),
    ).toThrow();
  });
  it("returns canon violation path and marks bounded narrative search as truncated", async () => {
    const n = await fixture("examples/narrative-strategy/narrative.json");
    expect(narrative(n).canon_violations[0].path).toEqual(["betray"]);
    expect(narrative({ ...n, max_states: 1 }).truncated).toBe(true);
    expect(() => narrative({ ...n, canon: { unknown: true } })).toThrow();
  });
  it("counts repeated rows as one participant and keeps subjective feedback separate", async () => {
    const data = importPlaytest(
      await readFile(
        new URL("./fixtures/playtest.csv", import.meta.url),
        "utf8",
      ),
      "csv",
    );
    const result = evaluatePlaytest(data);
    expect(result.participants).toBe(2);
    expect(result.rows).toBe(5);
    expect(result.measurements.task_seconds).toEqual({
      rows: 3,
      participants: 2,
      min: 10,
      max: 30,
      mean: 20,
    });
    expect(result.subjective).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
    expect(() =>
      importPlaytest(
        "participant,kind,metric,value\np1,measurement,time,nope",
        "csv",
      ),
    ).toThrow();
  });
  it("checks distribution, reachability and required resources without asserting fun", () => {
    const result = procedural({
      samples: [
        {
          id: "level.a",
          pattern: "corridor",
          valid: true,
          reachable: true,
          solvable: true,
          resources: ["key"],
        },
        {
          id: "level.b",
          pattern: "corridor",
          valid: true,
          reachable: false,
          solvable: true,
          resources: [],
        },
      ],
      required_resources: ["key"],
    });
    expect(result.invalid).toEqual(["level.b"]);
    expect(result.largest_pattern_share).toBe(1);
    expect(
      uxReview({
        artifacts: [],
        goal: "Learn",
        visible_state: [],
        feedback: [],
        error_recovery: [],
        accessibility: [],
      }).needs_artifacts,
    ).toBe(true);
  });
});
describe("knowledge and genre regressions", () => {
  it("loads registry, validates provenance and filters disabled sources", async () => {
    const k = await registry();
    expect(k.data.sources.length).toBeGreaterThanOrEqual(14);
    const entries = k.search("", { limit: 10000 });
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every((e) => e.verification_status !== "SOURCE_REQUIRED"),
    ).toBe(true);
    const first = entries.find((e) => e.source_ids.length)!;
    expect(
      k
        .search("", { disabled_sources: first.source_ids, limit: 10000 })
        .find((e) => e.id === first.id),
    ).toBeUndefined();
    const bad = structuredClone(k.data);
    bad.entries[0].source_ids = ["source.missing"];
    expect(() => new KnowledgeRegistry(bad)).toThrow();
    expect(() =>
      importKnowledge(k.data, { license: "", redistribution: false }),
    ).toThrow();
  });
  it("rejects duplicate ids, duplicate descriptions, dangling conflicts and false verified provenance", async () => {
    const k = await registry();
    for (const mutate of [
      (d: any) => d.entries.push(structuredClone(d.entries[0])),
      (d: any) => {
        d.entries[1].description = d.entries[0].description;
      },
      (d: any) => {
        d.entries[0].conflicting_entry_ids = ["knowledge.missing"];
      },
      (d: any) => {
        d.entries[0].verification_status = "VERIFIED_SOURCE";
        d.entries[0].source_ids = [];
      },
      (d: any) => {
        d.entries[0].verification_status = "VERIFIED_SOURCE";
        d.entries[0].evidence_locator = "";
      },
    ]) {
      const data = structuredClone(k.data);
      mutate(data);
      expect(() => new KnowledgeRegistry(data)).toThrow();
    }
  });
  it.each([
    "survival",
    "card-roguelike",
    "economic-tycoon",
    "narrative-strategy",
  ])("validates and executes %s demo", async (name) => {
    const m = Mechanic.parse(await fixture(`examples/${name}/mechanic.json`));
    validateGraph(await fixture(`examples/${name}/graph.json`));
    simulate(await fixture(`examples/${name}/economy.json`));
    const result = await analyseMechanic(m);
    expect(result.decision_status).toBe("draft");
    expect(result.affected_systems).toEqual(m.dependencies);
    expect(result.experiment.hypothesis_type).toBe("DESIGN_HYPOTHESIS");
  });
  it("does not invent RPG or production requirements for a minimalist puzzle", async () => {
    const m = await fixture("examples/card-roguelike/mechanic.json");
    const result = await analyseMechanic({
      ...m,
      id: "mechanic.puzzle",
      name: "Three switches",
      genre: "puzzle",
      resources: [],
      dependencies: [],
      tags: ["logic"],
      expected_experiences: ["Deduction"],
      player_goal: "Open the exit",
      rules: [
        "Switch A toggles B",
        "Switch B toggles C",
        "All three open the exit",
      ],
    });
    expect(result.affected_systems).toEqual([]);
    expect(
      result.findings.every((f) => f.claim_type === "EXPERT_INFERENCE"),
    ).toBe(true);
    expect(result.reasoning_tasks.join(" ")).not.toMatch(
      /RPG|production chain|прокачк/,
    );
  });
});
