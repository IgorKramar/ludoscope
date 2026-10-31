import type { DesignAnalysis } from "./contracts.js";

// Source text stays inert: no raw HTML or Markdown images/links supplied by a caller.
const text = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_\[\]|]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
const items = (values: string[]) =>
  values.length ? values.map((v) => "- " + text(v)) : ["—"];
export function renderAnalysis(r: DesignAnalysis): string {
  const lines = [
    "# " + text(r.context.subject),
    "",
    "> LUDOSCOPE · Design analysis · " + text(r.status),
    "",
    "| Identity | Value |",
    "| :--- | :--- |",
    "| Project | " + text(r.project_id) + " |",
    "| Task | " + text(r.task_id ?? "Unspecified") + " |",
    "| Request | " + text(r.request_id) + " |",
    "| Analysis | " + text(r.analysis_id) + " |",
    "| Created (UTC) | " + text(r.timestamp) + " |",
    "",
    "## Context",
    "",
    "**Genre:** " + text(r.context.genre || "Unspecified"),
    "**Audience:** " + text(r.context.audience || "Unspecified"),
    "",
    "### Author goals",
    "",
    ...items(r.context.author_goals),
    "",
    "### Creative principles",
    "",
    ...items(r.context.creative_principles),
    "",
    "### Constraints",
    "",
    ...items(r.context.constraints),
    "",
    "## Lenses",
    "",
  ];
  for (const lens of r.lenses)
    lines.push(
      "### " + text(lens.title),
      "",
      text(lens.id) + " · " + text(lens.source_ids.join(", ")),
      "",
      text(lens.description),
      "",
      ...items(lens.questions),
      "",
      "**Interpretation:** " + text(lens.interpretation),
      "",
      "**Limits:** " + text(lens.limitations.join(" ")),
      "",
    );
  for (const [heading, findings] of [
    ["Findings", r.findings],
    ["Problems", r.problems],
  ] as const) {
    lines.push("## " + heading, "");
    if (!findings.length)
      lines.push("No findings from the supplied checks.", "");
    for (const f of findings)
      lines.push(
        "### " + text(f.id),
        "",
        "**" + text(f.claim_type) + "** · " + text(f.claim),
        "",
        "**Evidence:** " + text(f.evidence_ids.join(", ")),
        "",
        "**Assumptions:** " + text(f.assumptions.join(" ")),
        "",
        "**Limits:** " + text(f.limitations.join(" ")),
        "",
        "**Confidence:** " +
          text(f.confidence.level) +
          " — " +
          text(f.confidence.rationale),
        "",
        "**Check:** " + text(f.validation_method),
        "",
      );
  }
  lines.push("## Recommendations", "");
  for (const rec of r.recommendations)
    lines.push(
      "### " + text(rec.id) + " · " + text(rec.priority),
      "",
      text(rec.action),
      "",
      "**Expected consequences**",
      "",
      ...items(rec.expected_consequences),
      "",
      "**Tradeoffs**",
      "",
      ...items(rec.tradeoffs),
      "",
      "**Evidence:** " + text(rec.evidence_ids.join(", ")),
      "",
      "**Hypotheses:** " + text(rec.hypothesis_ids.join(", ")),
      "",
      "**Confidence:** " +
        text(rec.confidence.level) +
        " — " +
        text(rec.confidence.rationale),
      "",
      "**Status:** proposed; author approval is separate.",
      "",
    );
  lines.push("## Alternatives", "");
  for (const alt of r.alternatives)
    lines.push(
      "### " + text(alt.title),
      "",
      text(alt.id) + " · DESIGN_HYPOTHESIS · candidate",
      "",
      ...items(alt.changes),
      "",
      "**Tradeoffs**",
      "",
      ...items(alt.tradeoffs),
      "",
    );
  lines.push("## Hypotheses", "");
  for (const h of r.hypotheses)
    lines.push(
      "### " + text(h.id),
      "",
      "**DESIGN_HYPOTHESIS:** " + text(h.statement),
      "",
      "**Falsification:** " + text(h.falsification),
      "",
      "**Metric:** " + text(h.metric),
      "",
    );
  lines.push("## Validation", "");
  for (const experiment of r.validation)
    lines.push(
      "### " + text(experiment.id),
      "",
      text(experiment.question),
      "",
      "**Method:** " + text(experiment.method),
      "",
      "**Participants / system:** " + text(experiment.participants),
      "",
      "**Hypotheses:** " + text(experiment.hypothesis_ids.join(", ")),
      "",
      "**Conditions**",
      "",
      ...items(experiment.conditions),
      "",
      "**Metrics**",
      "",
      ...items(experiment.metrics),
      "",
      "**Interpretation:** " + text(experiment.interpretation),
      "",
      "**Limits:** " + text(experiment.limitations.join(" ")),
      "",
      ...(experiment.prior_experiment_ids.length
        ? [
            "**Prior experiments:** " +
              text(experiment.prior_experiment_ids.join(", ")),
            "",
          ]
        : []),
      ...(experiment.repeat_rationale
        ? ["**Repeat rationale:** " + text(experiment.repeat_rationale), ""]
        : []),
    );
  if (r.evaluation) {
    const ev = r.evaluation;
    lines.push(
      "## Evaluation",
      "",
      "**Origin:** " +
        text(ev.data_origin) +
        " · **" +
        text(ev.claim_type) +
        "**",
      "",
      "**Declared human participants:** " +
        ev.participants +
        " · **Rows:** " +
        ev.rows,
      "",
      "| Metric | Rows | Min | Max | Mean |",
      "| :--- | ---: | ---: | ---: | ---: |",
      ...ev.metrics.map(
        (m) =>
          "| " +
          text(m.metric) +
          " | " +
          m.count +
          " | " +
          m.min +
          " | " +
          m.max +
          " | " +
          m.mean +
          " |",
      ),
      "",
    );
    for (const outcome of ev.hypothesis_outcomes)
      lines.push(
        "**" + text(outcome.hypothesis_id) + ": " + text(outcome.status) + "**",
        "",
        text(outcome.rationale),
        "",
      );
    lines.push(...items(ev.limitations), "");
  }
  lines.push("## Evidence", "");
  for (const e of r.evidence)
    lines.push(
      "### " + text(e.id),
      "",
      "**" + text(e.claim_type) + "** · " + text(e.kind),
      "",
      text(e.description),
      "",
      "**Locator:** " + text(e.locator),
      "",
      ...(e.source_id ? ["**Source:** " + text(e.source_id), ""] : []),
      ...(e.artifact_id ? ["**Artifact:** " + text(e.artifact_id), ""] : []),
      ...(e.uri ? ["**URI (not fetched):** " + text(e.uri), ""] : []),
      "**Limits:** " + text(e.limitations.join(" ")),
      "",
    );
  lines.push("## Artifacts", "");
  for (const a of r.artifact_refs)
    lines.push(
      "- " +
        text(a.id) +
        ": " +
        text(a.description) +
        " · revision " +
        text(a.revision ?? "unspecified") +
        (a.uri ? " · " + text(a.uri) : ""),
    );
  lines.push(
    "",
    "## Confidence",
    "",
    text(r.confidence.level) + " — " + text(r.confidence.rationale),
    "",
    "Qualitative assessment; not a calibrated probability.",
    "",
    "## History",
    "",
    r.history.available
      ? "Historical context supplied by the configured adapter."
      : "Historical context is incomplete.",
    "",
    ...items(r.history.limitations),
    "",
    "**Decisions:** " +
      text(r.history.decision_ids.join(", ") || "None supplied"),
    "**Rejected alternatives:** " +
      text(r.history.rejected_alternative_ids.join(", ") || "None supplied"),
    "**Prior experiments:** " +
      text(r.history.experiment_ids.join(", ") || "None supplied"),
    "",
  );
  const markdown = lines.join("\n");
  const notice =
    "\n\n> Display limit reached. Inspect the complete structured JSON result.\n";
  return markdown.length <= 200000
    ? markdown
    : markdown.slice(0, 200000 - notice.length) + notice;
}
