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
    const descriptions = new Set<string>();
    for (const e of this.data.entries) {
      const key = e.description.toLowerCase().trim();
      ensure(!descriptions.has(key), "DUPLICATE", "Duplicate knowledge text");
      descriptions.add(key);
    }
  }
  search(query: string, c: SearchContext = {}) {
    const tokens = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
    return this.data.entries
      .filter(
        (e) =>
          e.verification_status !== "SOURCE_REQUIRED" &&
          !c.disabled_schools?.includes(e.school) &&
          !e.source_ids.some((s) => c.disabled_sources?.includes(s)) &&
          (!c.kind || e.kind === c.kind) &&
          (!c.genre ||
            !e.applicable_genres.length ||
            e.applicable_genres.includes(c.genre)) &&
          (!c.stage ||
            !e.applicable_stages.length ||
            e.applicable_stages.includes(c.stage)),
      )
      .map((e) => ({
        e,
        score:
          tokens.reduce(
            (s, t) =>
              s +
              (e.title.toLowerCase().includes(t) ? 4 : 0) +
              (e.tags.some((x) => x.toLowerCase().includes(t)) ? 3 : 0) +
              (e.description.toLowerCase().includes(t) ? 1 : 0),
            0,
          ) +
          (c.tags ?? []).filter((t) => e.tags.includes(t)).length * 3,
      }))
      .filter((r) => r.score > 0 || !tokens.length)
      .sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id))
      .slice(0, c.limit ?? 10)
      .map((r) => r.e);
  }
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
  return new KnowledgeRegistry({ schema_version: "1.0", sources, entries });
}
