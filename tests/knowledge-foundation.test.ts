import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectStore } from "../src/project/store.js";
import { invoke } from "../src/core/operations.js";
import { Source, Entry } from "../src/core/schemas.js";
import { KnowledgeRegistry, registry } from "../src/core/knowledge.js";
import { selectLenses } from "../src/core/lenses.js";
import { analyseMechanic } from "../src/analysis/mechanic.js";

const source = {
  id: "source.fixture",
  version: 1,
  title: "Synthetic content-verified source",
  authors: ["Test author"],
  url: "https://example.org/fixture",
  verification_status: "VERIFIED_SOURCE",
  accessed_at: "2026-10-19",
  license: "Synthetic original fixture",
  notes: "No book text included.",
  provenance: {
    access: "user_supplied",
    artifact_sha256: "a".repeat(64),
    pdf_pages: 100,
    verified_pdf_pages: [7, 8],
    content_verified: true,
    redistribution: "metadata_and_original_analysis_only",
  },
};
function entry(id: string, selection?: unknown) {
  return {
    id,
    version: 1,
    kind: "Lens",
    title: id,
    description: `Independent original description for ${id}`,
    source_ids: [source.id],
    school: "fixture_school",
    tags: ["choice", "hunger", "automation"],
    applicable_genres: [],
    applicable_stages: ["prototype"],
    conditions: ["Explicit system context"],
    questions: ["What action creates the intended experience?"],
    recommendations: ["Compare prototypes"],
    limitations: ["Synthetic method, no real user observations"],
    conflicting_entry_ids: [],
    related_entry_ids: [],
    verification_status: "EXPERT_INFERENCE",
    confidence: "low",
    evidence_locator: "Synthetic fixture, not a published lens",
    interpretation: "Original test data",
    ...(selection ? { selection } : {}),
  };
}
function custom(entries: unknown[]) {
  return new KnowledgeRegistry({
    schema_version: "1.0",
    sources: [source],
    entries,
  });
}
const select = (k: KnowledgeRegistry, context: unknown) => {
  return selectLenses(k, context as any);
};

describe("knowledge selection contracts", () => {
  it("validates bounded private-source provenance while leaving metadata-only sources compatible", () => {
    expect(Source.parse(source).provenance).toMatchObject({
      pdf_pages: 100,
      content_verified: true,
    });
    expect(() =>
      Source.parse({
        ...source,
        provenance: { ...source.provenance, artifact_sha256: "not-a-hash" },
      }),
    ).toThrow();
    expect(() =>
      Source.parse({
        ...source,
        provenance: { ...source.provenance, pdf_pages: 0 },
      }),
    ).toThrow();
    const { provenance, ...metadata } = source;
    expect(Source.parse(metadata).id).toBe(source.id);
  });
  it("rejects private-source verified claims outside reviewed pages or without content verification", () => {
    const s = {
      ...source,
      provenance: { ...source.provenance, verified_pdf_pages: [7, 8] },
    };
    const verified = {
      ...entry("knowledge.verified"),
      verification_status: "VERIFIED_SOURCE",
      evidence: [
        {
          source_id: s.id,
          pdf_pages: [7],
          section: "Reviewed section",
          claim_scope: "author_position",
        },
      ],
    };
    const data = { schema_version: "1.0", sources: [s], entries: [verified] };
    expect(() => new KnowledgeRegistry(data)).not.toThrow();
    expect(
      () =>
        new KnowledgeRegistry({
          ...data,
          sources: [
            { ...s, provenance: { ...s.provenance, verified_pdf_pages: [] } },
          ],
        }),
    ).toThrow();
    expect(
      () =>
        new KnowledgeRegistry({
          ...data,
          entries: [
            {
              ...verified,
              evidence: [
                { ...verified.evidence[0], claim_scope: "derived_method" },
              ],
            },
          ],
        }),
    ).toThrow();
    expect(
      () =>
        new KnowledgeRegistry({
          ...data,
          sources: [
            { ...s, provenance: { ...s.provenance, content_verified: false } },
          ],
        }),
    ).toThrow();
    for (const pages of [[101], [9], []])
      expect(
        () =>
          new KnowledgeRegistry({
            ...data,
            entries: [
              {
                ...verified,
                evidence: [{ ...verified.evidence[0], pdf_pages: pages }],
              },
            ],
          }),
      ).toThrow();
  });
  it("applies all selection gates before relevance scoring", () => {
    const k = custom([
      entry("lens.context", {
        any_tags: ["hunger", "weather"],
        all_tags: ["choice"],
        excluded_tags: ["abstract"],
        required_system_types: ["resource"],
        modes: ["design"],
      }),
    ]);
    const base = {
      tags: ["hunger", "choice"],
      system_types: ["resource"],
      mode: "design",
      stage: "prototype",
    };
    expect(k.search("choice", base as any).map((e) => e.id)).toEqual([
      "lens.context",
    ]);
    for (const patch of [
      { tags: ["hunger"] },
      { tags: ["choice"] },
      { tags: ["hunger", "choice", "abstract"] },
      { system_types: ["narrative"] },
      { mode: "review" },
    ]) {
      expect(
        k.search("choice", { ...base, ...patch } as any),
        JSON.stringify(patch),
      ).toEqual([]);
    }
    expect(
      k.search("choice", { ...base, disabled_sources: [source.id] } as any),
    ).toEqual([]);
    expect(
      k.search("choice", {
        ...base,
        disabled_schools: ["fixture_school"],
      } as any),
    ).toEqual([]);
  });
  it("preserves general genre applicability and enforces explicitly limited genres and stages", () => {
    const generic = entry("lens.generic");
    const specialized = {
      ...entry("lens.specialized"),
      applicable_genres: ["survival"],
    };
    const k = custom([generic, specialized]);
    expect(
      k
        .search("choice", { genre: "puzzle", stage: "prototype" })
        .map((e) => e.id),
    ).toEqual(["lens.generic"]);
    expect(k.search("choice", { genre: "puzzle", stage: "release" })).toEqual(
      [],
    );
  });
  it("rejects malformed selection structures rather than silently dropping constraints", () => {
    expect(() =>
      Entry.parse(entry("lens.invalid", { modes: ["pretend"], all_tags: [] })),
    ).toThrow();
  });
  it("binds eligible questions to the system with explainable metadata and a ten-lens cap", () => {
    const selection = {
      any_tags: ["hunger"],
      all_tags: [],
      excluded_tags: [],
      required_system_types: ["resource"],
      modes: ["design"],
    };
    const k = custom(
      Array.from({ length: 14 }, (_, i) =>
        entry(`lens.number_${i}`, selection),
      ),
    );
    const context = {
      query: "hunger",
      system: "Expedition hunger",
      tags: ["hunger", "choice"],
      system_types: ["resource"],
      mode: "design",
      stage: "prototype",
    };
    const results = select(k, context);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(select(k, context)).toEqual(results);
    for (const lens of results) {
      expect(
        lens.bound_questions.every((q: string) => q.includes(context.system)),
      ).toBe(true);
      expect(lens.relevance.matched_tags).toContain("hunger");
      expect(lens.relevance.matched_system_types).toContain("resource");
      expect(lens.relevance.reasons.length).toBeGreaterThan(0);
    }
  });
  it("does not select specialized lenses without query, tags or required system context", () => {
    const k = custom([
      entry("lens.generic"),
      entry("lens.specific", {
        any_tags: ["hunger"],
        all_tags: [],
        excluded_tags: [],
        required_system_types: ["resource"],
        modes: ["design"],
      }),
    ]);
    const results = select(k, {
      query: "",
      system: "Unknown game",
      tags: [],
      system_types: [],
      mode: "design",
      stage: "prototype",
    });
    expect(results.some((r: any) => r.id === "lens.specific")).toBe(false);
    expect(results.every((r: any) => r.id === "lens.generic")).toBe(true);
  });
});

describe("expanded source-backed catalog", () => {
  it("records both exact user-supplied editions with content provenance", async () => {
    const k = await registry();
    for (const id of ["source.schell_ru_2019", "source.sylvester_ru_2020"]) {
      const s = k.data.sources.find((s) => s.id === id);
      expect(s, id).toBeDefined();
      expect(s!.verification_status).toBe("VERIFIED_SOURCE");
      expect(s!.provenance).toMatchObject({
        access: "user_supplied",
        content_verified: true,
        redistribution: "metadata_and_original_analysis_only",
      });
      expect(s!.provenance!.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(s!.provenance!.pdf_pages).toBeGreaterThan(0);
      const derived = k.data.entries.filter((e) => e.source_ids.includes(id));
      expect(derived.length).toBeGreaterThan(0);
      for (const e of derived) {
        expect(e.evidence_locator.trim(), e.id).not.toBe("");
        expect(e.description.length, e.id).toBeGreaterThan(30);
        const locators = e.evidence?.filter((ev) => ev.source_id === id) ?? [];
        expect(locators.length, e.id).toBeGreaterThan(0);
        for (const ev of locators) {
          expect(ev.section.trim(), e.id).not.toBe("");
          expect(ev.pdf_pages.length, e.id).toBeGreaterThan(0);
          for (const page of ev.pdf_pages) {
            expect(page).toBeGreaterThan(0);
            expect(page).toBeLessThanOrEqual(s!.provenance!.pdf_pages!);
            expect(s!.provenance!.verified_pdf_pages, e.id).toContain(page);
          }
        }
      }
    }
  });
  it("exposes contextual knowledge through the real query-only operation and project design mode", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "ludoscope-knowledge-query-"),
    );
    try {
      const store = new ProjectStore(root);
      await store.init();
      const e = entry("lens.operation_context", {
        any_tags: ["experience"],
        all_tags: [],
        excluded_tags: [],
        required_system_types: [],
        modes: ["design"],
      });
      e.title = "experience method";
      e.tags = ["experience"];
      await mkdir(path.join(root, ".ludoscope/knowledge"));
      await writeFile(
        path.join(root, ".ludoscope/knowledge/query.registry.json"),
        JSON.stringify({
          schema_version: "1.0",
          sources: [source],
          entries: [e],
        }),
      );
      const results = (await invoke(
        "ludoscope_knowledge_search",
        { query: "experience", limit: 50 },
        store,
      )) as any[];
      expect(results.some((e) => e.id === "lens.operation_context")).toBe(true);
      expect(
        results.some(
          (e) =>
            e.source_ids.includes("source.schell_ru_2019") ||
            e.source_ids.includes("source.sylvester_ru_2020"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("retrieves requested source-backed records precisely with evidence and respects disabled provenance", async () => {
    const k = await registry();
    const e = k.data.entries.find((e) =>
      e.source_ids.includes("source.schell_ru_2019"),
    )!;
    const found = k.get([
      e.id,
      "source.schell_ru_2019",
      "knowledge.does_not_exist",
    ]);
    expect(found.entries.map((e) => e.id)).toEqual([e.id]);
    expect(found.missing_ids).toContain("knowledge.does_not_exist");
    expect(found.sources.some((s) => s.id === "source.schell_ru_2019")).toBe(
      true,
    );
    expect(found.entries[0].evidence).toEqual(e.evidence);
    expect(k.get([e.id], {}, false).sources).toEqual([]);
    const disabled = k.get([e.id, "source.schell_ru_2019"], {
      disabled_sources: ["source.schell_ru_2019"],
    });
    expect(disabled.entries).toEqual([]);
    expect(disabled.sources).toEqual([]);
    expect(k.get([e.id], { disabled_schools: [e.school] }).entries).toEqual([]);
    const unresolved = k.data.entries.find(
      (e) => e.verification_status === "SOURCE_REQUIRED",
    );
    if (unresolved) expect(k.get([unresolved.id]).entries).toEqual([]);
  });
  it("removes every derived entry from search when either private source is disabled", async () => {
    const k = await registry();
    for (const id of ["source.schell_ru_2019", "source.sylvester_ru_2020"]) {
      const results = k.search("", { disabled_sources: [id], limit: 10000 });
      expect(results.every((e) => !e.source_ids.includes(id))).toBe(true);
      const school = k.data.entries.find((e) =>
        e.source_ids.includes(id),
      )!.school;
      expect(
        k
          .search("", { disabled_schools: [school], limit: 10000 })
          .every((e) => e.school !== school),
      ).toBe(true);
    }
  });
  it("selects contextual original lenses for hunger and automation without claiming author card identity", async () => {
    const k = await registry();
    const results = select(k, {
      query: "hunger automation",
      system: "Expedition food",
      tags: ["hunger", "automation", "choice", "feedback"],
      system_types: ["resource", "economy"],
      genre: "survival",
      stage: "prototype",
      mode: "design",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some(
        (e: any) =>
          e.source_ids.includes("source.schell_ru_2019") ||
          e.source_ids.includes("source.sylvester_ru_2020"),
      ),
    ).toBe(true);
    expect(
      results.every(
        (e: any) => e.kind === "Lens" && e.bound_questions.length > 0,
      ),
    ).toBe(true);
  });
  it("keeps relevant mechanic context bounded and diverse without upgrading evidence status", async () => {
    const m = JSON.parse(
      await readFile(
        new URL("../examples/survival/mechanic.json", import.meta.url),
        "utf8",
      ),
    );
    const result = await analyseMechanic({
      ...m,
      tags: ["hunger", "automation", "choice", "feedback"],
      expected_experiences: ["Meaningful decisions and mastery"],
      player_goal: "Choose food routes and automation tradeoffs",
    });
    expect(result.knowledge.length).toBeGreaterThan(0);
    expect(result.knowledge.length).toBeLessThanOrEqual(8);
    expect(
      new Set(result.knowledge.map((e) => e.school)).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      result.findings.every((f) => f.claim_type === "EXPERT_INFERENCE"),
    ).toBe(true);
    expect(result.experiment.hypothesis_type).toBe("DESIGN_HYPOTHESIS");
  });
  it("keeps a minimalist puzzle independent of production and economy requirements", async () => {
    const m = JSON.parse(
      await readFile(
        new URL("../examples/card-roguelike/mechanic.json", import.meta.url),
        "utf8",
      ),
    );
    const result = await analyseMechanic({
      ...m,
      id: "mechanic.puzzle",
      name: "Three switches",
      genre: "puzzle",
      resources: [],
      dependencies: [],
      tags: ["logic", "choice", "learning"],
      expected_experiences: ["Deduction"],
      player_goal: "Discover three consistent rules",
      rules: ["A toggles B", "B toggles C", "All switches open the exit"],
    });
    expect(result.affected_systems).toEqual([]);
    expect(result.knowledge.length).toBeLessThanOrEqual(8);
    expect(
      result.knowledge.every(
        (e) =>
          !e.selection?.required_system_types?.some((t) =>
            ["economy", "production"].includes(t),
          ),
      ),
    ).toBe(true);
    expect(
      result.findings.every((f) => f.claim_type === "EXPERT_INFERENCE"),
    ).toBe(true);
  });
});

describe("knowledge distribution boundaries", () => {
  it("excludes private books and extraction artifacts from the actual npm publication list", async () => {
    const { stdout } = await promisify(execFile)(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--json"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const [manifest] = JSON.parse(stdout);
    expect(manifest.files.length).toBeGreaterThan(0);
    const forbidden =
      /(^|\/)(scratch|private-sources|book-extracts)(\/|$)|\.pdf$|(^|\/)(schell-pages|sylvester-pages|source-map)\.json$/i;
    expect(
      manifest.files
        .map((f: { path: string }) => f.path)
        .filter((name: string) => forbidden.test(name)),
    ).toEqual([]);
    expect(
      manifest.files.some(
        (f: { path: string }) => f.path === "knowledge/registry.json",
      ),
    ).toBe(true);
  }, 30000);
});
