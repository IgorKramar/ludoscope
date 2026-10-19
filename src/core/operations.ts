import { resultSchemas } from "./results.js";
import { analyseSystems } from "../analysis/systems.js";
import { z } from "zod";
import {
  Id,
  Text,
  Strings,
  Mechanic,
  Graph,
  Rules,
  Model,
  Decision,
  Experiment,
  Observation,
  Document,
  Artifact,
} from "./schemas.js";
import { registry, projectRegistry } from "./knowledge.js";
import { selectLenses } from "./lenses.js";
import { terms } from "./retrieval.js";
import { ProjectStore, scan } from "../project/store.js";
import { analyseMechanic } from "../analysis/mechanic.js";
import { impact, mermaid, validateGraph, validateRules } from "./graph.js";
import {
  simulate,
  economy,
  compare,
  sensitivity,
} from "../simulation/index.js";
import {
  designExperiment,
  evaluatePlaytest,
  Learning,
  mastery,
  UX,
  uxReview,
  Narrative,
  narrative,
  Content,
  procedural,
} from "../analysis/labs.js";
import { renderReport, renderDocument } from "./report.js";
const empty = z.strictObject({});
function operation<S extends z.ZodType, R>(
  description: string,
  input: S,
  run: (arg: z.infer<S>, store: ProjectStore) => Promise<R> | R,
  write = false,
) {
  return { description, input, run, write };
}
export const operations = {
  ludoscope_knowledge_get: operation(
    "Load specific knowledge entries and source provenance by stable IDs without retrieving full books. Respects disabled sources/schools.",
    z.strictObject({
      ids: z.array(Id).min(1).max(20),
      include_sources: z.boolean().default(true),
    }),
    async (a, s) => {
      let context = {};
      try {
        const p = await s.profile();
        context = {
          disabled_sources: p.disabled_sources,
          disabled_schools: p.disabled_schools,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return (await projectRegistry(s.root)).get(
        a.ids,
        context,
        a.include_sources,
      );
    },
  ),
  ludoscope_record_artifact: operation(
    "Preview or explicitly commit a versioned mechanic, hypothesis, experiment, playtest or GDD document. Existing versions are immutable.",
    z.strictObject({ artifact: Artifact, commit: z.boolean().default(false) }),
    (a, s) => s.recordArtifact(a.artifact, a.commit),
    true,
  ),
  ludoscope_update_graph: operation(
    "Preview graph replacement; explicit commit requires reviewed expected_sha256 and creates an immutable backup.",
    z.strictObject({
      graph: Graph,
      commit: z.boolean().default(false),
      expected_sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
    (a, s) => s.updateGraph(a.graph, a.commit, a.expected_sha256),
    true,
  ),
  ludoscope_analyse_systems: operation(
    "Feedback components and bounded interaction chains; not causal proof.",
    z.strictObject({ graph: Graph }),
    (a) => analyseSystems(a.graph),
  ),
  ludoscope_project_scan: operation(
    "Bounded read-only file inventory with fingerprints; no mechanics inferred.",
    empty,
    async (_, s) => scan(s.root),
  ),
  ludoscope_project_context: operation(
    "Read project profile, vision, graph and immutable decisions.",
    empty,
    async (_, s) => s.context(),
  ),
  ludoscope_knowledge_search: operation(
    "Offline full-text and metadata search; source-required entries excluded.",
    z.strictObject({
      query: Text,
      tags: Strings.optional(),
      genre: Text.optional(),
      stage: Text.optional(),
      mode: z.enum(["explore", "design", "review", "validate"]).optional(),
      system_types: Strings.optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    async (a, s) => {
      let disabled = {};
      try {
        const p = await s.profile();
        disabled = {
          disabled_sources: p.disabled_sources,
          disabled_schools: p.disabled_schools,
          mode: a.mode ?? p.mode,
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      return (await projectRegistry(s.root)).search(a.query, {
        ...a,
        mode: a.mode ?? "design",
        tags: [...(a.tags ?? []), ...terms(a.query)],
        ...disabled,
      });
    },
  ),
  ludoscope_get_lenses: operation(
    "Select original lenses by query, tags, genre and stage; bind questions to named system.",
    z.strictObject({
      query: Text,
      system: Text,
      tags: Strings.default([]),
      genre: Text.optional(),
      stage: Text.optional(),
      mode: z.enum(["explore", "design", "review", "validate"]).optional(),
      system_types: Strings.default([]),
    }),
    async (a, s) => {
      const p = await s.profile();
      return selectLenses(await projectRegistry(s.root), {
        ...a,
        mode: a.mode ?? p.mode,
        disabled_sources: p.disabled_sources,
        disabled_schools: p.disabled_schools,
      });
    },
  ),
  ludoscope_analyse_mechanic: operation(
    "Structured mechanic checks and relevant knowledge for Codex reasoning.",
    z.strictObject({ mechanic: Mechanic }),
    async (a, s) => {
      const p = await s.profile();
      return analyseMechanic(
        a.mechanic,
        {
          disabled_sources: p.disabled_sources,
          disabled_schools: p.disabled_schools,
          mode: p.mode,
        },
        await projectRegistry(s.root),
      );
    },
  ),
  ludoscope_analyse_dependencies: operation(
    "Conservative dependency impact and Mermaid export.",
    z.strictObject({ id: Id, graph: Graph.optional() }),
    async (a, s) => {
      const g = a.graph ?? (await s.graph());
      return { ...impact(g, a.id), mermaid: mermaid(g) };
    },
  ),
  ludoscope_validate_rules: operation(
    "Finite state reachability, deadlocks and ambiguous actions.",
    z.strictObject({ rules: Rules }),
    (a) => validateRules(a.rules),
  ),
  ludoscope_analyse_economy: operation(
    "Resource rates, free sources and bounded nonnegative conversion witnesses.",
    z.strictObject({ model: Model }),
    (a) => economy(a.model),
  ),
  ludoscope_simulate_system: operation(
    "Seeded bounded discrete resource simulation.",
    z.strictObject({ model: Model }),
    (a) => simulate(a.model),
  ),
  ludoscope_compare_variants: operation(
    "Compare fixed-seed model variants or seeded Monte Carlo summaries.",
    z.strictObject({
      models: z.array(Model).min(1).max(10),
      seeds: z.array(z.number().int().min(0).max(4294967295)).min(1).max(100),
    }),
    (a) => {
      const budget = a.models.reduce(
        (s, m) =>
          s +
          m.steps *
            m.processes.reduce((t, p) => t + p.limit, 0) *
            a.seeds.length,
        0,
      );
      if (budget > 2_000_000)
        throw new Error("Total comparison work budget exceeded");
      return a.models.map((m) => ({ model_id: m.id, ...compare(m, a.seeds) }));
    },
  ),
  ludoscope_design_experiment: operation(
    "Validate a draft experiment and expose limitations.",
    z.strictObject({ experiment: Experiment }),
    (a) => designExperiment(a.experiment),
  ),
  ludoscope_evaluate_playtest: operation(
    "Describe real supplied observations, measurements and subjective feedback separately.",
    z.strictObject({ observations: z.array(Observation).min(1).max(10000) }),
    (a) => evaluatePlaytest(a.observations),
  ),
  ludoscope_generate_report: operation(
    "Render a mechanic report or versioned GDD document; returns text without writing.",
    z
      .strictObject({
        mechanic: Mechanic.optional(),
        document: Document.optional(),
        language: z.enum(["ru", "en"]).default("ru"),
      })
      .refine(
        (a) => Boolean(a.mechanic) !== Boolean(a.document),
        "Supply exactly one mechanic or document",
      ),
    async (a, s) => {
      if (a.document)
        return { format: "markdown", content: renderDocument(a.document) };
      const p = await s.profile();
      return {
        format: "markdown",
        content: renderReport(
          await analyseMechanic(
            a.mechanic,
            {
              disabled_sources: p.disabled_sources,
              disabled_schools: p.disabled_schools,
              mode: p.mode,
            },
            await projectRegistry(s.root),
          ),
          a.language,
        ),
      };
    },
  ),
  ludoscope_check_consistency: operation(
    "Validate local project graph and immutable decisions; no inferred code equivalence.",
    empty,
    async (_, s) => {
      const c = await s.context();
      return {
        valid: true,
        nodes: c.graph.nodes.length,
        decisions: c.decisions.length,
        limitations: [
          "Canon prose and implementation semantics require explicit formal links and review.",
        ],
      };
    },
  ),
  ludoscope_record_decision: operation(
    "Preview an immutable approved decision. commit=true writes only within .ludoscope/decisions.",
    z.strictObject({ decision: Decision, commit: z.boolean().default(false) }),
    (a, s) => s.record(a.decision, a.commit),
    true,
  ),
  ludoscope_mastery_analysis: operation(
    "Check explicit learning prerequisites and practice opportunities.",
    Learning,
    (a) => mastery(a),
  ),
  ludoscope_ux_review: operation(
    "Artifact inventory and cognitive UX / game feel review prompts.",
    UX,
    (a) => uxReview(a),
  ),
  ludoscope_narrative_consistency: operation(
    "Explore bounded Boolean world states and test explicit canon invariants.",
    Narrative,
    (a) => narrative(a),
  ),
  ludoscope_procedural_review: operation(
    "Descriptive distribution and validity checks of supplied generator samples.",
    Content,
    (a) => procedural(a),
  ),
  ludoscope_sensitivity_analysis: operation(
    "Vary one process output multiplier with fixed seed.",
    z.strictObject({
      model: Model,
      process_id: Id,
      multipliers: z.array(z.number().min(0).max(100)).min(1).max(20),
    }),
    (a) => sensitivity(a.model, a.process_id, a.multipliers),
  ),
};
export type OperationName = keyof typeof operations;
export async function invoke(
  name: OperationName,
  input: unknown,
  store: ProjectStore,
) {
  const op = operations[name];
  const parsed = op.input.parse(input);
  const result = await (op.run as (arg: never, s: ProjectStore) => unknown)(
    parsed as never,
    store,
  );
  return resultSchemas[name].parse(result);
}
