import { z } from "zod";
import {
  Mechanic,
  Graph,
  Model,
  Observation,
  Status,
} from "../core/schemas.js";
import { Learning } from "../analysis/labs.js";
// Provisional local profile; not an assertion of ratified Chronicler compatibility.
export const FIP_PROFILE = "ludoscope.fip-v1-draft.1" as const;
export const RefId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const Line = z.string().min(1).max(4000);
const Lines = z.array(Line).max(100);
export const Confidence = z.strictObject({
  level: z.enum(["low", "medium", "high", "unknown"]),
  rationale: Line,
  calibrated: z.literal(false),
});
export const ArtifactReference = z.strictObject({
  id: RefId,
  project_id: RefId,
  kind: Line,
  uri: z.string().max(2000).optional(),
  revision: Line.optional(),
  description: Line,
});
export const EvidenceReference = z.strictObject({
  id: RefId,
  kind: z.enum(["source", "artifact", "model", "playtest", "inference"]),
  claim_type: Status,
  source_id: RefId.optional(),
  artifact_id: RefId.optional(),
  uri: z.string().max(2000).optional(),
  locator: Line,
  description: Line,
  limitations: Lines,
});
export const Envelope = z.strictObject({
  api_version: z.literal("1.0"),
  request_id: RefId,
  project_id: RefId,
  task_id: RefId.optional(),
  session_id: RefId.optional(),
  agent_id: RefId.optional(),
  timestamp: z.iso.datetime(),
  artifact_refs: z.array(ArtifactReference).max(100).default([]),
  evidence: z.array(EvidenceReference).max(200).default([]),
});
export const Context = z.strictObject({
  subject: Line,
  genre: z.string().max(200).default(""),
  audience: z.string().max(1000).default(""),
  author_goals: Lines.default([]),
  creative_principles: Lines.default([]),
  constraints: Lines.default([]),
  tags: Lines.default([]),
  system_types: Lines.default([]),
  disabled_sources: Lines.default([]),
  disabled_schools: Lines.default([]),
});
export const GameDesignRequest = Envelope.extend({
  status: z.literal("submitted"),
  context: Context,
});
export const LensReference = z.strictObject({
  id: RefId,
  title: Line,
  description: Line,
  questions: Lines,
  source_ids: z.array(RefId).max(50),
  evidence: z.array(EvidenceReference).max(100),
  interpretation: Line,
  limitations: Lines,
});
export const DesignHypothesis = z.strictObject({
  id: RefId,
  statement: Line,
  claim_type: z.literal("DESIGN_HYPOTHESIS"),
  falsification: Line,
  metric: Line,
});
export const ExperimentProposal = z.strictObject({
  id: RefId,
  hypothesis_ids: z.array(RefId).max(100),
  question: Line,
  method: z.enum(["playtest", "simulation", "inspection"]),
  participants: Line,
  conditions: Lines,
  metrics: Lines.min(1),
  interpretation: Line,
  limitations: Lines,
  prior_experiment_ids: z.array(RefId).max(100),
  repeat_rationale: Line.optional(),
});
export const Finding = z.strictObject({
  id: RefId,
  claim: Line,
  claim_type: Status,
  evidence_ids: z.array(RefId).max(200),
  assumptions: Lines,
  limitations: Lines,
  confidence: Confidence,
  validation_method: Line,
});
export const GameDesignRecommendation = z.strictObject({
  id: RefId,
  action: Line,
  priority: z.enum(["high", "medium", "low"]),
  expected_consequences: Lines,
  tradeoffs: Lines,
  evidence_ids: z.array(RefId).max(200),
  hypothesis_ids: z.array(RefId).max(100),
  confidence: Confidence,
  status: z.literal("proposed"),
});
export const DesignAlternative = z.strictObject({
  id: RefId,
  title: Line,
  changes: Lines,
  tradeoffs: Lines,
  mechanic: Mechanic.optional(),
  status: z.literal("candidate"),
  claim_type: z.literal("DESIGN_HYPOTHESIS"),
});
export const PlaytestEvaluation = z.strictObject({
  data_origin: z.enum(["human_playtest", "simulation", "engineering_test"]),
  claim_type: z.enum(["PLAYTEST_OBSERVATION", "MODEL_RESULT", "PROJECT_FACT"]),
  participants: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  metrics: z
    .array(
      z.strictObject({
        metric: RefId,
        count: z.number().int().positive(),
        min: z.number(),
        max: z.number(),
        mean: z.number(),
      }),
    )
    .max(100),
  hypothesis_outcomes: z
    .array(
      z.strictObject({
        hypothesis_id: RefId,
        status: z.enum([
          "descriptively_supported",
          "descriptively_contradicted",
          "inconclusive",
        ]),
        rationale: Line,
      }),
    )
    .max(100),
  limitations: Lines,
});
export const CapabilityDescriptor = z.strictObject({
  operation: RefId,
  engine: z.enum([
    "knowledge",
    "analysis",
    "recommendation",
    "evaluation",
    "integration",
  ]),
  description: Line,
  input_schema: Line,
  output_schema: Line,
  execution: z.literal("bounded_sync"),
  read_only: z.boolean(),
});
export const ResponseBase = Envelope.extend({
  status: z.enum(["completed", "partial", "error"]),
  profile: z.literal(FIP_PROFILE),
  confidence: Confidence,
  error: z.strictObject({ code: Line, message: Line }).optional(),
});
export const GameDesignAnalysis = ResponseBase.extend({
  analysis_id: RefId,
  context: Context,
  lenses: z.array(LensReference).max(10),
  findings: z.array(Finding).max(200),
  problems: z.array(Finding).max(200),
  recommendations: z.array(GameDesignRecommendation).max(100),
  alternatives: z.array(DesignAlternative).max(20),
  hypotheses: z.array(DesignHypothesis).max(100),
  validation: z.array(ExperimentProposal).max(100),
  history: z.strictObject({
    available: z.boolean(),
    limitations: Lines,
    decision_ids: z.array(RefId).max(100),
    rejected_alternative_ids: z.array(RefId).max(100),
    experiment_ids: z.array(RefId).max(100),
  }),
  evaluation: PlaytestEvaluation.optional(),
  markdown: z.string().max(200000),
});
const common = { request: GameDesignRequest };
const WithMechanic = z.strictObject({ ...common, mechanic: Mechanic });
const Prior = { prior_analysis: GameDesignAnalysis.optional() };
export const operationInputs = {
  get_capabilities: z.strictObject(common),
  list_lenses: z.strictObject({
    ...common,
    query: z.string().max(4000).default(""),
    limit: z.number().int().min(1).max(10).default(10),
  }),
  get_lens: z.strictObject({ ...common, lens_id: RefId }),
  analyze_concept: z.strictObject({
    ...common,
    concept: Line,
    mechanics: z.array(Mechanic).max(10).default([]),
  }),
  analyze_mechanic: z.strictObject({ ...common, mechanic: Mechanic, ...Prior }),
  analyze_game_loop: z.strictObject({
    ...common,
    steps: z
      .array(
        z.strictObject({
          id: RefId,
          action: Line,
          state_change: z.string().max(4000),
          feedback: z.string().max(4000),
          next: z.array(RefId).max(30),
        }),
      )
      .min(1)
      .max(100),
  }),
  evaluate_player_agency: WithMechanic,
  analyze_progression: z.strictObject({ ...common, learning: Learning }),
  analyze_balance: z.strictObject({ ...common, model: Model }),
  evaluate_systems: z.strictObject({ ...common, graph: Graph }),
  review_gdd: z.strictObject({
    ...common,
    sections: z
      .array(
        z.strictObject({
          id: RefId,
          type: z.enum([
            "vision",
            "mechanics",
            "loop",
            "ux",
            "validation",
            "constraints",
            "other",
          ]),
          text: z.string().min(1).max(20000),
        }),
      )
      .min(1)
      .max(50),
  }),
  generate_alternatives: z.strictObject({
    ...common,
    mechanic: Mechanic,
    allowed_changes: z
      .array(z.enum(["feedback", "contextual_choice", "automation"]))
      .min(1)
      .max(3)
      .default(["feedback", "contextual_choice"]),
  }),
  formulate_playtest: z.strictObject({
    ...common,
    hypothesis: DesignHypothesis,
    method: z
      .enum(["playtest", "simulation", "inspection"])
      .default("playtest"),
    participants: Line,
    metrics: Lines.min(1),
    conditions: Lines.default([]),
    interpretation: Line,
  }),
  evaluate_playtest: z.strictObject({
    ...common,
    data_origin: z.enum(["human_playtest", "simulation", "engineering_test"]),
    observations: z.array(Observation).min(1).max(2000),
    criteria: z
      .array(
        z.strictObject({
          hypothesis_id: RefId,
          metric: RefId,
          operator: z.enum(["gte", "lte"]),
          threshold: z.number().finite(),
        }),
      )
      .max(100)
      .default([]),
    ...Prior,
  }),
  compare_designs: z.strictObject({
    ...common,
    designs: z
      .array(z.strictObject({ id: RefId, mechanic: Mechanic }))
      .min(2)
      .max(10),
  }),
  publish_analysis: z.strictObject({
    ...common,
    analysis: GameDesignAnalysis,
    commit: z.boolean().default(false),
  }),
};
export type AgentOperation = keyof typeof operationInputs;
const CapabilitiesResult = ResponseBase.extend({
  capabilities: z.array(CapabilityDescriptor).max(100),
});
const LensesResult = ResponseBase.extend({
  lenses: z.array(LensReference).max(10),
});
const PublicationResult = ResponseBase.extend({
  publication: z.strictObject({
    state: z.enum(["preview", "published", "denied", "unavailable"]),
    analysis_id: RefId,
    receipt_id: RefId.optional(),
  }),
});
export const operationOutputs = {
  get_capabilities: CapabilitiesResult,
  list_lenses: LensesResult,
  get_lens: LensesResult,
  analyze_concept: GameDesignAnalysis,
  analyze_mechanic: GameDesignAnalysis,
  analyze_game_loop: GameDesignAnalysis,
  evaluate_player_agency: GameDesignAnalysis,
  analyze_progression: GameDesignAnalysis,
  analyze_balance: GameDesignAnalysis,
  evaluate_systems: GameDesignAnalysis,
  review_gdd: GameDesignAnalysis,
  generate_alternatives: GameDesignAnalysis,
  formulate_playtest: GameDesignAnalysis,
  evaluate_playtest: GameDesignAnalysis,
  compare_designs: GameDesignAnalysis,
  publish_analysis: PublicationResult,
};
export type DesignRequest = z.infer<typeof GameDesignRequest>;
export type DesignAnalysis = z.infer<typeof GameDesignAnalysis>;
export const contractSchemas = {
  GameDesignRequest,
  GameDesignAnalysis,
  GameDesignRecommendation,
  LensReference,
  DesignHypothesis,
  ExperimentProposal,
  PlaytestEvaluation,
  EvidenceReference,
  ArtifactReference,
  CapabilityDescriptor,
  Confidence,
};
export type GameDesignRequest = z.infer<typeof GameDesignRequest>;
export type GameDesignAnalysis = z.infer<typeof GameDesignAnalysis>;
export type GameDesignRecommendation = z.infer<typeof GameDesignRecommendation>;
export type LensReference = z.infer<typeof LensReference>;
export type DesignHypothesis = z.infer<typeof DesignHypothesis>;
export type ExperimentProposal = z.infer<typeof ExperimentProposal>;
export type PlaytestEvaluation = z.infer<typeof PlaytestEvaluation>;
export type EvidenceReference = z.infer<typeof EvidenceReference>;
export type ArtifactReference = z.infer<typeof ArtifactReference>;
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptor>;
