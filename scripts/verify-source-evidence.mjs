import { assertSubstantivePages } from "./source-evidence-quality.mjs";
/** Optional offline audit against the owner's private PDFs and extracted page arrays. No book text is emitted. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { KnowledgeRegistry } from "../dist/core/knowledge.js";
const mappingFile = process.argv[2];
if (!mappingFile)
  throw new Error(
    "Usage: node scripts/verify-source-evidence.mjs /private/source-map.json",
  );
const mapping = JSON.parse(await readFile(mappingFile, "utf8"));
const registry = new KnowledgeRegistry(
  JSON.parse(
    await readFile(
      new URL("../knowledge/registry.json", import.meta.url),
      "utf8",
    ),
  ),
);
const normalize = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-–]\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const reports = [];
for (const source of registry.data.sources.filter(
  (s) => s.provenance?.access === "user_supplied",
)) {
  const input = mapping[source.id];
  if (!input) throw new Error(`Missing private source mapping: ${source.id}`);
  const bytes = await readFile(input.pdf);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== source.provenance.artifact_sha256)
    throw new Error(`PDF hash mismatch: ${source.id}`);
  const pages = JSON.parse(await readFile(input.pages, "utf8"));
  if (!Array.isArray(pages) || pages.length < source.provenance.pdf_pages)
    throw new Error(`Invalid page array: ${source.id}`);
  const entries = registry.data.entries.filter((e) =>
    e.source_ids.includes(source.id),
  );
  const readability = assertSubstantivePages(
    pages,
    entries.flatMap((entry) =>
      (entry.evidence ?? [])
        .filter((e) => e.source_id === source.id)
        .flatMap((e) => e.pdf_pages),
    ),
  );
  let locators = 0;
  const checkedPages = new Set();
  for (const entry of entries) {
    const evidence =
      entry.evidence?.filter((e) => e.source_id === source.id) ?? [];
    if (!evidence.length) throw new Error(`No page evidence: ${entry.id}`);
    for (const item of evidence) {
      for (const page of item.pdf_pages) {
        if (
          typeof pages[page - 1] !== "string" ||
          pages[page - 1].trim().length < 80
        )
          throw new Error(
            `Empty or missing evidence page: ${entry.id}:${page}`,
          );
        checkedPages.add(page);
        locators++;
      }
      const text = normalize(
        item.pdf_pages.map((page) => pages[page - 1]).join(" "),
      );
      const description = normalize(entry.description);
      for (let offset = 0; offset + 200 <= description.length; offset += 50)
        if (text.includes(description.slice(offset, offset + 200)))
          throw new Error(
            `Long literal overlap; rephrase and review: ${entry.id}`,
          );
    }
  }
  reports.push({
    source_id: source.id,
    pdf_sha256: hash,
    pdf_pages: source.provenance.pdf_pages,
    entries: entries.length,
    unique_cited_pages: checkedPages.size,
    page_locators: locators,
    readability,
    long_literal_description_overlaps: 0,
  });
}
console.log(
  JSON.stringify(
    {
      scope:
        "File identity, nonempty pages, schema integrity and long literal overlap. This does not prove semantic accuracy, empirical validity or redistribution rights.",
      sources: reports,
    },
    null,
    2,
  ),
);
