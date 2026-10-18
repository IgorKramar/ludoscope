#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { ProjectStore, scan } from "../project/store.js";
import { readBounded, createFile } from "../core/files.js";
import { registry } from "../core/knowledge.js";
import {
  Mechanic,
  Decision,
  RegistrySchema,
  Document,
  Project,
} from "../core/schemas.js";
import { analyseMechanic } from "../analysis/mechanic.js";
import { renderReport, renderDocument } from "../core/report.js";
import { impact, mermaid } from "../core/graph.js";
import { simulate, economy, compare } from "../simulation/index.js";
import { operations, invoke, type OperationName } from "../core/operations.js";
import { evaluatePlaytest, importPlaytest } from "../analysis/labs.js";
const cli = new Command()
  .name("ludoscope")
  .description("Локальные инструменты геймдизайна / Local game design tools")
  .version("0.1.0")
  .option("--project <path>", "Project root", ".");
const store = () => new ProjectStore(path.resolve(cli.opts().project));
const print = (x: unknown) =>
  console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
const json = async (p: string) =>
  JSON.parse(await readBounded(store().root, p));
cli
  .command("init")
  .option("--language <language>", "ru or en", "ru")
  .action(async (o) => {
    Project.shape.language.parse(o.language);
    print(await store().init(o.language));
  });
cli
  .command("scan [path]")
  .action(async (p) =>
    print(await scan(path.resolve(p ?? cli.opts().project))),
  );
cli.command("context").action(async () => print(await store().context()));
const knowledge = cli.command("knowledge");
knowledge
  .command("search <query>")
  .action(async (query) =>
    print(await invoke("ludoscope_knowledge_search", { query }, store())),
  );
knowledge
  .command("import <file>")
  .requiredOption("--license <license>")
  .requiredOption("--allow-redistribution")
  .option("--commit")
  .action(async (file, o) => {
    const { importKnowledge, projectRegistry, KnowledgeRegistry } =
      await import("../core/knowledge.js");
    await store().profile();
    const k = importKnowledge(await json(file), {
      license: o.license,
      redistribution: o.allowRedistribution,
    });
    const current = await projectRegistry(store().root);
    new KnowledgeRegistry({
      schema_version: "1.0",
      sources: [...current.data.sources, ...k.data.sources],
      entries: [...current.data.entries, ...k.data.entries],
    });
    const dest = `.ludoscope/knowledge/${path.basename(file).replace(/\.json$/, "")}.registry.json`;
    const result = {
      path: dest,
      sources: k.data.sources.length,
      entries: k.data.entries.length,
      untrusted: true,
      committed: Boolean(o.commit),
    };
    if (o.commit) {
      await createFile(store().root, dest, JSON.stringify(k.data, null, 2));
      await createFile(
        store().root,
        dest + ".permission.json",
        JSON.stringify(
          {
            license: o.license,
            redistribution: true,
            imported_at: new Date().toISOString(),
            source_file: file,
          },
          null,
          2,
        ),
      );
    }
    print(result);
  });
const analyse = cli.command("analyse");
analyse.command("mechanic <id-or-file>").action(async (id) => {
  const m = id.endsWith(".json") ? await json(id) : await store().mechanic(id);
  print(await invoke("ludoscope_analyse_mechanic", { mechanic: m }, store()));
});
analyse
  .command("dependencies <id>")
  .option("--mermaid")
  .action(async (id, o) => {
    const g = await store().graph();
    print(o.mermaid ? mermaid(g) : impact(g, id));
  });
analyse
  .command("economy <model>")
  .action(async (f) => print(economy(await json(f))));
cli
  .command("simulate <model>")
  .option("--seeds <seeds>", "comma-separated seeds")
  .action(async (f, o) => {
    const m = await json(f);
    print(o.seeds ? compare(m, o.seeds.split(",").map(Number)) : simulate(m));
  });
cli
  .command("report <mechanic-file>")
  .option("--format <format>", "markdown or json", "markdown")
  .option("--language <lang>", "ru or en", "ru")
  .option(
    "--output <path>",
    "Explicit create-only destination under .ludoscope/reports",
  )
  .action(async (f, o) => {
    if (!["markdown", "json"].includes(o.format))
      throw new Error("Unsupported report format");
    Project.shape.language.parse(o.language);
    const r = (await invoke(
      "ludoscope_analyse_mechanic",
      { mechanic: await json(f) },
      store(),
    )) as Awaited<ReturnType<typeof analyseMechanic>>;
    const output =
      o.format === "json"
        ? JSON.stringify(r, null, 2)
        : renderReport(r, o.language);
    if (o.output) {
      if (!o.output.startsWith(".ludoscope/reports/"))
        throw new Error("Output must be under .ludoscope/reports/");
      await createFile(store().root, o.output, output);
    } else print(output);
  });
cli
  .command("document <file>")
  .action(async (f) => print(renderDocument(await json(f))));
cli
  .command("artifact <file>")
  .option("--commit", "Explicitly save a new immutable artifact version")
  .action(async (f, o) =>
    print(
      await invoke(
        "ludoscope_record_artifact",
        { artifact: await json(f), commit: Boolean(o.commit) },
        store(),
      ),
    ),
  );
cli
  .command("graph <file>")
  .option("--commit", "Explicit graph replacement with backup")
  .option("--expected-sha256 <hash>", "Reviewed preview hash")
  .action(async (f, o) =>
    print(
      await invoke(
        "ludoscope_update_graph",
        {
          graph: await json(f),
          commit: Boolean(o.commit),
          expected_sha256: o.expectedSha256,
        },
        store(),
      ),
    ),
  );
cli
  .command("decision <file>")
  .option("--commit", "Explicitly save approved record; default preview")
  .action(async (f, o) =>
    print(await store().record(await json(f), Boolean(o.commit))),
  );
cli
  .command("playtest <file>")
  .option("--format <format>", "csv or json", "json")
  .action(async (f, o) => {
    if (!["csv", "json"].includes(o.format))
      throw new Error("Unsupported format");
    print(
      evaluatePlaytest(
        importPlaytest(await readBounded(store().root, f), o.format),
      ),
    );
  });
cli.command("audit [path]").action(async (p) => {
  const s = p ? new ProjectStore(path.resolve(p)) : store();
  print({
    scan: await scan(s.root),
    consistency: await invoke("ludoscope_check_consistency", {}, s),
  });
});
cli.command("validate").action(async () => {
  const k = await registry();
  const project = await invoke("ludoscope_check_consistency", {}, store());
  print({
    valid: true,
    knowledge: {
      sources: k.data.sources.length,
      entries: k.data.entries.length,
    },
    project,
  });
});
cli.command("doctor").action(async () => {
  const k = await registry();
  print({
    node: process.version,
    node_supported: Number(process.versions.node.split(".")[0]) >= 22,
    knowledge: {
      sources: k.data.sources.length,
      entries: k.data.entries.length,
    },
    network_required: false,
    telemetry: false,
    project_root: store().root,
  });
});
cli
  .command("tool <name> <input-file>")
  .description("Invoke a typed core operation with JSON arguments")
  .action(async (name, file) => {
    if (!(name in operations)) throw new Error("Unknown tool");
    print(await invoke(name as OperationName, await json(file), store()));
  });
try {
  await cli.parseAsync();
} catch (e) {
  console.error(
    JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
  );
  process.exitCode = 1;
}
