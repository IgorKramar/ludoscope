import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  mkdir,
  symlink,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProjectStore, scan } from "../src/project/store.js";
import { createFile, readBounded, contained } from "../src/core/files.js";
import { createServer } from "../src/mcp/server.js";
import { registry, projectRegistry } from "../src/core/knowledge.js";
import { operations, invoke } from "../src/core/operations.js";
const exec = promisify(execFile);
const appRoot = path.resolve(import.meta.dirname, "..");
let root: string;
let outside: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ludoscope-test-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "ludoscope-outside-"));
});
afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]);
});
const decision = async () =>
  JSON.parse(
    await readFile(path.join(appRoot, "tests/fixtures/decision.json"), "utf8"),
  );
describe("project persistence and filesystem boundaries", () => {
  it("initializes and reopens profile, previews decisions and refuses overwrite", async () => {
    const store = new ProjectStore(root);
    const p = await store.init("en");
    expect(p.language).toBe("en");
    const draft = await store.record(await decision(), false);
    expect(draft.written).toBe(false);
    expect(await store.decisions()).toEqual([]);
    const committed = await store.record(await decision(), true);
    expect(committed.written).toBe(true);
    const reopened = new ProjectStore(root);
    expect((await reopened.context()).decisions[0].chosen).toBe(
      "Contextual hunger",
    );
    await expect(
      reopened.record({ ...(await decision()), chosen: "Overwritten" }, true),
    ).rejects.toThrow();
    expect((await reopened.decisions())[0].chosen).toBe("Contextual hunger");
    await expect(reopened.init()).rejects.toThrow();
    expect((await reopened.profile()).language).toBe("en");
  });
  it("previews immutable artifacts, persists versions and reopens the latest mechanic", async () => {
    const store = new ProjectStore(root);
    await store.init();
    const mechanic = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/mechanic.json"),
        "utf8",
      ),
    );
    const artifact = {
      kind: "mechanic",
      id: mechanic.id,
      version: 1,
      data: mechanic,
    };
    const preview = await store.recordArtifact(artifact, false);
    expect(preview.written).toBe(false);
    await expect(readFile(path.join(root, preview.path))).rejects.toThrow();
    await store.recordArtifact(artifact, true);
    expect((await new ProjectStore(root).mechanic(mechanic.id)).name).toBe(
      mechanic.name,
    );
    await expect(
      store.recordArtifact(
        { ...artifact, data: { ...mechanic, name: "Overwrite" } },
        true,
      ),
    ).rejects.toThrow();
    await store.recordArtifact(
      {
        ...artifact,
        version: 2,
        data: { ...mechanic, name: "Revised hunger" },
      },
      true,
    );
    expect((await new ProjectStore(root).mechanic(mechanic.id)).name).toBe(
      "Revised hunger",
    );
    expect(
      JSON.parse(await readFile(path.join(root, preview.path), "utf8")).data
        .name,
    ).toBe(mechanic.name);
    expect((await new ProjectStore(root).context()).artifact_index).toEqual([
      {
        kind: "mechanic",
        id: mechanic.id,
        version: 1,
        path: `.ludoscope/mechanics/${mechanic.id}/v1.json`,
      },
      {
        kind: "mechanic",
        id: mechanic.id,
        version: 2,
        path: `.ludoscope/mechanics/${mechanic.id}/v2.json`,
      },
    ]);
  });
  it("rejects mismatching document identity and version before persisting artifacts", async () => {
    const store = new ProjectStore(root);
    await store.init();
    const doc = {
      schema_version: "1.0",
      id: "document.vision",
      version: 1,
      type: "GameVision",
      language: "ru",
      status: "draft",
      sources: [],
      links: [],
      history: [],
      body: "Draft only.",
    };
    await expect(
      store.recordArtifact(
        { kind: "document", id: "document.other", version: 1, data: doc },
        true,
      ),
    ).rejects.toThrow(/IDs/);
    await expect(
      store.recordArtifact(
        { kind: "document", id: doc.id, version: 2, data: doc },
        true,
      ),
    ).rejects.toThrow(/versions/);
    const saved = await store.recordArtifact(
      { kind: "document", id: doc.id, version: 1, data: doc },
      true,
    );
    expect(saved.written).toBe(true);
  });
  it("updates a reviewed graph atomically, preserves backup and rejects missing or stale previews", async () => {
    const store = new ProjectStore(root);
    await store.init();
    const before = await readFile(
      path.join(root, ".ludoscope/design-graph.json"),
      "utf8",
    );
    const graph = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/graph.json"),
        "utf8",
      ),
    );
    const preview = await store.updateGraph(graph, false);
    expect(preview.written).toBe(false);
    expect(
      await readFile(path.join(root, ".ludoscope/design-graph.json"), "utf8"),
    ).toBe(before);
    await expect(store.updateGraph(graph, true)).rejects.toThrow(
      /expected_sha256/,
    );
    const written = await store.updateGraph(
      graph,
      true,
      preview.expected_sha256,
    );
    expect(written.written).toBe(true);
    expect(
      (await new ProjectStore(root).graph()).nodes.map((n) => n.id),
    ).toEqual(graph.nodes.map((n: any) => n.id));
    expect(
      await readFile(
        path.join(
          root,
          ".ludoscope/history",
          preview.expected_sha256 + ".json",
        ),
        "utf8",
      ),
    ).toBe(before);
    const current = await readFile(
      path.join(root, ".ludoscope/design-graph.json"),
      "utf8",
    );
    await expect(
      store.updateGraph(
        { schema_version: "1.0", nodes: [], edges: [] },
        true,
        preview.expected_sha256,
      ),
    ).rejects.toThrow(/changed since preview/);
    expect(
      await readFile(path.join(root, ".ludoscope/design-graph.json"), "utf8"),
    ).toBe(current);
  });
  it("rejects symlink artifact directories, graph targets and backup directories", async () => {
    const store = new ProjectStore(root);
    await store.init();
    await symlink(outside, path.join(root, ".ludoscope", "mechanics"), "dir");
    const mechanic = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/mechanic.json"),
        "utf8",
      ),
    );
    await expect(
      store.recordArtifact(
        { kind: "mechanic", id: mechanic.id, version: 1, data: mechanic },
        true,
      ),
    ).rejects.toThrow(/Symbolic/);
    const graph = await store.graph();
    const preview = await store.updateGraph(graph, false);
    await symlink(outside, path.join(root, ".ludoscope", "history"), "dir");
    await expect(
      store.updateGraph(graph, true, preview.expected_sha256),
    ).rejects.toThrow(/Symbolic/);
    await rm(path.join(root, ".ludoscope/design-graph.json"));
    await writeFile(path.join(outside, "graph.json"), JSON.stringify(graph));
    await symlink(
      path.join(outside, "graph.json"),
      path.join(root, ".ludoscope/design-graph.json"),
    );
    await expect(store.updateGraph(graph, false)).rejects.toThrow(/Symbolic/);
  });
  it("rejects path traversal, absolute paths, backslashes and symlink parents", async () => {
    for (const p of [
      "../escape",
      "a/../../escape",
      "a\\..\\escape",
      "/tmp/escape",
    ])
      await expect(contained(root, p, true)).rejects.toThrow();
    await symlink(outside, path.join(root, "linked"), "dir");
    await expect(
      createFile(root, "linked/escape.txt", "secret"),
    ).rejects.toThrow(/Symbolic/);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(root, "secret.txt"),
    );
    await expect(readBounded(root, "secret.txt")).rejects.toThrow(/Symbolic/);
  });
  it("retrieves an explicitly imported package and honors disabled source settings", async () => {
    await new ProjectStore(root).init();
    const builtin = await registry();
    const entry = structuredClone(
      builtin.data.entries.find((e) => e.source_ids.length)!,
    );
    const source = structuredClone(
      builtin.data.sources.find((s) => s.id === entry.source_ids[0])!,
    );
    source.id = "source.localtest";
    entry.id = "knowledge.localtest";
    entry.source_ids = [source.id];
    entry.description = "Local zyxuniquetoken interpretation.";
    entry.title = "zyxuniquetoken";
    entry.related_entry_ids = [];
    entry.conflicting_entry_ids = [];
    const data = { schema_version: "1.0", sources: [source], entries: [entry] };
    await createFile(
      root,
      ".ludoscope/knowledge/test.registry.json",
      JSON.stringify(data),
    );
    expect(
      (await projectRegistry(root)).search("zyxuniquetoken").map((e) => e.id),
    ).toEqual(["knowledge.localtest"]);
    const { parse, stringify } = await import("yaml");
    const file = path.join(root, ".ludoscope/project.yaml");
    const profile = parse(await readFile(file, "utf8"));
    profile.disabled_sources = [source.id];
    await writeFile(file, stringify(profile));
    expect(
      await invoke(
        "ludoscope_knowledge_search",
        { query: "zyxuniquetoken" },
        new ProjectStore(root),
      ),
    ).toEqual([]);
  });
  it("blocks oversized imports and symlinked memory directories", async () => {
    await new ProjectStore(root).init();
    await symlink(outside, path.join(root, ".ludoscope", "decisions"), "dir");
    await expect(
      new ProjectStore(root).record(await decision(), true),
    ).rejects.toThrow(/Symbolic/);
    await expect(
      createFile(root, "large.txt", "a".repeat(2 * 1024 * 1024 + 1)),
    ).rejects.toThrow(/large/);
  });
  it("fingerprints changed source files and skips symlink directories without guessing gameplay", async () => {
    await writeFile(path.join(root, "project.godot"), "config_version=5");
    await writeFile(path.join(root, "hunger.gd"), "extends Node");
    await symlink(outside, path.join(root, "linked"), "dir");
    const raw = Buffer.from([0xff, 0x00, 0x80]);
    await writeFile(path.join(root, "encoded.gd"), raw);
    const a = await scan(root);
    expect(a.files.find((f) => f.path === "encoded.gd")!.sha256).toBe(
      (await import("node:crypto"))
        .createHash("sha256")
        .update(raw)
        .digest("hex"),
    );
    expect(a.engine_evidence).toHaveLength(1);
    expect(a.skipped).toContain("linked");
    await writeFile(path.join(root, "hunger.gd"), "extends Resource");
    const b = await scan(root);
    expect(a.files.find((f) => f.path === "hunger.gd")!.sha256).not.toBe(
      b.files.find((f) => f.path === "hunger.gd")!.sha256,
    );
    expect(b).not.toHaveProperty("mechanics");
  });
});
describe("shared operations and real MCP protocol", () => {
  it("validates malformed calls for every registered operation", async () => {
    const s = new ProjectStore(root);
    await s.init();
    for (const name of Object.keys(operations) as (keyof typeof operations)[])
      await expect(invoke(name, { undeclared: true }, s)).rejects.toThrow();
  });
  it("uses SDK Client over paired transports, strict calls, typed envelopes and read-only annotations", async () => {
    await new ProjectStore(root).init();
    const server = createServer(root);
    const client = new Client({
      name: "ludoscope-contract-test",
      version: "1.0",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.length).toBe(Object.keys(operations).length);
      expect(
        listed.tools.find((t) => t.name === "ludoscope_simulate_system")!
          .annotations?.readOnlyHint,
      ).toBe(true);
      expect(
        listed.tools.find((t) => t.name === "ludoscope_record_decision")!
          .annotations?.readOnlyHint,
      ).toBe(false);
      const model = JSON.parse(
        await readFile(
          path.join(appRoot, "examples/economic-tycoon/economy.json"),
          "utf8",
        ),
      );
      const result = await client.callTool({
        name: "ludoscope_simulate_system",
        arguments: { model },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema_version: "1.0",
        operation: "ludoscope_simulate_system",
        result: { claim_type: "MODEL_RESULT", seed: 42, final: { money: 20 } },
      });
      const bad = await client.callTool({
        name: "ludoscope_simulate_system",
        arguments: { model: { id: "invalid" } },
      });
      expect(bad.isError).toBe(true);
      const invalidGraph = await client.callTool({
        name: "ludoscope_analyse_dependencies",
        arguments: {
          id: "missing",
          graph: { schema_version: "1.0", nodes: [], edges: [] },
        },
      });
      expect(invalidGraph.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("accepts valid and rejects invalid actual SDK calls for every tool without implicit writes", async () => {
    const store = new ProjectStore(root);
    await store.init();
    const mechanic = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/mechanic.json"),
        "utf8",
      ),
    );
    const graph = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/graph.json"),
        "utf8",
      ),
    );
    const model = JSON.parse(
      await readFile(
        path.join(appRoot, "examples/survival/economy.json"),
        "utf8",
      ),
    );
    const inputs: Record<keyof typeof operations, unknown> = {
      ludoscope_record_artifact: {
        artifact: {
          kind: "mechanic",
          id: mechanic.id,
          version: 1,
          data: mechanic,
        },
      },
      ludoscope_update_graph: { graph },
      ludoscope_project_scan: {},
      ludoscope_project_context: {},
      ludoscope_knowledge_search: { query: "choice" },
      ludoscope_knowledge_get: { ids: ["source.mda", "knowledge.lens_consequence"], include_sources: true },
      ludoscope_get_lenses: { query: "", system: "Hunger" },
      ludoscope_analyse_mechanic: { mechanic },
      ludoscope_analyse_dependencies: { id: mechanic.id, graph },
      ludoscope_analyse_systems: { graph },
      ludoscope_validate_rules: {
        rules: {
          initial: "start",
          states: ["start", "win"],
          terminal: ["win"],
          transitions: [{ from: "start", to: "win", action: "solve" }],
        },
      },
      ludoscope_analyse_economy: { model },
      ludoscope_simulate_system: { model },
      ludoscope_compare_variants: { models: [model], seeds: [1, 2] },
      ludoscope_design_experiment: {
        experiment: {
          id: "experiment.hunger",
          question: "Does hunger change routes?",
          hypothesis: "Players choose safe routes.",
          method: "playtest",
          participants: "Recruit 6 volunteers; none measured yet.",
          conditions: ["Same goal"],
          metrics: ["route_choice"],
          interpretation: "Compare routes descriptively.",
          limitations: ["Small convenience sample"],
        },
      },
      ludoscope_evaluate_playtest: {
        observations: [
          {
            participant: "p1",
            kind: "observation",
            metric: "route",
            text: "Safe route selected",
          },
        ],
      },
      ludoscope_generate_report: { mechanic, language: "en" },
      ludoscope_check_consistency: {},
      ludoscope_record_decision: { decision: await decision() },
      ludoscope_mastery_analysis: {
        skills: [
          {
            id: "eat",
            requires: [],
            introduced_at: 0,
            practice: ["Recover once"],
            variation: ["Limited food"],
          },
        ],
      },
      ludoscope_ux_review: {
        artifacts: [],
        goal: "Understand hunger",
        visible_state: [],
        feedback: [],
        error_recovery: [],
        accessibility: [],
      },
      ludoscope_narrative_consistency: {
        initial: { treaty: true },
        canon: { treaty: true },
        events: [],
      },
      ludoscope_procedural_review: {
        samples: [
          {
            id: "level.one",
            pattern: "room",
            valid: true,
            reachable: true,
            solvable: true,
            resources: ["food"],
          },
        ],
        required_resources: ["food"],
      },
      ludoscope_sensitivity_analysis: {
        model,
        process_id: "farm",
        multipliers: [0.5, 1, 2],
      },
    };
    const before = await readFile(
      path.join(root, ".ludoscope/project.yaml"),
      "utf8",
    );
    const server = createServer(root);
    const client = new Client({ name: "all-tools-contract", version: "1.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      for (const name of Object.keys(
        operations,
      ) as (keyof typeof operations)[]) {
        const valid = await client.callTool({
          name,
          arguments: inputs[name] as Record<string, unknown>,
        });
        expect(
          valid.isError,
          `${name}: ${JSON.stringify(valid.content)}`,
        ).not.toBe(true);
        expect(valid.structuredContent).toMatchObject({
          schema_version: "1.0",
          operation: name,
        });
        expect(JSON.parse(JSON.stringify(valid.structuredContent))).toEqual(
          valid.structuredContent,
        );
        const invalid = await client.callTool({
          name,
          arguments: { unexpected: true },
        });
        expect(invalid.isError, name).toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
    expect(await store.decisions()).toEqual([]);
    expect(
      await readFile(path.join(root, ".ludoscope/project.yaml"), "utf8"),
    ).toBe(before);
  });
  it("runs a built stdio MCP server with stdout reserved for protocol", async () => {
    await new ProjectStore(root).init();
    const client = new Client({ name: "stdio-contract", version: "1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(appRoot, "dist/mcp/index.js")],
      env: { ...process.env, LUDOSCOPE_PROJECT_ROOT: root } as Record<
        string,
        string
      >,
      stderr: "pipe",
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "ludoscope_project_context",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        result: { profile: { language: "ru" } },
      });
    } finally {
      await client.close();
    }
  }, 15000);
});
describe("CLI executable vertical slice", () => {
  const run = (...args: string[]) =>
    exec(
      process.execPath,
      [path.join(appRoot, "dist/cli/index.js"), "--project", root, ...args],
      { cwd: appRoot, timeout: 15000 },
    );
  it("imports a non-suffixed package through explicit CLI permission and retrieves it after reopen", async () => {
    await run("init");
    const builtin = await registry();
    const entry = structuredClone(builtin.data.entries[0]);
    Object.assign(entry, {
      id: "knowledge.cliimport",
      title: "cliuniquetoken",
      description: "Original test-only cliuniquetoken method.",
      source_ids: [],
      related_entry_ids: [],
      conflicting_entry_ids: [],
      verification_status: "EXPERT_INFERENCE",
      evidence_locator: "Synthetic fixture",
      confidence: "low",
    });
    await writeFile(
      path.join(root, "notes.json"),
      JSON.stringify({ schema_version: "1.0", sources: [], entries: [entry] }),
    );
    await expect(
      run("knowledge", "import", "notes.json", "--license", "MIT"),
    ).rejects.toThrow();
    const preview = JSON.parse(
      (
        await run(
          "knowledge",
          "import",
          "notes.json",
          "--license",
          "MIT",
          "--allow-redistribution",
        )
      ).stdout,
    );
    expect(preview.committed).toBe(false);
    expect(
      JSON.parse((await run("knowledge", "search", "cliuniquetoken")).stdout),
    ).toEqual([]);
    const committed = JSON.parse(
      (
        await run(
          "knowledge",
          "import",
          "notes.json",
          "--license",
          "MIT",
          "--allow-redistribution",
          "--commit",
        )
      ).stdout,
    );
    expect(committed.committed).toBe(true);
    expect(committed.path).toMatch(/\.registry\.json$/);
    expect(
      JSON.parse(
        (await run("knowledge", "search", "cliuniquetoken")).stdout,
      ).map((e: any) => e.id),
    ).toEqual(["knowledge.cliimport"]);
    await copyFile(
      path.join(root, "notes.json"),
      path.join(root, "duplicate.json"),
    );
    await expect(
      run(
        "knowledge",
        "import",
        "duplicate.json",
        "--license",
        "MIT",
        "--allow-redistribution",
        "--commit",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(root, ".ludoscope/knowledge/duplicate.registry.json")),
    ).rejects.toThrow();
    await expect(
      readFile(
        path.join(
          root,
          ".ludoscope/knowledge/duplicate.registry.json.permission.json",
        ),
      ),
    ).rejects.toThrow();
    expect(
      JSON.parse(
        (await run("knowledge", "search", "cliuniquetoken")).stdout,
      ).map((e: any) => e.id),
    ).toEqual(["knowledge.cliimport"]);
  });
  it("initializes, analyses, reports, previews, commits, reopens and validates", async () => {
    expect(
      JSON.parse((await run("init", "--language", "en")).stdout).language,
    ).toBe("en");
    await copyFile(
      path.join(appRoot, "examples/survival/mechanic.json"),
      path.join(root, "mechanic.json"),
    );
    await copyFile(
      path.join(appRoot, "tests/fixtures/decision.json"),
      path.join(root, "decision.json"),
    );
    const analysis = JSON.parse(
      (await run("analyse", "mechanic", "mechanic.json")).stdout,
    );
    expect(analysis.mechanic.id).toBe("mechanic.hunger");
    expect(
      (
        await run(
          "report",
          "mechanic.json",
          "--format",
          "markdown",
          "--language",
          "en",
        )
      ).stdout,
    ).toContain("Hunger with automation");
    const reportPath = ".ludoscope/reports/hunger.md";
    await run("report", "mechanic.json", "--output", reportPath);
    expect(await readFile(path.join(root, reportPath), "utf8")).toContain(
      "Hunger with automation",
    );
    expect(
      JSON.parse((await run("decision", "decision.json")).stdout).written,
    ).toBe(false);
    expect(
      JSON.parse((await run("decision", "decision.json", "--commit")).stdout)
        .written,
    ).toBe(true);
    expect(JSON.parse((await run("context")).stdout).decisions).toHaveLength(1);
    expect(JSON.parse((await run("validate")).stdout).valid).toBe(true);
    expect(JSON.parse((await run("doctor")).stdout).network_required).toBe(
      false,
    );
    await expect(
      run("report", "mechanic.json", "--output", "../escape.md"),
    ).rejects.toThrow();
  });
});
