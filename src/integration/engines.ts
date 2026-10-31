import { z } from "zod";
import { createHash } from "node:crypto";
import {
  KnowledgeRegistry,
  registry,
  retrieveContext,
} from "../core/knowledge.js";
import { selectLenses } from "../core/lenses.js";
import { analyseMechanic } from "../analysis/mechanic.js";
import { analyseSystems } from "../analysis/systems.js";
import { mastery, evaluatePlaytest } from "../analysis/labs.js";
import { simulate } from "../simulation/index.js";
import { Mechanic } from "../core/schemas.js";
import {
  operationInputs,
  type AgentOperation,
  type DesignRequest,
  LensReference,
  EvidenceReference,
  DesignAlternative,
  ExperimentProposal,
  PlaytestEvaluation,
} from "./contracts.js";
export const stableId = (prefix: string, value: string) =>
  `${prefix}.${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
export interface Check {
  message: string;
  validation: string;
  claim_type?:
    | "EXPERT_INFERENCE"
    | "MODEL_RESULT"
    | "PLAYTEST_OBSERVATION"
    | "PROJECT_FACT";
  evidence?: string[];
}
export interface Checks {
  findings: Check[];
  problems: Check[];
  evaluation?: z.infer<typeof PlaytestEvaluation>;
}
export class DesignKnowledgeEngine {
  constructor(readonly knowledge: KnowledgeRegistry) {}
  static async create() {
    return new DesignKnowledgeEngine(await registry());
  }
  search(request: DesignRequest, query: string) {
    return retrieveContext(this.knowledge, query, {
      ...request.context,
      mode: "design",
      tags: request.context.tags,
      genre: request.context.genre,
      limit: 8,
    });
  }
  evidence(entry: {
    id: string;
    version?: number;
    title: string;
    verification_status: string;
    source_ids: string[];
    evidence?: { source_id: string; pdf_pages: number[]; section: string }[];
  }) {
    return entry.source_ids.map((sourceId) => {
      const source = this.knowledge.data.sources.find(
        (s) => s.id === sourceId,
      )!;
      const loc = entry.evidence
        ?.filter((e) => e.source_id === sourceId)
        .map((e) => `${e.section}; PDF ${e.pdf_pages.join(", ")}`)
        .join("; ");
      const record = {
        kind: "source",
        claim_type: entry.verification_status,
        source_id: sourceId,
        uri: source.url,
        locator: loc || "Bibliographic/entry locator; see knowledge_get",
        description: `${entry.title}; ${source.authors.join(", ")}: ${source.title}`,
        limitations: [
          "Source alignment is not empirical proof of player experience.",
        ],
      };
      // Updated provenance is a new immutable evidence record, even when its
      // knowledge/source identifiers remain stable across registry releases.
      return EvidenceReference.parse({
        id: stableId(
          "evidence",
          JSON.stringify([
            entry.id,
            entry.version ?? null,
            sourceId,
            source.version,
            record,
          ]),
        ),
        ...record,
      });
    });
  }
  lenses(request: DesignRequest, query: string, limit = 10) {
    return selectLenses(this.knowledge, {
      ...request.context,
      mode: "design",
      query,
      system: request.context.subject,
      genre: request.context.genre,
      limit,
    }).map((l) => this.lens(l));
  }
  lens(
    entry: Parameters<DesignKnowledgeEngine["evidence"]>[0] & {
      description: string;
      questions: string[];
      interpretation: string;
      limitations: string[];
    },
  ) {
    return LensReference.parse({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      questions: entry.questions,
      source_ids: entry.source_ids,
      evidence: this.evidence(entry),
      interpretation:
        entry.interpretation || "Original LUDOSCOPE operationalization",
      limitations: entry.limitations,
    });
  }
}
export class AnalysisEngine {
  constructor(private knowledge: DesignKnowledgeEngine) {}
  async mechanic(input: unknown, request: DesignRequest): Promise<Checks> {
    const r = await analyseMechanic(
      input,
      { ...request.context, genre: request.context.genre, mode: "design" },
      this.knowledge.knowledge,
    );
    return {
      findings: [
        {
          message: `Specified experience chain: ${r.experience_chain.actions.length} actions, ${r.experience_chain.state_changes.length} state changes, ${r.experience_chain.feedback.length} feedback descriptions.`,
          validation:
            "Trace these links in the implemented build; counts do not measure quality.",
        },
      ],
      problems: r.findings.map((f) => ({
        message: f.claim,
        validation: f.validation_method,
        evidence: f.evidence,
      })),
    };
  }
  async run(
    name: AgentOperation,
    input: unknown,
    request: DesignRequest,
  ): Promise<Checks> {
    const out: Checks = { findings: [], problems: [] };
    const problem = (message: string, validation: string) =>
      out.problems.push({ message, validation });
    if (
      name === "analyze_mechanic" ||
      name === "evaluate_player_agency" ||
      name === "generate_alternatives"
    )
      return this.mechanic(
        operationInputs[name].parse(input).mechanic,
        request,
      );
    if (name === "analyze_concept") {
      const a = operationInputs.analyze_concept.parse(input);
      if (!request.context.author_goals.length)
        problem(
          "Author experience goals are unspecified.",
          "State the intended experience before interpreting suitability.",
        );
      if (!a.mechanics.length)
        problem(
          "Concept has no formal mechanics; causal rule checks cannot run.",
          "Provide at least one action, rule and state change.",
        );
      for (const m of a.mechanics) {
        const r = await this.mechanic(m, request);
        out.findings.push(...r.findings);
        out.problems.push(...r.problems);
      }
    }
    if (name === "analyze_game_loop") {
      const a = operationInputs.analyze_game_loop.parse(input);
      const ids = new Set(a.steps.map((s) => s.id));
      if (ids.size !== a.steps.length) throw new Error("Duplicate loop step");
      for (const s of a.steps) {
        for (const next of s.next)
          if (!ids.has(next)) throw new Error(`Unknown loop target: ${next}`);
        if (!s.state_change.trim())
          problem(
            `${s.id}: state change unspecified.`,
            `Inspect the state before/after ${s.action}.`,
          );
        if (!s.feedback.trim())
          problem(
            `${s.id}: feedback unspecified.`,
            "Observe whether players recognize the action outcome.",
          );
      }
      const visited = new Set<string>();
      const queue = [a.steps[0].id];
      while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        queue.push(...a.steps.find((s) => s.id === id)!.next);
      }
      for (const s of a.steps)
        if (!visited.has(s.id))
          problem(
            `${s.id} unreachable from the declared first step.`,
            "Check whether this is a separate entry or an omitted link.",
          );
      out.findings.push({
        message: `${visited.size}/${ids.size} specified loop steps reachable from the first step.`,
        validation:
          "Graph reachability only; verify timing, conditions and intended non-loop structure.",
      });
    }
    if (name === "analyze_progression") {
      const a = operationInputs.analyze_progression.parse(input);
      const r = mastery(a.learning);
      out.problems.push(
        ...r.issues.map((message) => ({
          message,
          validation:
            "Inspect the implemented practice and test transfer on a changed task.",
        })),
      );
      out.findings.push({
        message: `${a.learning.skills.length} declared skills checked for prerequisites, practice and variation.`,
        validation:
          "Observe actual users; a complete plan does not prove learning.",
      });
    }
    if (name === "analyze_balance") {
      const a = operationInputs.analyze_balance.parse(input);
      const budget =
        a.model.steps * a.model.processes.reduce((n, p) => n + p.limit, 0);
      if (budget > 50000 || a.model.steps > 500)
        throw new Error(
          "FIP synchronous simulation budget exceeded: <=500 steps and <=50000 process applications",
        );
      const r = simulate(a.model);
      out.findings.push({
        message: `Seed ${a.model.seed}; formal model final resources: ${JSON.stringify(r.final).slice(0, 2500)}.`,
        claim_type: "MODEL_RESULT",
        validation:
          "Repeat with identical rules and seed; contrast with measured build behavior.",
      });
      if (r.violations.length)
        out.problems.push({
          message: `${r.violations.length} explicit invariant violations in this trajectory.`,
          claim_type: "MODEL_RESULT",
          validation:
            "Reproduce the violated invariant; inspect costs, resource flows and boundary conditions.",
        });
    }
    if (name === "evaluate_systems") {
      const a = operationInputs.evaluate_systems.parse(input);
      if (a.graph.nodes.length > 200 || a.graph.edges.length > 1000)
        throw new Error("FIP graph budget: <=200 nodes, <=1000 edges");
      const r = analyseSystems(a.graph);
      out.findings.push({
        message: `${r.feedback_components.length} potential feedback components; ${r.interaction_chains.length} bounded interaction chains.`,
        validation:
          "Specify signs, magnitudes, conditions and delays; topology does not establish causality.",
      });
      if (!r.experience_links.length)
        problem(
          "No explicit system-to-experience links supplied.",
          "Trace one interaction to visible consequences and an author experience goal.",
        );
    }
    if (name === "review_gdd") {
      const a = operationInputs.review_gdd.parse(input);
      const types = new Set(a.sections.map((s) => s.type));
      const ids = new Set(a.sections.map((s) => s.id));
      if (ids.size !== a.sections.length)
        throw new Error("Duplicate GDD section ID");
      for (const type of [
        "vision",
        "mechanics",
        "loop",
        "validation",
        "constraints",
      ])
        if (!types.has(type as "vision"))
          problem(
            `No section explicitly classified as ${type}.`,
            "Check whether the omitted topic is intentionally outside this document scope.",
          );
      out.findings.push({
        message: `${a.sections.length} caller-classified sections reviewed for structural coverage. Prose has not been semantically verified.`,
        validation:
          "Provide structured rules, source links and observed evidence for deeper review.",
      });
    }
    if (name === "compare_designs") {
      const a = operationInputs.compare_designs.parse(input);
      if (new Set(a.designs.map((d) => d.id)).size !== a.designs.length)
        throw new Error("Duplicate design ID");
      for (const d of a.designs) {
        const r = await this.mechanic(d.mechanic, request);
        out.findings.push({
          message: `${d.id}: ${r.problems.length} structural gaps; intended experience: ${d.mechanic.expected_experiences.join(", ") || "unspecified"}.`,
          validation:
            "Compare under shared author criteria; gap counts are not quality scores.",
        });
        for (const p of r.problems)
          out.problems.push({ ...p, message: `${d.id}: ${p.message}` });
      }
    }
    return out;
  }
}
export class RecommendationEngine {
  alternatives(
    mechanic: unknown,
    allowed: ("feedback" | "contextual_choice" | "automation")[],
  ): z.infer<typeof DesignAlternative>[] {
    const m = Mechanic.parse(mechanic);
    const variant = (
      title: string,
      changes: string[],
      tradeoffs: string[],
      spec: z.infer<typeof Mechanic>,
    ) => ({
      id: stableId("alternative", JSON.stringify(spec) + title),
      title,
      changes,
      tradeoffs,
      mechanic: spec,
      status: "candidate" as const,
      claim_type: "DESIGN_HYPOTHESIS" as const,
    });
    const result = [
      variant(
        "Baseline: preserve the authored mechanic",
        ["Retain submitted rules for a reference prototype."],
        [
          "Existing structural gaps remain; preserves the current author intent.",
        ],
        m,
      ),
    ];
    for (const change of [...new Set(allowed)]) {
      const spec = structuredClone(m);
      if (change === "feedback") {
        spec.feedback = [
          ...m.feedback,
          "Prototype feedback showing the changed state, its cause and the applicable rule after each player action.",
        ];
        result.push(
          variant(
            "Make consequences legible",
            [
              "Add state/cause feedback without changing resource costs or success rules.",
            ],
            [
              "More explicit information can reduce intended mystery; review against creative principles.",
            ],
            spec,
          ),
        );
      }
      if (change === "contextual_choice") {
        spec.rules = [
          ...m.rules,
          "Prototype an explicit opportunity to defer this action until a different world state; document the state-dependent consequences before implementation.",
        ];
        spec.choices = [
          ...m.choices,
          {
            id: stableId("choice", m.id),
            consequences: [
              "Compare acting now and deferring under specified world states; exact effects require authored rules.",
            ],
          },
        ].slice(0, 100);
        result.push(
          variant(
            "Compare immediate and deferred action",
            [
              "Prototype timing as a contextual choice while preserving the submitted goal.",
            ],
            [
              "Requires author-specified consequences; may conflict with intended urgency.",
            ],
            spec,
          ),
        );
      }
      if (change === "automation") {
        spec.rules = [
          ...m.rules,
          "Prototype optional automation of the repeated execution step after demonstrated mastery; keep setup decisions explicit.",
        ];
        result.push(
          variant(
            "Delegate repeated execution",
            ["Keep strategic setup; prototype optional execution automation."],
            [
              "Can remove a deliberate ritual or dexterity demand; do not adopt without author approval.",
            ],
            spec,
          ),
        );
      }
    }
    return result;
  }
  experiment(
    request: DesignRequest,
    hypothesisId: string,
    question: string,
    metrics: string[],
    participants: string,
    interpretation: string,
    method: "playtest" | "simulation" | "inspection" = "playtest",
    conditions: string[] = [],
  ): z.infer<typeof ExperimentProposal> {
    return {
      id: stableId(
        "experiment",
        JSON.stringify([
          request.project_id,
          request.task_id ?? null,
          hypothesisId,
          question,
          method,
          metrics,
          participants,
          interpretation,
          request.context.constraints,
          conditions,
        ]),
      ),
      hypothesis_ids: [hypothesisId],
      question,
      method,
      participants,
      conditions: [...request.context.constraints, ...conditions].slice(0, 100),
      metrics,
      interpretation,
      limitations: [
        "Proposed procedure, not completed research.",
        "Simulation and engineering tests cannot establish human enjoyment.",
      ],
      prior_experiment_ids: [],
    };
  }
}
export class EvaluationEngine {
  evaluate(input: unknown): Checks {
    const a = operationInputs.evaluate_playtest.parse(input);
    const measured = a.observations.filter(
      (o) => o.kind === "measurement" && o.value !== undefined,
    );
    if (new Set(measured.map((o) => o.metric)).size > 100)
      throw new Error(
        "FIP playtest budget exceeded: <=100 distinct measured metrics",
      );
    const meanOf = (values: number[]) => {
      const scale = Math.max(...values.map((value) => Math.abs(value)));
      if (scale === 0) return 0;
      const normalized =
        values.reduce((sum, value) => sum + value / scale, 0) / values.length;
      return Math.max(-1, Math.min(1, normalized)) * scale;
    };
    const r = evaluatePlaytest(a.observations);
    const metrics = Object.entries(r.measurements).map(([metric, x]) => ({
      metric,
      count: x.rows,
      min: x.min,
      max: x.max,
      mean: meanOf(
        measured.filter((o) => o.metric === metric).map((o) => o.value!),
      ),
    }));
    const claim_type: "PLAYTEST_OBSERVATION" | "MODEL_RESULT" | "PROJECT_FACT" =
      a.data_origin === "human_playtest"
        ? "PLAYTEST_OBSERVATION"
        : a.data_origin === "simulation"
          ? "MODEL_RESULT"
          : "PROJECT_FACT";
    const grouped = new Map<string, typeof a.criteria>();
    for (const criterion of a.criteria) {
      const group = grouped.get(criterion.hypothesis_id) ?? [];
      group.push(criterion);
      grouped.set(criterion.hypothesis_id, group);
    }
    const outcomes = [...grouped].map(([hypothesis_id, criteria]) => {
      const evaluated = criteria.map((c) => {
        const values = measured
          .filter(
            (o) => o.metric === c.metric && o.hypothesis === c.hypothesis_id,
          )
          .map((o) => o.value!);
        const mean = values.length ? meanOf(values) : undefined;
        const status =
          mean === undefined
            ? ("inconclusive" as const)
            : (c.operator === "gte" ? mean >= c.threshold : mean <= c.threshold)
              ? ("descriptively_supported" as const)
              : ("descriptively_contradicted" as const);
        return {
          status,
          detail:
            mean === undefined
              ? `${c.metric} ${c.operator} ${c.threshold}: no matching measured data linked to this hypothesis.`
              : `${c.metric} ${c.operator} ${c.threshold}: linked-row mean ${mean}, n=${values.length}; ${status}.`,
        };
      });
      const status = evaluated.some(
        (e) => e.status === "descriptively_contradicted",
      )
        ? ("descriptively_contradicted" as const)
        : evaluated.some((e) => e.status === "inconclusive")
          ? ("inconclusive" as const)
          : ("descriptively_supported" as const);
      const details = evaluated.map((e) => e.detail).join(" ");
      return {
        hypothesis_id,
        status,
        rationale: `All ${criteria.length} submitted criteria are required. ${details.length > 3000 ? details.slice(0, 3000) + " [Details truncated; inspect submitted criteria.]" : details} Descriptive only; no causal inference.`,
      };
    });
    const evaluation: z.infer<typeof PlaytestEvaluation> = {
      data_origin: a.data_origin,
      claim_type,
      participants: a.data_origin === "human_playtest" ? r.participants : 0,
      rows: r.rows,
      metrics,
      hypothesis_outcomes: outcomes,
      limitations: [
        ...r.limitations,
        "Origin and participant identities are caller-supplied, not independently authenticated.",
        "Criteria may be post hoc; no preregistration, significance or causal effect is established.",
        "Multiple criteria for one hypothesis are conjunctive: every criterion must pass; a measured failure contradicts the combined criterion, and otherwise missing measurements are inconclusive.",
      ],
    };
    return {
      evaluation,
      findings: [
        {
          message: `${a.data_origin}: ${r.rows} submitted rows; ${evaluation.participants} declared human participants.`,
          claim_type,
          validation:
            "Inspect artifact revision, collection conditions, participant identities and missing data.",
        },
        ...outcomes.map((o) => ({
          message: `${o.hypothesis_id}: ${o.status}. ${o.rationale}`,
          claim_type,
          validation:
            "Repeat under controlled conditions and examine confounds before promoting a hypothesis.",
        })),
      ],
      problems: outcomes
        .filter((o) => o.status === "descriptively_contradicted")
        .map((o) => ({
          message: `${o.hypothesis_id}: supplied data miss the submitted criterion.`,
          claim_type,
          validation:
            "Revisit the proposed change or criterion; preserve the prior hypothesis and test another iteration.",
        })),
    };
  }
}
