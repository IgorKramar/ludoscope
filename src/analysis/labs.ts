import { z } from "zod";
import { Strings, Id, Text, Observation, Experiment } from "../core/schemas.js";
import { ensure } from "../core/errors.js";
import { parse as csv } from "csv-parse/sync";
export const Learning = z.strictObject({
  skills: z
    .array(
      z.strictObject({
        id: Id,
        requires: z.array(Id),
        introduced_at: z.number().int().min(0),
        practice: Strings,
        variation: Strings,
      }),
    )
    .max(500),
});
export function mastery(input: unknown) {
  const data = Learning.parse(input);
  const ids = new Set(data.skills.map((s) => s.id));
  ensure(ids.size === data.skills.length, "DUPLICATE", "Duplicate skill");
  const issues: string[] = [];
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    ensure(!visiting.has(id), "DEPENDENCY_CYCLE", id);
    if (done.has(id)) return;
    visiting.add(id);
    const s = data.skills.find((s) => s.id === id)!;
    for (const req of s.requires) {
      ensure(ids.has(req), "REFERENCE", req);
      const p = data.skills.find((s) => s.id === req)!;
      if (p.introduced_at > s.introduced_at)
        issues.push(`${id} precedes prerequisite ${req}`);
      visit(req);
    }
    visiting.delete(id);
    done.add(id);
  }
  for (const s of data.skills) {
    visit(s.id);
    if (!s.practice.length) issues.push(`${s.id}: no explicit practice`);
    if (!s.variation.length)
      issues.push(`${s.id}: no transfer or variation specified`);
  }
  return {
    claim_type: "EXPERT_INFERENCE",
    issues,
    limitations: [
      "Instructional plan only; mastery and cognitive load require observed users.",
    ],
  };
}
export const UX = z.strictObject({
  artifacts: Strings,
  goal: Text,
  visible_state: Strings,
  feedback: Strings,
  error_recovery: Strings,
  accessibility: Strings,
  input_latency_ms: z.number().nonnegative().optional(),
});
export function uxReview(input: unknown) {
  const d = UX.parse(input);
  return {
    claim_type: "EXPERT_INFERENCE",
    needs_artifacts: !d.artifacts.length,
    gaps: [
      "visible_state",
      "feedback",
      "error_recovery",
      "accessibility",
    ].filter((k) => !(d[k as keyof typeof d] as string[]).length),
    game_feel: {
      measured_latency_ms: d.input_latency_ms ?? null,
      questions: [
        "Известны ли условия измерения задержки и устройство ввода?",
        "Соответствует ли реакция действию и читается ли движение?",
      ],
      limitation: "No universal latency threshold or subjective feel score.",
    },
    limitations: [
      "Artifact-based checklist; no visual inspection or user observation is implied.",
    ],
  };
}
export const Narrative = z.strictObject({
  initial: z.record(Id, z.boolean()),
  events: z
    .array(
      z.strictObject({
        id: Id,
        requires: z.record(Id, z.boolean()),
        effects: z.record(Id, z.boolean()),
      }),
    )
    .max(200),
  canon: z.record(Id, z.boolean()).default({}),
  max_states: z.number().int().min(1).max(10000).default(1000),
});
export function narrative(input: unknown) {
  const d = Narrative.parse(input);
  const ids = new Set<string>();
  for (const e of d.events) {
    ensure(!ids.has(e.id), "DUPLICATE", e.id);
    ids.add(e.id);
    for (const key of [...Object.keys(e.requires), ...Object.keys(e.effects)])
      ensure(key in d.initial, "REFERENCE", key);
  }
  for (const key of Object.keys(d.canon))
    ensure(key in d.initial, "REFERENCE", key);
  const key = (s: Record<string, boolean>) =>
    JSON.stringify(
      Object.keys(s)
        .sort()
        .map((k) => [k, s[k]]),
    );
  const seen = new Set([key(d.initial)]),
    queue = [{ state: d.initial, path: [] as string[] }],
    enabled = new Set<string>(),
    violations: { path: string[]; state: Record<string, boolean> }[] = [];
  let truncated = false;
  for (const [k, v] of Object.entries(d.canon))
    if (d.initial[k] !== v) violations.push({ path: [], state: d.initial });
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of d.events) {
      if (!Object.entries(e.requires).every(([k, v]) => cur.state[k] === v))
        continue;
      enabled.add(e.id);
      const next = { ...cur.state, ...e.effects },
        p = [...cur.path, e.id],
        k = key(next);
      if (seen.has(k)) continue;
      if (seen.size >= d.max_states) {
        truncated = true;
        continue;
      }
      seen.add(k);
      if (Object.entries(d.canon).some(([k, v]) => next[k] !== v))
        violations.push({ path: p, state: next });
      queue.push({ state: next, path: p });
    }
  }
  return {
    claim_type: "MODEL_RESULT",
    explored_states: seen.size,
    unreachable_events: d.events
      .filter((e) => !enabled.has(e.id))
      .map((e) => e.id),
    canon_violations: violations,
    truncated,
    limitations: [
      "Boolean world-state model only; event text and unformalized lore are not verified. Truncated search cannot establish unreachability.",
    ],
  };
}
export const Content = z.strictObject({
  samples: z
    .array(
      z.strictObject({
        id: Id,
        pattern: Text,
        valid: z.boolean(),
        reachable: z.boolean(),
        solvable: z.boolean(),
        resources: Strings,
      }),
    )
    .min(1)
    .max(10000),
  required_resources: Strings,
});
export function procedural(input: unknown) {
  const d = Content.parse(input);
  const counts: Record<string, number> = {};
  for (const s of d.samples) counts[s.pattern] = (counts[s.pattern] ?? 0) + 1;
  return {
    claim_type: "MODEL_RESULT",
    sample_size: d.samples.length,
    patterns: counts,
    invalid: d.samples
      .filter(
        (s) =>
          !s.valid ||
          !s.reachable ||
          !s.solvable ||
          d.required_resources.some((r) => !s.resources.includes(r)),
      )
      .map((s) => s.id),
    largest_pattern_share:
      Math.max(...Object.values(counts)) / d.samples.length,
    limitations: [
      "Validity flags supplied by caller, not independently verified. Distribution is descriptive; diversity does not establish quality. No arbitrary generator code is executed.",
    ],
  };
}
export function evaluatePlaytest(input: unknown) {
  const rows = z.array(Observation).min(1).max(10000).parse(input);
  const participants = new Set(rows.map((r) => r.participant));
  const measurements = rows.filter(
    (r) => r.kind === "measurement" && r.value !== undefined,
  );
  const summary = Object.fromEntries(
    [...new Set(measurements.map((r) => r.metric))].map((metric) => {
      const rs = measurements.filter((r) => r.metric === metric),
        xs = rs.map((r) => r.value!);
      return [
        metric,
        {
          rows: xs.length,
          participants: new Set(rs.map((r) => r.participant)).size,
          min: Math.min(...xs),
          max: Math.max(...xs),
          mean: xs.reduce((a, b) => a + b, 0) / xs.length,
        },
      ];
    }),
  );
  return {
    claim_type: "PLAYTEST_OBSERVATION",
    participants: participants.size,
    rows: rows.length,
    measurements: summary,
    observations: rows.filter((r) => r.kind === "observation"),
    subjective: rows.filter((r) => r.kind === "subjective"),
    hypotheses: [
      ...new Set(rows.flatMap((r) => (r.hypothesis ? [r.hypothesis] : []))),
    ],
    limitations: [
      "Descriptive summaries only. Repeated rows are not independent participants. Sampling bias and confounds are unknown; no causal or significance claim.",
    ],
  };
}
export function importPlaytest(text: string, format: "csv" | "json") {
  ensure(
    Buffer.byteLength(text) <= 2 * 1024 * 1024,
    "SIZE",
    "Import exceeds 2 MiB",
  );
  if (format === "json")
    return z.array(Observation).max(10000).parse(JSON.parse(text));
  const raw = csv(text, {
    columns: true,
    skip_empty_lines: true,
    max_record_size: 20000,
  }) as Record<string, string>[];
  return z
    .array(Observation)
    .max(10000)
    .parse(
      raw.map((r) => ({
        ...r,
        ...(r.value === ""
          ? { value: undefined }
          : r.value !== undefined
            ? { value: Number(r.value) }
            : {}),
        ...(r.hypothesis === "" ? { hypothesis: undefined } : {}),
      })),
    );
}
export function designExperiment(input: unknown) {
  const e = Experiment.parse(input);
  return {
    ...e,
    status: "draft",
    claim_type: "DESIGN_HYPOTHESIS",
    checklist: [
      "Записать критерии до сбора данных.",
      "Разделить наблюдения, измерения и субъективные оценки.",
      "Сохранить условия, отказы и пропущенные значения.",
      "Не обобщать симуляцию на реальных игроков.",
    ],
  };
}
