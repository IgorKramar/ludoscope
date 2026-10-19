import { Mechanic } from "../core/schemas.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  operationInputs,
  operationOutputs,
  FIP_PROFILE,
  GameDesignAnalysis,
  GameDesignRequest,
  type AgentOperation,
  type DesignRequest,
  type DesignAnalysis,
  CapabilityDescriptor,
  Confidence,
} from "./contracts.js";
import {
  DesignKnowledgeEngine,
  AnalysisEngine,
  RecommendationEngine,
  EvaluationEngine,
  stableId,
  type Checks,
} from "./engines.js";
import {
  ProjectHistory,
  bounded,
  type ChroniclerAdapter,
  type PublishAuthorization,
} from "./chronicler.js";
import { type KnowledgeRegistry } from "../core/knowledge.js";
export interface AgentApiOptions {
  knowledge?: KnowledgeRegistry;
  chronicler?: ChroniclerAdapter;
  authorizePublish?: PublishAuthorization;
  chroniclerTimeoutMs?: number;
  now?: () => Date;
}
const descriptions: Record<
  AgentOperation,
  [z.infer<typeof CapabilityDescriptor>["engine"], string]
> = {
  get_capabilities: [
    "integration",
    "Discover this API profile, schemas and execution limits.",
  ],
  list_lenses: ["knowledge", "List relevant enabled lenses."],
  get_lens: ["knowledge", "Load one enabled lens and its source provenance."],
  analyze_concept: [
    "analysis",
    "Inspect concept goals and supplied formal mechanics.",
  ],
  analyze_mechanic: [
    "analysis",
    "Inspect action/rule/state/experience links and revise using supplied evidence.",
  ],
  analyze_game_loop: [
    "analysis",
    "Check explicitly declared loop transitions and reachability.",
  ],
  evaluate_player_agency: [
    "evaluation",
    "Check formal alternatives, consequences and scalar dominance with limitations.",
  ],
  analyze_progression: [
    "analysis",
    "Check prerequisite order, practice and variation.",
  ],
  analyze_balance: [
    "evaluation",
    "Run a bounded seeded resource model against explicit invariants.",
  ],
  evaluate_systems: [
    "analysis",
    "Inspect bounded graph interactions and possible feedback.",
  ],
  review_gdd: ["analysis", "Review caller-classified GDD structural coverage."],
  generate_alternatives: [
    "recommendation",
    "Produce editable prototype candidates; no LLM or author decision replacement.",
  ],
  formulate_playtest: [
    "recommendation",
    "Create a falsifiable, history-aware experiment proposal.",
  ],
  evaluate_playtest: [
    "evaluation",
    "Summarize supplied observations, distinguish origins and compare linked criteria.",
  ],
  compare_designs: [
    "evaluation",
    "Compare submitted specifications under structural checks, without an overall quality score.",
  ],
  publish_analysis: [
    "integration",
    "Preview or explicitly publish through a host-authorized Chronicler adapter.",
  ],
};
export const agentCapabilities = Object.entries(descriptions).map(
  ([operation, [engine, description]]) => ({
    operation,
    engine,
    description,
    input_schema: `contracts/fip/v1/operations/${operation}.input.schema.json`,
    output_schema: `contracts/fip/v1/operations/${operation}.output.schema.json`,
    execution: "bounded_sync" as const,
    read_only: operation !== "publish_analysis",
  }),
);
const confidence = (
  rationale: string,
  level: "low" | "medium" | "high" | "unknown" = "medium",
): z.infer<typeof Confidence> => ({ level, rationale, calibrated: false });
const normalize = (x: string) =>
  x.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export class LudoscopeAgentApi {
  private constructor(
    private knowledge: DesignKnowledgeEngine,
    private options: AgentApiOptions,
  ) {}
  static async create(options: AgentApiOptions = {}) {
    if (
      options.chroniclerTimeoutMs !== undefined &&
      (!Number.isFinite(options.chroniclerTimeoutMs) ||
        options.chroniclerTimeoutMs < 1 ||
        options.chroniclerTimeoutMs > 10000)
    )
      throw new Error("chroniclerTimeoutMs must be 1..10000");
    return new LudoscopeAgentApi(
      options.knowledge
        ? new DesignKnowledgeEngine(options.knowledge)
        : await DesignKnowledgeEngine.create(),
      options,
    );
  }
  capabilities() {
    return agentCapabilities;
  }
  call<N extends AgentOperation>(
    name: N,
    input: z.input<(typeof operationInputs)[N]>,
  ) {
    return this.invoke(name, input);
  }
  private base(r: DesignRequest) {
    const { context, ...envelope } = r;
    return {
      ...envelope,
      timestamp: (this.options.now?.() ?? new Date()).toISOString(),
      profile: FIP_PROFILE,
      status: "completed" as "completed" | "partial" | "error",
      confidence: confidence(
        "Qualitative assessment of specified checks and source alignment; not calibrated probability.",
      ),
    };
  }
  private async history(r: DesignRequest) {
    if (!this.options.chronicler)
      return {
        data: undefined,
        limitations: [
          "Chronicler is not configured; historical decisions, rejections and experiments may be incomplete.",
        ],
      };
    try {
      const data = ProjectHistory.parse(
        await bounded(
          (signal) => this.options.chronicler!.getProjectContext(r, signal),
          this.options.chroniclerTimeoutMs ?? 1000,
        ),
      );
      if (
        data.project_id !== r.project_id ||
        data.decisions.some((d) =>
          d.artifact_refs.some((a) => a.project_id !== r.project_id),
        )
      )
        throw new Error("Cross-project history rejected");
      return { data, limitations: [] as string[] };
    } catch {
      return {
        data: undefined,
        limitations: [
          "Chronicler unavailable, timed out or returned invalid/cross-project data; using submitted context only.",
        ],
      };
    }
  }
  async invoke<N extends AgentOperation>(
    name: N,
    input: unknown,
  ): Promise<z.output<(typeof operationOutputs)[N]>> {
    if (!Object.hasOwn(operationInputs, name))
      throw new Error("Unknown API operation");
    // Bounded JSON-only input. Source and artifact text are never evaluated or fetched.
    if (Buffer.byteLength(JSON.stringify(input) ?? "") > 2 * 1024 * 1024)
      throw new Error("API request exceeds 2 MiB");
    const a = operationInputs[name].parse(input);
    const r = a.request;
    const base = this.base(r);
    if (r.artifact_refs.some((ref) => ref.project_id !== r.project_id))
      throw new Error("Cross-project artifact rejected");
    const prior =
      name === "analyze_mechanic"
        ? operationInputs.analyze_mechanic.parse(input).prior_analysis
        : name === "evaluate_playtest"
          ? operationInputs.evaluate_playtest.parse(input).prior_analysis
          : undefined;
    if (prior) this.checkIdentity(r, prior);
    let output: unknown;
    if (name === "get_capabilities")
      output = { ...base, capabilities: this.capabilities() };
    else if (name === "list_lenses") {
      const args = operationInputs.list_lenses.parse(input);
      output = {
        ...base,
        lenses: this.knowledge.lenses(r, args.query, args.limit),
      };
    } else if (name === "get_lens") {
      const args = operationInputs.get_lens.parse(input);
      const entry = this.knowledge.knowledge
        .get([args.lens_id], r.context)
        .entries.find((e) => e.kind === "Lens");
      if (!entry) throw new Error("Enabled lens not found");
      output = { ...base, lenses: [this.knowledge.lens(entry)] };
    } else if (name === "publish_analysis") {
      const args = operationInputs.publish_analysis.parse(input);
      this.checkIdentity(r, args.analysis);
      let state: "preview" | "denied" | "unavailable" | "published" = "preview";
      let receipt_id: string | undefined;
      if (args.commit) {
        if (!this.options.chronicler) {
          state = "unavailable";
          base.status = "partial";
        } else if (
          !this.options.authorizePublish ||
          !(await bounded(
            () =>
              Promise.resolve(this.options.authorizePublish!(r, args.analysis)),
            this.options.chroniclerTimeoutMs ?? 1000,
          ))
        ) {
          state = "denied";
          base.status = "error";
        } else {
          try {
            const receipt = z
              .strictObject({ receipt_id: z.string().min(1).max(160) })
              .parse(
                await bounded(
                  (signal) =>
                    this.options.chronicler!.publishAnalysis(
                      args.analysis,
                      signal,
                    ),
                  this.options.chroniclerTimeoutMs ?? 1000,
                ),
              );
            receipt_id = receipt.receipt_id;
            state = "published";
          } catch {
            state = "unavailable";
            base.status = "partial";
          }
        }
      }
      output = {
        ...base,
        publication: {
          state,
          analysis_id: args.analysis.analysis_id,
          ...(receipt_id ? { receipt_id } : {}),
        },
      };
    } else output = await this.analyze(name, input, r, base);
    return operationOutputs[name].parse(output) as z.output<
      (typeof operationOutputs)[N]
    >;
  }
  failure<N extends AgentOperation>(
    name: N,
    input: unknown,
    error: unknown,
  ): z.output<(typeof operationOutputs)[N]> {
    const request = operationInputs[name].parse(input).request;
    const base = {
      ...this.base(request),
      status: "error" as const,
      error: {
        code: "API_ERROR",
        message:
          error instanceof Error
            ? error.message.slice(0, 4000)
            : "Unknown API error",
      },
    };
    const body =
      name === "get_capabilities"
        ? { ...base, capabilities: [] }
        : name === "get_lens" || name === "list_lenses"
          ? { ...base, lenses: [] }
          : name === "publish_analysis"
            ? {
                ...base,
                publication: {
                  state: "denied",
                  analysis_id:
                    operationInputs.publish_analysis.parse(input).analysis
                      .analysis_id,
                },
              }
            : {
                ...base,
                analysis_id: `analysis.${randomUUID()}`,
                context: request.context,
                lenses: [],
                findings: [],
                problems: [],
                recommendations: [],
                alternatives: [],
                hypotheses: [],
                validation: [],
                history: {
                  available: false,
                  limitations: [
                    "Operation failed; no analysis result is asserted.",
                  ],
                  decision_ids: [],
                  rejected_alternative_ids: [],
                  experiment_ids: [],
                },
                markdown: "Operation failed; see structured error.",
              };
    return operationOutputs[name].parse(body) as z.output<
      (typeof operationOutputs)[N]
    >;
  }
  private checkIdentity(r: DesignRequest, analysis: DesignAnalysis) {
    if (analysis.project_id !== r.project_id || analysis.task_id !== r.task_id)
      throw new Error(
        "Analysis project_id/task_id must match the current request",
      );
    if (analysis.artifact_refs.some((a) => a.project_id !== r.project_id))
      throw new Error("Cross-project analysis artifact");
  }
  private async analyze(
    name: AgentOperation,
    input: unknown,
    r: DesignRequest,
    base: ReturnType<LudoscopeAgentApi["base"]>,
  ) {
    const history = await this.history(r);
    const a = operationInputs[name].parse(input);
    const priorAnalysis =
      name === "analyze_mechanic"
        ? operationInputs.analyze_mechanic.parse(input).prior_analysis
        : name === "evaluate_playtest"
          ? operationInputs.evaluate_playtest.parse(input).prior_analysis
          : undefined;
    const analysisEngine = new AnalysisEngine(this.knowledge),
      recommendation = new RecommendationEngine();
    const checks: Checks =
      name === "evaluate_playtest"
        ? new EvaluationEngine().evaluate(input)
        : await analysisEngine.run(name, input, r);
    if (priorAnalysis?.evaluation && !checks.evaluation)
      checks.evaluation = priorAnalysis.evaluation;
    const query = [
      r.context.subject,
      ...r.context.tags,
      ...r.context.author_goals,
      name === "analyze_progression" ? "learning mastery patterns" : "",
      "mechanic" in a ? Mechanic.parse(a.mechanic).name : "",
      "concept" in a ? a.concept : "",
    ].join(" ");
    const lenses = this.knowledge.lenses(r, query);
    const knowledge = this.knowledge.search(r, query);
    const sourceEvidence = [
      ...lenses.flatMap((l) => l.evidence),
      ...knowledge.flatMap((e) => this.knowledge.evidence(e)),
    ];
    const inputEvidence = {
      id: stableId("evidence", r.request_id + name),
      kind: "artifact" as const,
      claim_type: "UNVERIFIED" as const,
      locator: `MCP/API ${name}; request_id=${r.request_id}`,
      description:
        "Caller-submitted specification, conditions and observations; not independently authenticated.",
      limitations: [
        "Completeness, implementation fidelity and collection provenance require external verification.",
      ],
    };
    const computedEvidence = [...checks.findings, ...checks.problems]
      .filter((c) => c.claim_type && c.claim_type !== "EXPERT_INFERENCE")
      .map((c) => ({
        id: stableId("evidence", r.request_id + name + c.message),
        kind:
          c.claim_type === "MODEL_RESULT"
            ? ("model" as const)
            : c.claim_type === "PLAYTEST_OBSERVATION"
              ? ("playtest" as const)
              : ("artifact" as const),
        claim_type: c.claim_type!,
        locator: `${name}; request_id=${r.request_id}`,
        description: c.message.slice(0, 4000),
        limitations: [
          "Result applies only to submitted rules/data; collection provenance is caller-supplied.",
        ],
      }));
    const computedIds = computedEvidence.slice(0, 100).map((e) => e.id);
    const evidence = [
      ...new Map(
        [
          inputEvidence,
          ...computedEvidence.slice(0, 100),
          ...r.evidence,
          ...(priorAnalysis?.evidence ?? []),
          ...sourceEvidence,
        ].map((e) => [e.id, e]),
      ).values(),
    ].slice(0, 200);
    const findings = checks.findings.map((c, i) => ({
      id: stableId("finding", r.request_id + name + i),
      claim: c.message,
      claim_type: c.claim_type ?? "EXPERT_INFERENCE",
      evidence_ids: [inputEvidence.id, ...computedIds],
      assumptions: ["Only explicitly supplied rules/data are checked."],
      limitations: ["Not a proof of intended player experience."],
      confidence: confidence(
        "Reproducible structural/descriptive check; incomplete world and player context.",
      ),
      validation_method: c.validation,
    }));
    const problems = checks.problems.map((c, i) => ({
      id: stableId("problem", r.request_id + name + i),
      claim: c.message,
      claim_type: c.claim_type ?? "EXPERT_INFERENCE",
      evidence_ids: [inputEvidence.id, ...computedIds],
      assumptions: [
        "Absence from submitted data may reflect incomplete documentation or an intentional author tradeoff.",
      ],
      limitations: ["A structural gap is not automatically a defect."],
      confidence: confidence(
        "Potential issue in submitted representation; author intent and actual behavior remain to be checked.",
        "low",
      ),
      validation_method: c.validation,
    }));
    const hypotheses = [
      {
        id: stableId(
          "hypothesis",
          r.project_id + (r.task_id || "") + r.context.subject,
        ),
        statement:
          `For ${r.context.subject}, the proposed rule/feedback change will support ${r.context.author_goals.join("; ") || "the author-defined experience"} under the specified conditions.`.slice(
            0,
            4000,
          ),
        claim_type: "DESIGN_HYPOTHESIS" as const,
        falsification:
          "Observed behavior contradicts the predeclared criterion or author experience goal.",
        metric:
          "Task decisions, interpretation errors and separately recorded subjective feedback.",
      },
    ];
    let validation = [
      recommendation.experiment(
        r,
        hypotheses[0].id,
        `How does ${r.context.subject} support the intended experience?`,
        [
          "Observable choices and consequences",
          "Rule interpretation errors",
          "Subjective experience reported separately",
        ],
        "Real participants to be recruited; no sample size or observations claimed.",
        "Define success/failure thresholds before collecting data; account for order, prior experience and confounds.",
      ),
    ];
    if (name === "formulate_playtest") {
      const args = operationInputs.formulate_playtest.parse(input);
      hypotheses.splice(0, hypotheses.length, args.hypothesis);
      validation = [
        recommendation.experiment(
          r,
          args.hypothesis.id,
          args.hypothesis.statement,
          args.metrics,
          args.participants,
          args.interpretation,
          args.method,
          args.conditions,
        ),
      ];
    }
    for (const proposal of validation) {
      const prior =
        history.data?.experiments.filter(
          (e) => normalize(e.question) === normalize(proposal.question),
        ) ?? [];
      proposal.prior_experiment_ids = prior.map((e) => e.id);
      if (prior.length) {
        proposal.repeat_rationale =
          "An exact normalized research question already exists. Review its result and specify a new condition or replication reason before repeating.";
        proposal.limitations.push(
          "Potential duplicate research; this engine does not establish semantic equivalence.",
        );
        for (const previous of prior)
          proposal.limitations.push(
            `Prior ${previous.id}: ${previous.result}`.slice(0, 4000),
          );
      }
    }
    for (const decision of history.data?.decisions ?? [])
      findings.push({
        id: stableId("finding", r.request_id + decision.id),
        claim: `Historical decision ${decision.id}: ${decision.decision}`.slice(
          0,
          4000,
        ),
        claim_type: "EXPERT_INFERENCE",
        evidence_ids: [inputEvidence.id],
        assumptions: [
          "History was returned by the configured adapter; author decisions remain authoritative unless explicitly revised.",
        ],
        limitations: ["No semantic compatibility proof is claimed."],
        confidence: confidence(
          "Historical context supplied through a validated project-scoped adapter.",
        ),
        validation_method:
          "Check any proposed variant against this decision before engineering handoff.",
      });
    const recommendations = problems.slice(0, 50).map((p) => ({
      id: stableId("recommendation", p.id),
      action: p.validation_method,
      priority: "medium" as const,
      expected_consequences: [
        "Reduce this explicit uncertainty if the change is compatible with the author intent.",
      ],
      tradeoffs: [
        "Retain deliberate complexity, ritual or uncertainty when required by creative principles.",
      ],
      evidence_ids: p.evidence_ids,
      hypothesis_ids: [hypotheses[0].id],
      confidence: p.confidence,
      status: "proposed" as const,
    }));
    if (!recommendations.length)
      recommendations.push({
        id: stableId("recommendation", r.request_id + name),
        action:
          "Keep the authored baseline and test the intended experience before adopting a change.",
        priority: "medium",
        expected_consequences: [
          "Obtain evidence without automatically adding mechanics.",
        ],
        tradeoffs: [
          "Requires prototype/testing effort; structural completeness does not establish quality.",
        ],
        evidence_ids: [inputEvidence.id],
        hypothesis_ids: [hypotheses[0].id],
        confidence: confidence(
          "Evidence is insufficient to prescribe a creative direction.",
          "low",
        ),
        status: "proposed",
      });
    let alternatives: z.infer<
      typeof import("./contracts.js").DesignAlternative
    >[] = [];
    if ("mechanic" in a)
      alternatives = recommendation.alternatives(
        a.mechanic,
        name === "generate_alternatives"
          ? operationInputs.generate_alternatives.parse(input).allowed_changes
          : ["feedback", "contextual_choice"],
      );
    if (history.data) {
      for (const decision of history.data.decisions)
        for (const rec of recommendations)
          if (rec.tradeoffs.length < 100)
            rec.tradeoffs.push(
              `Review against approved ${decision.id}: ${decision.decision}`.slice(
                0,
                4000,
              ),
            );
      const rejected = history.data.rejected_alternatives;
      const removed = alternatives.filter((alt) =>
        rejected.some(
          (old) =>
            old.id === alt.id || normalize(old.title) === normalize(alt.title),
        ),
      );
      alternatives = alternatives.filter((alt) => !removed.includes(alt));
      for (const old of rejected)
        if (
          removed.some(
            (alt) =>
              old.id === alt.id ||
              normalize(old.title) === normalize(alt.title),
          )
        )
          problems.push({
            id: stableId("problem", r.request_id + old.id),
            claim:
              `Previously rejected candidate excluded: ${old.title}. Reason: ${old.reason}`.slice(
                0,
                4000,
              ),
            claim_type: "EXPERT_INFERENCE",
            evidence_ids: [inputEvidence.id],
            assumptions: [
              "Exact ID/title matching only; alternative titles may hide equivalent variants.",
            ],
            limitations: ["No semantic equivalence detector."],
            confidence: confidence(
              "Exact history match, not a universal design rule.",
            ),
            validation_method:
              "Reopen only with changed conditions and explicit author approval.",
          });
    }
    if (priorAnalysis) {
      const prior = priorAnalysis;
      findings.push({
        id: stableId("finding", r.request_id + "revision"),
        claim: `Revisited ${prior.analysis_id}; prior recommendations remain proposals. ${"evaluation" in checks && checks.evaluation ? (name === "evaluate_playtest" ? "New submitted observations have been descriptively evaluated." : "The previously supplied evaluation is carried forward; no new observations are claimed.") : "No new observed player behavior was supplied."}`,
        claim_type: "EXPERT_INFERENCE",
        evidence_ids: [inputEvidence.id],
        assumptions: [
          "Prior analysis is caller-supplied and belongs to the same project/task.",
        ],
        limitations: [
          "No automatic promotion of hypotheses into verified facts.",
        ],
        confidence: confidence(
          "Revision preserves prior IDs and distinguishes new data from inference.",
        ),
        validation_method:
          "Compare linked hypotheses and observed outcomes, then authorize a new decision separately.",
      });
      if (checks.evaluation)
        for (const outcome of checks.evaluation.hypothesis_outcomes)
          recommendations.push({
            id: stableId(
              "recommendation",
              r.request_id + outcome.hypothesis_id,
            ),
            action:
              outcome.status === "descriptively_contradicted"
                ? `Revisit ${outcome.hypothesis_id}; retain the baseline and test a changed variant before adoption.`
                : `Review ${outcome.hypothesis_id} with its collection limitations before another iteration.`,
            priority: "medium",
            expected_consequences: [
              "Use actual submitted outcomes in the next design iteration.",
            ],
            tradeoffs: ["Descriptive support is not causal confirmation."],
            evidence_ids: [inputEvidence.id],
            hypothesis_ids: [outcome.hypothesis_id],
            confidence: confidence(outcome.rationale, "low"),
            status: "proposed",
          });
    }
    if (checks.evaluation) {
      for (const id of new Set(
        checks.evaluation.hypothesis_outcomes.map((o) => o.hypothesis_id),
      )) {
        if (hypotheses.some((h) => h.id === id)) continue;
        const prior = priorAnalysis?.hypotheses.find((h) => h.id === id);
        if (prior) hypotheses.push(prior);
      }
    }
    const result = GameDesignAnalysis.parse({
      ...base,
      status: history.data ? "completed" : "partial",
      analysis_id: `analysis.${randomUUID()}`,
      context: r.context,
      lenses,
      findings: findings.slice(0, 200),
      problems: problems.slice(0, 200),
      recommendations: recommendations.slice(0, 100),
      alternatives,
      hypotheses: hypotheses.slice(0, 100),
      validation,
      evidence,
      history: {
        available: !!history.data,
        limitations: history.limitations,
        decision_ids: history.data?.decisions.map((d) => d.id) ?? [],
        rejected_alternative_ids:
          history.data?.rejected_alternatives.map((d) => d.id) ?? [],
        experiment_ids: history.data?.experiments.map((e) => e.id) ?? [],
      },
      ...(checks.evaluation ? { evaluation: checks.evaluation } : {}),
      markdown: "",
    });
    result.markdown = renderAnalysis(result);
    return result;
  }
}
export function renderAnalysis(r: DesignAnalysis) {
  const lines = [
    `# ${r.context.subject}`,
    `Project: ${r.project_id}; task: ${r.task_id ?? "unspecified"}; request: ${r.request_id}`,
    `## Context`,
    JSON.stringify(r.context),
    `## Lenses`,
    ...r.lenses.map(
      (l) => `- ${l.id}: ${l.title}; sources: ${l.source_ids.join(", ")}`,
    ),
    `## Findings`,
    ...r.findings.map((f) => `- [${f.claim_type}] ${f.claim}`),
    `## Problems`,
    ...r.problems.map((f) => `- [${f.claim_type}] ${f.claim}`),
    `## Recommendations`,
    ...r.recommendations.map((x) => `- ${x.id} (${x.priority}): ${x.action}`),
    `## Alternatives`,
    ...r.alternatives.map(
      (x) => `- ${x.id}: ${x.title}. ${x.changes.join(" ")}`,
    ),
    `## Hypotheses`,
    ...r.hypotheses.map((x) => `- ${x.id}: ${x.statement}`),
    `## Validation`,
    ...r.validation.map((x) => `- ${x.id}: ${x.question}; ${x.interpretation}`),
    `## Evidence`,
    ...r.evidence.map(
      (e) =>
        `- ${e.id} [${e.claim_type}]: ${e.description}; ${e.locator}${e.uri ? `; ${e.uri}` : ""}`,
    ),
    `## Confidence`,
    `${r.confidence.level}: ${r.confidence.rationale}`,
    `## History`,
    ...r.history.limitations,
  ];
  return lines.join("\n\n").slice(0, 200000);
}
