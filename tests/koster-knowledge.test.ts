import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { registry } from "../src/core/knowledge.js";
import { invoke } from "../src/core/operations.js";
import { ProjectStore } from "../src/project/store.js";
import { analyseMechanic } from "../src/analysis/mechanic.js";

const sourceId = "source.koster_user_pdf";
const exactCopySha =
  "1f8a80c9ab19a24ecd91b92b0e459cfcd220058583b89d9d0ef64c62672a4e1b";

describe("Koster source identity and reviewed evidence", () => {
  it("identifies the supplied 256-page copy without replacing unreviewed English edition metadata", async () => {
    const k = await registry();
    const supplied = k.data.sources.find((s) => s.id === sourceId)!;
    expect(supplied, sourceId).toBeDefined();
    expect(supplied.provenance).toMatchObject({
      access: "user_supplied",
      artifact_sha256: exactCopySha,
      pdf_pages: 256,
      content_verified: true,
      redistribution: "metadata_and_original_analysis_only",
    });
    expect(supplied.url).toBe(`urn:sha256:${exactCopySha}`);
    const english = k.data.sources.find((s) => s.id === "source.koster")!;
    expect(english.year).toBe(2013);
    expect(english.edition).toBe("2nd edition");
    expect(english.provenance).toMatchObject({
      access: "public_web",
      content_verified: false,
    });
    expect(english.identifier).toContain("9781449363208");
  });
  it("keeps every imported claim tied to in-bounds reviewed pages and its actual epistemic scope", async () => {
    const k = await registry();
    const source = k.data.sources.find((s) => s.id === sourceId)!;
    const entries = k.data.entries.filter((e) =>
      e.source_ids.includes(sourceId),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const evidence =
        e.evidence?.filter((ev) => ev.source_id === sourceId) ?? [];
      expect(evidence.length, e.id).toBeGreaterThan(0);
      expect(e.evidence_locator.trim(), e.id).not.toBe("");
      for (const ev of evidence) {
        expect(ev.section.trim(), e.id).not.toBe("");
        expect(ev.pdf_pages.length, e.id).toBeGreaterThan(0);
        for (const page of ev.pdf_pages) {
          expect(page, e.id).toBeGreaterThan(0);
          expect(page, e.id).toBeLessThanOrEqual(256);
          expect(source.provenance!.verified_pdf_pages, e.id).toContain(page);
        }
        if (e.verification_status === "VERIFIED_SOURCE")
          expect(ev.claim_scope, e.id).toBe("author_position");
      }
      if (
        [
          "ResearchMethod",
          "Lens",
          "ExperimentTemplate",
          "TheoryConflict",
        ].includes(e.kind)
      )
        expect(e.verification_status, e.id).toBe("EXPERT_INFERENCE");
    }
  });
  it("removes all derived knowledge when the supplied source is disabled and returns exact evidence through get", async () => {
    const k = await registry();
    const entries = k.data.entries.filter((e) =>
      e.source_ids.includes(sourceId),
    );
    const first = entries[0]!;
    expect(first).toBeDefined();
    expect(
      k
        .search("", { disabled_sources: [sourceId], limit: 10000 })
        .every((e) => !e.source_ids.includes(sourceId)),
    ).toBe(true);
    const result = k.get([first.id]);
    expect(result.entries).toEqual([first]);
    expect(result.sources.some((s) => s.id === sourceId)).toBe(true);
    const disabled = k.get([first.id, sourceId], {
      disabled_sources: [sourceId],
    });
    expect(disabled.entries).toEqual([]);
    expect(disabled.sources).toEqual([]);
  });
});

describe("Koster practical retrieval without a genre prescription", () => {
  it.each(["mastery", "освоение", "pattern", "паттерны"])(
    "retrieves source-backed context for %s through query-only operation",
    async (query) => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "ludoscope-koster-query-"),
      );
      try {
        const store = new ProjectStore(root);
        await store.init();
        const result = (await invoke(
          "ludoscope_knowledge_search",
          { query, limit: 50 },
          store,
        )) as { source_ids: string[] }[];
        expect(
          result.some((e) => e.source_ids.includes(sourceId)),
          query,
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("keeps learning a three-rule puzzle separate from production or economic-system requirements", async () => {
    const base = JSON.parse(
      await readFile(
        new URL("../examples/card-roguelike/mechanic.json", import.meta.url),
        "utf8",
      ),
    );
    const result = await analyseMechanic({
      ...base,
      id: "mechanic.koster_puzzle",
      name: "Pattern switches",
      genre: "puzzle",
      resources: [],
      dependencies: [],
      tags: ["pattern", "mastery", "learning", "choice"],
      player_goal: "Discover three consistent transformations",
      expected_experiences: ["Understand and apply a pattern"],
      rules: ["A toggles B", "B toggles C", "All switches open the exit"],
    });
    expect(result.affected_systems).toEqual([]);
    expect(result.knowledge.some((e) => e.source_ids.includes(sourceId))).toBe(
      true,
    );
    expect(
      result.knowledge.every(
        (e) =>
          !e.selection?.required_system_types.some((t) =>
            ["production", "economy"].includes(t),
          ),
      ),
    ).toBe(true);
    expect(
      result.findings.every((f) => f.claim_type === "EXPERT_INFERENCE"),
    ).toBe(true);
  });
});

describe("Koster publication boundary", () => {
  it("does not package the supplied book, OCR images, extracted pages or private mappings", async () => {
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
    const forbidden =
      /(^|\/)(scratch|private-sources|book-extracts|koster-ocr)(\/|$)|\.pdf$|(^|\/)(koster-pages|source-map)\.json$|(^|\/)koster\.txt$/i;
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

describe("source evidence extraction quality regression", () => {
  it("accepts distinct substantive pages after stripping repeated page headers", async () => {
    const { assertSubstantivePages } =
      await import("../scripts/source-evidence-quality.mjs");
    const pages = [
      "Shared synthetic header\nPlayers investigate unfamiliar patterns through observation, prediction, deliberate action, visible consequences, reflection, repeated practice, contextual comparison, flexible exploration, and gradual understanding.",
      "Shared synthetic header\nDesigners examine tutorial sequences using explicit prerequisites, varied challenges, accessible feedback, understandable goals, transparent constraints, optional assistance, recorded observations, and careful interpretation.",
    ];
    const result = assertSubstantivePages(pages, [1, 2]);
    expect(result.checked_pages).toBe(2);
    expect(result.excluded_repeated_lines).toBeGreaterThanOrEqual(1);
  });
  it("rejects long watermark-only extraction, repetitive token padding and invalid page bounds without leaking text", async () => {
    const { assertSubstantivePages } =
      await import("../scripts/source-evidence-quality.mjs");
    const watermark = "secret-watermark-channel ".repeat(20);
    for (const pages of [[watermark, watermark], ["padding ".repeat(100)]]) {
      expect(() => assertSubstantivePages(pages, [1])).toThrow();
      try {
        assertSubstantivePages(pages, [1]);
      } catch (error) {
        expect(String(error)).not.toContain("secret-watermark-channel");
      }
    }
    const readable = [
      "A synthetic source paragraph contains enough separate words to distinguish meaningful explanatory material from repeated advertisements or token padding during conservative automated extraction quality checks.",
    ];
    for (const invalid of [0, 2, -1])
      expect(() => assertSubstantivePages(readable, [invalid])).toThrow();
  });
});

describe("source-backed Mastery operation", () => {
  it("adds learning context to structural issues without upgrading the plan to observed mastery and respects source disable", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "ludoscope-koster-mastery-"),
    );
    try {
      const store = new ProjectStore(root);
      await store.init();
      const input = {
        skills: [
          {
            id: "skill.pattern",
            requires: [],
            introduced_at: 0,
            practice: ["Recognize a pattern in a small puzzle"],
            variation: [],
          },
          {
            id: "skill.transfer",
            requires: ["skill.pattern"],
            introduced_at: 1,
            practice: [],
            variation: ["Apply the rule in a changed layout"],
          },
        ],
      };
      const result = (await invoke(
        "ludoscope_mastery_analysis",
        input,
        store,
      )) as {
        claim_type: string;
        evidence_scope: string;
        issues: string[];
        knowledge: { source_ids: string[] }[];
        research_questions: string[];
      };
      expect(result.claim_type).toBe("EXPERT_INFERENCE");
      expect(result.evidence_scope).toBe("structural_plan_only");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.knowledge.length).toBeLessThanOrEqual(6);
      expect(
        result.knowledge.some((e) => e.source_ids.includes(sourceId)),
      ).toBe(true);
      expect(result.research_questions.length).toBeGreaterThan(0);
      const { writeFile } = await import("node:fs/promises");
      const { parse, stringify } = await import("yaml");
      const file = path.join(root, ".ludoscope/project.yaml");
      const profile = parse(await readFile(file, "utf8"));
      profile.disabled_sources = [sourceId];
      await writeFile(file, stringify(profile));
      const filtered = (await invoke(
        "ludoscope_mastery_analysis",
        input,
        store,
      )) as typeof result;
      expect(
        filtered.knowledge.every((e) => !e.source_ids.includes(sourceId)),
      ).toBe(true);
      expect(filtered.claim_type).toBe("EXPERT_INFERENCE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
