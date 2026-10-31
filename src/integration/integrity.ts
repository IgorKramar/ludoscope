import type { DesignAnalysis, DesignRequest } from "./contracts.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

/** IDs identify immutable records. Conflicts and capacity errors are never silently truncated. */
export function mergeRecords<T extends { id: string }>(
  label: string,
  groups: readonly (readonly T[])[],
  limit: number,
): T[] {
  const records = new Map<string, T>();
  for (const group of groups)
    for (const record of group) {
      const previous = records.get(record.id);
      if (previous && canonical(previous) !== canonical(record))
        throw new Error(`Conflicting ${label} ID: ${record.id}`);
      if (!previous) records.set(record.id, record);
    }
  if (records.size > limit)
    throw new Error(
      `${label} budget exceeded: <=${limit} records; split the analysis`,
    );
  return [...records.values()];
}

function unique(label: string, records: readonly { id: string }[]) {
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw new Error(`Duplicate ${label} ID`);
}

export function validateEnvelopeReferences(
  r: Pick<DesignRequest, "project_id" | "artifact_refs" | "evidence">,
) {
  unique("artifact", r.artifact_refs);
  unique("evidence", r.evidence);
  const artifacts = new Set(r.artifact_refs.map((a) => a.id));
  if (r.artifact_refs.some((a) => a.project_id !== r.project_id))
    throw new Error("Cross-project artifact rejected");
  for (const e of r.evidence)
    if (e.artifact_id && !artifacts.has(e.artifact_id))
      throw new Error(`Unknown evidence artifact: ${e.artifact_id}`);
}

export function validateAnalysisReferences(a: DesignAnalysis) {
  validateEnvelopeReferences(a);
  for (const [label, records] of [
    ["finding", a.findings],
    ["problem", a.problems],
    ["recommendation", a.recommendations],
    ["alternative", a.alternatives],
    ["hypothesis", a.hypotheses],
    ["experiment", a.validation],
  ] as const)
    unique(label, records);
  const evidence = new Set(a.evidence.map((e) => e.id));
  const hypotheses = new Set(a.hypotheses.map((h) => h.id));
  for (const item of [...a.findings, ...a.problems, ...a.recommendations])
    for (const id of item.evidence_ids)
      if (!evidence.has(id))
        throw new Error(`Unknown evidence reference: ${id}`);
  for (const item of [...a.recommendations, ...a.validation])
    for (const id of item.hypothesis_ids)
      if (!hypotheses.has(id))
        throw new Error(`Unknown hypothesis reference: ${id}`);
  for (const lens of a.lenses)
    for (const entry of lens.evidence) {
      const record = a.evidence.find((e) => e.id === entry.id);
      if (!record || canonical(record) !== canonical(entry))
        throw new Error(`Inconsistent lens evidence: ${entry.id}`);
    }
}
