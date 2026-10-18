import { z } from "zod";
export const Id = z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/);
export const Text = z.string().max(20000);
export const Strings = z.array(Text).max(500);
export const Status = z.enum([
  "VERIFIED_SOURCE",
  "PROJECT_FACT",
  "MODEL_RESULT",
  "PLAYTEST_OBSERVATION",
  "DESIGN_HYPOTHESIS",
  "EXPERT_INFERENCE",
  "UNVERIFIED",
]);
export const Source = z.strictObject({
  id: Id,
  version: z.number().int().positive(),
  title: Text,
  authors: Strings,
  year: z.number().int().optional(),
  edition: Text.optional(),
  url: z.url(),
  identifier: Text.optional(),
  verification_status: z.enum(["VERIFIED_SOURCE", "SOURCE_REQUIRED"]),
  accessed_at: Text,
  license: Text,
  notes: Text,
});
export const Entry = z.strictObject({
  id: Id,
  version: z.number().int().positive(),
  kind: z.enum([
    "Theory",
    "Principle",
    "Lens",
    "Heuristic",
    "ResearchMethod",
    "MetricDefinition",
    "ExperimentTemplate",
    "DesignPattern",
    "AntiPattern",
    "Counterexample",
    "TheoryConflict",
  ]),
  title: Text,
  description: Text,
  source_ids: z.array(Id),
  school: Text,
  tags: Strings,
  applicable_genres: Strings,
  applicable_stages: Strings,
  conditions: Strings,
  questions: Strings,
  recommendations: Strings,
  limitations: Strings,
  conflicting_entry_ids: z.array(Id),
  related_entry_ids: z.array(Id),
  verification_status: z.enum([
    "VERIFIED_SOURCE",
    "SOURCE_REQUIRED",
    "EXPERT_INFERENCE",
  ]),
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  evidence_locator: Text,
  interpretation: Text,
});
export const RegistrySchema = z.strictObject({
  schema_version: z.literal("1.0"),
  sources: z.array(Source).max(1000),
  entries: z.array(Entry).max(10000),
});
export const Claim = z.strictObject({
  claim: Text,
  claim_type: Status,
  evidence: Strings,
  assumptions: Strings,
  relevant_theories: Strings,
  limitations: Strings,
  alternatives: Strings,
  validation_method: Text,
  status: z.enum(["open", "supported", "contradicted"]),
});
export const Mechanic = z.strictObject({
  schema_version: z.literal("1.0").default("1.0"),
  id: Id,
  name: Text,
  player_goal: Text,
  player_actions: Strings,
  preconditions: Strings,
  rules: Strings,
  state_transitions: Strings,
  resources: Strings,
  feedback: Strings,
  failure_conditions: Strings,
  success_conditions: Strings,
  dependencies: z.array(Id),
  expected_experiences: Strings,
  design_risks: Strings,
  validation_plan: Strings,
  tags: Strings.default([]),
  genre: Text.default(""),
  stage: Text.default("prototype"),
  choices: z
    .array(
      z.strictObject({
        id: Id,
        consequences: Strings,
        cost: z.number().finite().optional(),
        benefit: z.number().finite().optional(),
      }),
    )
    .max(100)
    .default([]),
  intentional_tradeoffs: Strings.default([]),
});
export type MechanicType = z.infer<typeof Mechanic>;
export const NodeType = z.enum([
  "PlayerGoal",
  "PlayerAction",
  "Mechanic",
  "Rule",
  "Resource",
  "System",
  "GameState",
  "Feedback",
  "Dynamic",
  "ExperienceGoal",
  "NarrativeEvent",
  "ProgressionMilestone",
  "Constraint",
  "Metric",
  "Experiment",
  "Evidence",
  "DesignDecision",
]);
export const EdgeType = z.enum([
  "Enables",
  "Requires",
  "Produces",
  "Consumes",
  "Modifies",
  "Restricts",
  "ConflictsWith",
  "Reinforces",
  "Counters",
  "DependsOn",
  "Measures",
  "Validates",
  "Implements",
]);
export const Graph = z.strictObject({
  schema_version: z.literal("1.0"),
  nodes: z
    .array(
      z.strictObject({
        id: Id,
        type: NodeType,
        label: Text,
        files: Strings.default([]),
      }),
    )
    .max(5000),
  edges: z
    .array(
      z.strictObject({
        from: Id,
        to: Id,
        type: EdgeType,
        evidence: Text.default(""),
        status: Status.default("DESIGN_HYPOTHESIS"),
      }),
    )
    .max(20000),
});
export const Decision = z.strictObject({
  schema_version: z.literal("1.0").default("1.0"),
  id: Id,
  version: z.literal(1).default(1),
  problem: Text,
  context: Text,
  alternatives: Strings.min(1),
  chosen: Text,
  rationale: Text,
  consequences: Strings,
  mechanics: z.array(Id),
  revisit_when: Strings,
  date: z.iso.datetime(),
  status: z.literal("approved"),
});
export const Project = z.strictObject({
  schema_version: z.literal("1.0"),
  id: Id,
  name: Text,
  language: z.enum(["ru", "en"]),
  mode: z.enum(["explore", "design", "review", "validate"]),
  disabled_sources: z.array(Id),
  disabled_schools: Strings,
  requirements: Strings,
  canon: Strings,
});
const Amounts = z.record(Id, z.number().finite().nonnegative());
export const Process = z.strictObject({
  id: Id,
  inputs: Amounts,
  outputs: Amounts,
  probability: z.number().min(0).max(1).default(1),
  limit: z.number().int().min(0).max(10000).default(1),
});
export const Model = z
  .strictObject({
    schema_version: z.literal("1.0").default("1.0"),
    id: Id,
    seed: z.number().int().min(0).max(4294967295),
    steps: z.number().int().min(1).max(10000),
    initial: Amounts,
    processes: z.array(Process).max(100),
    invariants: z
      .array(
        z.strictObject({
          resource: Id,
          min: z.number().finite().optional(),
          max: z.number().finite().optional(),
        }),
      )
      .max(100)
      .default([]),
  })
  .superRefine((m, c) => {
    const keys = new Set(Object.keys(m.initial));
    for (const p of m.processes)
      for (const k of [...Object.keys(p.inputs), ...Object.keys(p.outputs)])
        if (!keys.has(k))
          c.addIssue({ code: "custom", message: `Unknown resource: ${k}` });
    for (const i of m.invariants)
      if (
        !keys.has(i.resource) ||
        (i.min !== undefined && i.max !== undefined && i.min > i.max)
      )
        c.addIssue({ code: "custom", message: "Invalid invariant" });
    if (m.steps * m.processes.reduce((s, p) => s + p.limit, 0) > 1_000_000)
      c.addIssue({
        code: "custom",
        message: "Work budget exceeded (1,000,000 attempts)",
      });
  });
export const Rules = z.strictObject({
  initial: Id,
  states: z.array(Id).min(1).max(500),
  terminal: z.array(Id).max(500),
  transitions: z
    .array(z.strictObject({ from: Id, to: Id, action: Id }))
    .max(5000),
});
export const Experiment = z.strictObject({
  id: Id,
  question: Text.min(1),
  hypothesis: Text.min(1),
  method: z.enum(["playtest", "simulation", "inspection"]),
  participants: Text.min(1),
  conditions: Strings,
  metrics: Strings.min(1),
  interpretation: Text.min(1),
  limitations: Strings.min(1),
});
export const Observation = z.strictObject({
  participant: Id,
  kind: z.enum(["observation", "measurement", "subjective"]),
  metric: Id,
  value: z.number().finite().optional(),
  text: Text.default(""),
  hypothesis: Id.optional(),
});
export const Document = z.strictObject({
  schema_version: z.literal("1.0"),
  id: Id,
  version: z.number().int().positive(),
  type: z.enum([
    "GameVision",
    "HighConcept",
    "DesignPillars",
    "CoreGameplayLoop",
    "SystemSpecification",
    "MechanicSpecification",
    "ProgressionDesign",
    "EconomyDesign",
    "NarrativeDesign",
    "UXSpecification",
    "TechnicalConstraints",
    "RiskRegister",
    "DecisionRecord",
    "ExperimentPlan",
    "PlaytestReport",
  ]),
  language: z.enum(["ru", "en"]),
  status: z.enum(["draft", "approved", "rejected"]),
  sources: Strings,
  links: z.array(Id),
  history: Strings,
  body: Text,
});
export const Artifact = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("mechanic"),
      id: Id,
      version: z.number().int().positive(),
      data: Mechanic,
    }),
    z.strictObject({
      kind: z.literal("experiment"),
      id: Id,
      version: z.number().int().positive(),
      data: Experiment,
    }),
    z.strictObject({
      kind: z.literal("playtest"),
      id: Id,
      version: z.number().int().positive(),
      data: z.strictObject({
        experiment_id: Id,
        observations: z.array(Observation).min(1).max(10000),
      }),
    }),
    z.strictObject({
      kind: z.literal("hypothesis"),
      id: Id,
      version: z.number().int().positive(),
      data: Claim.extend({ claim_type: z.literal("DESIGN_HYPOTHESIS") }),
    }),
    z.strictObject({
      kind: z.literal("document"),
      id: Id,
      version: z.number().int().positive(),
      data: Document,
    }),
  ])
  .superRefine((a, c) => {
    if ("id" in a.data && a.id !== a.data.id)
      c.addIssue({
        code: "custom",
        message: "Artifact and data IDs must match",
      });
    if ("version" in a.data && a.version !== a.data.version)
      c.addIssue({
        code: "custom",
        message: "Artifact and document versions must match",
      });
  });
