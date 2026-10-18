import { z } from "zod";
import {
  Text,
  Strings,
  Id,
  Entry,
  Claim,
  Mechanic,
  Graph,
  Model,
  Experiment,
  Observation,
  Project,
  Decision,
} from "./schemas.js";
const obj = z.strictObject,
  n = z.number().finite(),
  str = z.string(),
  arr = Strings,
  flag = z.boolean(),
  amounts = z.record(str, n),
  modelResult = z.literal("MODEL_RESULT"),
  inference = z.literal("EXPERT_INFERENCE");
const limits = { limitations: arr };
const Violation = obj({
  step: n,
  resource: Id,
  value: n,
  min: n.optional(),
  max: n.optional(),
});
const Sim = obj({
  claim_type: modelResult,
  model: Model,
  seed: n,
  final: amounts,
  executions: amounts,
  violations: z.array(Violation),
  stopped_early: flag,
  trajectory: z.array(obj({ step: n, resources: amounts })),
  ...limits,
});
const Scan = obj({
  revision: str.nullable(),
  files: z.array(obj({ path: str, sha256: str, size: n, category: str })),
  engine_evidence: z.array(
    obj({
      file: str,
      sha256: str,
      claim_type: z.literal("PROJECT_FACT"),
      claim: str,
    }),
  ),
  skipped: arr,
  bytes: n,
  ...limits,
});
const Context = obj({
  artifact_index: z.array(obj({ kind: str, id: Id, version: n, path: str })),
  profile: Project,
  vision: str,
  principles: str,
  graph: Graph,
  decisions: z.array(Decision),
  source_trust: str,
});
const MechanicAnalysis = obj({
  schema_version: z.literal("1.0"),
  mechanic: Mechanic,
  findings: z.array(Claim),
  knowledge: z.array(Entry),
  conflicts: z.array(obj({ entry: Id, conflicts_with: Id })),
  affected_systems: arr,
  experience_chain: obj({
    actions: arr,
    rules: arr,
    state_changes: arr,
    feedback: arr,
    experience_hypotheses: arr,
  }),
  decision_status: z.literal("draft"),
  reasoning_tasks: arr,
  experiment: obj({
    question: str,
    hypothesis_type: z.literal("DESIGN_HYPOTHESIS"),
    method: str,
    metrics: arr,
    ...limits,
  }),
  intentional_tradeoffs: arr,
  ...limits,
});
const RuleResult = obj({
  claim_type: modelResult,
  reachable: arr,
  unreachable: arr,
  deadlocks: arr,
  no_terminal_path: arr,
  ambiguous_actions: z.array(obj({ from: Id, to: Id, action: Id })),
  ...limits,
});
const Summary = obj({ min: n, max: n, mean: n });
export const resultSchemas = {
  ludoscope_record_artifact: obj({ path: str, diff: str, written: flag }),
  ludoscope_update_graph: obj({
    path: str,
    expected_sha256: str,
    diff: str,
    written: flag,
  }),
  ludoscope_project_scan: Scan,
  ludoscope_project_context: Context,
  ludoscope_knowledge_search: z.array(Entry),
  ludoscope_get_lenses: z.array(Entry.extend({ bound_questions: arr })),
  ludoscope_analyse_mechanic: MechanicAnalysis,
  ludoscope_analyse_dependencies: obj({
    changed: Id,
    affected: z.array(Graph.shape.nodes.element),
    paths: z.record(str, arr),
    limitation: str,
    mermaid: str,
  }),
  ludoscope_validate_rules: RuleResult,
  ludoscope_analyse_economy: obj({
    claim_type: modelResult,
    expected_unconstrained_net_per_tick: amounts,
    free_sources: arr,
    gain_witnesses: z.array(obj({ processes: arr, net: amounts })),
    searched_combinations: n,
    ...limits,
  }),
  ludoscope_simulate_system: Sim,
  ludoscope_compare_variants: z.array(
    obj({
      model_id: Id,
      claim_type: modelResult,
      runs: z.array(
        obj({ seed: n, final: amounts, violations: z.array(Violation) }),
      ),
      summary: z.record(str, Summary),
      ...limits,
    }),
  ),
  ludoscope_design_experiment: Experiment.extend({
    status: z.literal("draft"),
    claim_type: z.literal("DESIGN_HYPOTHESIS"),
    checklist: arr,
  }),
  ludoscope_evaluate_playtest: obj({
    claim_type: z.literal("PLAYTEST_OBSERVATION"),
    participants: n,
    rows: n,
    measurements: z.record(str, Summary.extend({ rows: n, participants: n })),
    observations: z.array(Observation),
    subjective: z.array(Observation),
    hypotheses: arr,
    ...limits,
  }),
  ludoscope_generate_report: obj({
    format: z.literal("markdown"),
    content: str,
  }),
  ludoscope_check_consistency: obj({
    valid: z.literal(true),
    nodes: n,
    decisions: n,
    ...limits,
  }),
  ludoscope_record_decision: obj({ path: str, diff: str, written: flag }),
  ludoscope_mastery_analysis: obj({
    claim_type: inference,
    issues: arr,
    ...limits,
  }),
  ludoscope_ux_review: obj({
    claim_type: inference,
    needs_artifacts: flag,
    gaps: arr,
    game_feel: obj({
      measured_latency_ms: n.nullable(),
      questions: arr,
      limitation: str,
    }),
    ...limits,
  }),
  ludoscope_narrative_consistency: obj({
    claim_type: modelResult,
    explored_states: n,
    unreachable_events: arr,
    canon_violations: z.array(obj({ path: arr, state: z.record(str, flag) })),
    truncated: flag,
    ...limits,
  }),
  ludoscope_procedural_review: obj({
    claim_type: modelResult,
    sample_size: n,
    patterns: amounts,
    invalid: arr,
    largest_pattern_share: n,
    ...limits,
  }),
  ludoscope_sensitivity_analysis: z.array(
    obj({ multiplier: n, final: amounts, violations: z.array(Violation) }),
  ),
  ludoscope_analyse_systems: obj({
    feedback_components: z.array(
      obj({
        nodes: arr,
        edges: z.array(Graph.shape.edges.element),
        claim_type: inference,
        interpretation: str,
      }),
    ),
    interaction_chains: z.array(arr),
    experience_links: z.array(Graph.shape.edges.element),
    scenario_tasks: arr,
    ...limits,
  }),
};
