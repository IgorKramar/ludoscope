import { terms, normalizeTag, metadataMatches } from "./retrieval.js";
import { readFile, readdir } from "node:fs/promises";
import { contained, readBounded } from "./files.js";
import { fileURLToPath } from "node:url";
import { RegistrySchema, Entry } from "./schemas.js";
import { z } from "zod";
import { ensure } from "./errors.js";
export type KnowledgeEntry = z.infer<typeof Entry>;
export interface RetrievalProvider {
  search(query: string, context?: SearchContext): KnowledgeEntry[];
}
export interface SearchContext {
  tags?: string[];
  genre?: string;
  stage?: string;
  disabled_sources?: string[];
  disabled_schools?: string[];
  kind?: KnowledgeEntry["kind"];
  limit?: number;
  mode?: "explore" | "design" | "review" | "validate";
  system_types?: string[];
}
export class KnowledgeRegistry implements RetrievalProvider {
  readonly data: z.infer<typeof RegistrySchema>;
  constructor(data: unknown) {
    this.data = RegistrySchema.parse(data);
    const ids = new Set<string>();
    for (const item of [...this.data.sources, ...this.data.entries]) {
      ensure(!ids.has(item.id), "DUPLICATE", item.id);
      ids.add(item.id);
    }
    const source = new Map(this.data.sources.map((s) => [s.id, s]));
    const entries = new Set(this.data.entries.map((e) => e.id));
    for (const e of this.data.entries) {
      for (const id of e.source_ids) ensure(source.has(id), "REFERENCE", id);
      for (const id of [...e.related_entry_ids, ...e.conflicting_entry_ids])
        ensure(entries.has(id), "REFERENCE", id);
      if (e.verification_status === "VERIFIED_SOURCE")
        ensure(
          e.source_ids.length > 0 &&
            e.source_ids.every(
              (id) => source.get(id)?.verification_status === "VERIFIED_SOURCE",
            ) &&
            !!e.evidence_locator,
          "PROVENANCE",
          e.id,
        );
    }
    for (const sourceItem of this.data.sources) {
      const p = sourceItem.provenance;
      if (p?.access === "user_supplied" && p.content_verified)
        ensure(
          p.artifact_sha256 && p.pdf_pages && p.verified_pdf_pages?.length,
          "PROVENANCE",
          `Content-verified private sources require a copy hash, page count and reviewed pages: ${sourceItem.id}`,
        );
      if (p?.verified_pdf_pages)
        ensure(
          p.pdf_pages &&
            p.verified_pdf_pages.every((page) => page <= p.pdf_pages!),
          "PROVENANCE",
          `Invalid reviewed page: ${sourceItem.id}`,
        );
    }
    for (const entry of this.data.entries) {
      const selection = entry.selection;
      if (selection)
        ensure(
          !selection.all_tags.some(
            (tag) => metadataMatches([tag], selection.excluded_tags).length,
          ),
          "CONTRADICTORY_SELECTION",
          entry.id,
        );
      for (const evidence of entry.evidence ?? []) {
        ensure(
          entry.source_ids.includes(evidence.source_id),
          "PROVENANCE",
          `Evidence source is not attributed: ${entry.id}`,
        );
        const parent = source.get(evidence.source_id);
        ensure(parent, "REFERENCE", evidence.source_id);
        if (parent.provenance?.pdf_pages)
          ensure(
            evidence.pdf_pages.every(
              (page) => page <= parent.provenance!.pdf_pages!,
            ),
            "PROVENANCE",
            `Page outside PDF: ${entry.id}`,
          );
        if (parent.provenance?.verified_pdf_pages)
          ensure(
            evidence.pdf_pages.every((page) =>
              parent.provenance!.verified_pdf_pages!.includes(page),
            ),
            "PROVENANCE",
            `Page outside reviewed coverage: ${entry.id}`,
          );
      }
      if (entry.verification_status === "VERIFIED_SOURCE")
        ensure(
          !(entry.evidence ?? []).some(
            (e) => e.claim_scope !== "author_position",
          ),
          "CLAIM_TYPE",
          `Derived methods and cross-source interpretations require EXPERT_INFERENCE: ${entry.id}`,
        );
      if (entry.verification_status === "VERIFIED_SOURCE")
        for (const id of entry.source_ids) {
          const parent = source.get(id)!;
          if (parent.provenance)
            ensure(
              parent.provenance.content_verified,
              "PROVENANCE",
              `Only bibliography verified: ${id}`,
            );
          if (parent.provenance?.access === "user_supplied")
            ensure(
              entry.evidence?.some((e) => e.source_id === id),
              "PROVENANCE",
              `Private primary source requires page evidence: ${entry.id}`,
            );
        }
    }
    const descriptions = new Set<string>();
    for (const e of this.data.entries) {
      const key = e.description.toLowerCase().trim();
      ensure(!descriptions.has(key), "DUPLICATE", "Duplicate knowledge text");
      descriptions.add(key);
    }
  }
  search(query: string, c: SearchContext = {}) {
    const queryTerms = terms(query);
    const tags = c.tags ?? [];
    const ranked = this.data.entries
      .filter((e) => this.applicable(e, c))
      .map((e) => {
        const titleTerms = new Set(terms(e.title));
        const tagTerms = new Set(
          e.tags.flatMap((tag) => [normalizeTag(tag), ...terms(tag)]),
        );
        const descriptionTerms = new Set(terms(e.description));
        const score =
          queryTerms.reduce(
            (sum, term) =>
              sum +
              (titleTerms.has(term) ? 4 : 0) +
              (tagTerms.has(term) ? 3 : 0) +
              (descriptionTerms.has(term) ? 1 : 0),
            0,
          ) +
          metadataMatches(e.tags, tags).length * 3;
        return { entry: e, score };
      })
      .filter((r) => r.score > 0 || (!queryTerms.length && !tags.length))
      .sort(
        (a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id),
      );
    return ranked
      .slice(0, Math.max(0, Math.min(c.limit ?? 10, 10000)))
      .map((r) => r.entry);
  }
  get(ids: string[], c: SearchContext = {}, includeSources = true) {
    ensure(
      ids.length > 0 && ids.length <= 20,
      "LIMIT",
      "Request 1–20 knowledge/source IDs",
    );
    const requested = new Set(ids);
    const entries = this.data.entries.filter(
      (e) =>
        requested.has(e.id) &&
        e.verification_status !== "SOURCE_REQUIRED" &&
        !c.disabled_schools?.includes(e.school) &&
        !e.source_ids.some((id) => c.disabled_sources?.includes(id)),
    );
    const sourceIds = new Set([
      ...ids,
      ...(includeSources ? entries.flatMap((e) => e.source_ids) : []),
    ]);
    const sources = this.data.sources.filter(
      (s) => sourceIds.has(s.id) && !c.disabled_sources?.includes(s.id),
    );
    const found = new Set([...entries, ...sources].map((item) => item.id));
    return {
      entries,
      sources,
      missing_ids: [...requested].filter((id) => !found.has(id)),
    };
  }
  applicable(e: KnowledgeEntry, c: SearchContext = {}) {
    if (
      e.verification_status === "SOURCE_REQUIRED" ||
      c.disabled_schools?.includes(e.school) ||
      e.source_ids.some((id) => c.disabled_sources?.includes(id))
    )
      return false;
    if (c.kind && c.kind !== e.kind) return false;
    if (
      c.genre &&
      e.applicable_genres.length &&
      !e.applicable_genres.includes(c.genre)
    )
      return false;
    if (
      c.stage &&
      e.applicable_stages.length &&
      !e.applicable_stages.includes(c.stage)
    )
      return false;
    const selection = e.selection;
    if (!selection) return true;
    if (
      selection.any_tags.length &&
      !metadataMatches(selection.any_tags, c.tags ?? []).length
    )
      return false;
    if (
      metadataMatches(selection.all_tags, c.tags ?? []).length !==
      selection.all_tags.length
    )
      return false;
    if (metadataMatches(selection.excluded_tags, c.tags ?? []).length)
      return false;
    if (
      metadataMatches(selection.required_system_types, c.system_types ?? [])
        .length !== selection.required_system_types.length
    )
      return false;
    if (
      selection.modes.length &&
      (!c.mode || !selection.modes.includes(c.mode))
    )
      return false;
    return true;
  }
}

/** Reserve room for independently relevant schools, without treating diversity as evidence of truth. */
export function retrieveContext(
  k: KnowledgeRegistry,
  query: string,
  c: SearchContext = {},
) {
  const limit = Math.min(c.limit ?? 8, 50);
  const ranked = k.search(query, { ...c, limit: 100 });
  const chosen: KnowledgeEntry[] = [];
  const schools = new Set<string>();
  for (const entry of ranked) {
    if (!schools.has(entry.school)) {
      chosen.push(entry);
      schools.add(entry.school);
    }
    if (chosen.length >= Math.min(limit, 4)) break;
  }
  for (const entry of ranked)
    if (chosen.length < limit && !chosen.some((e) => e.id === entry.id))
      chosen.push(entry);
  return chosen;
}

let cached: Promise<KnowledgeRegistry> | undefined;
export function registry() {
  return (cached ??= readFile(
    fileURLToPath(new URL("../../knowledge/registry.json", import.meta.url)),
    "utf8",
  ).then((s) => new KnowledgeRegistry(JSON.parse(s))));
}
export function importKnowledge(
  data: unknown,
  permission: { license: string; redistribution: boolean },
) {
  ensure(
    permission.license.trim() && permission.redistribution,
    "LICENSE",
    "Explicit redistribution permission required",
  );
  return new KnowledgeRegistry(data);
}

export async function projectRegistry(root: string) {
  const builtin = await registry();
  let files: string[];
  try {
    files = await readdir(await contained(root, ".ludoscope/knowledge"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return builtin;
    throw e;
  }
  files = files.filter((f) => f.endsWith(".registry.json"));
  ensure(files.length <= 50, "LIMIT", "At most 50 local knowledge packages");
  const sources = [...builtin.data.sources],
    entries = [...builtin.data.entries];
  for (const file of files.sort()) {
    const local = new KnowledgeRegistry(
      JSON.parse(await readBounded(root, `.ludoscope/knowledge/${file}`)),
    );
    sources.push(...local.data.sources);
    entries.push(...local.data.entries);
  }
  return new KnowledgeRegistry({
    schema_version: builtin.data.schema_version,
    sources,
    entries,
  });
}
