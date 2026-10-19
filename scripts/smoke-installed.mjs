import { agentCapabilities } from "../dist/integration/api.js";
import { operations } from "../dist/core/operations.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const installed = process.argv[2];
if (!installed)
  throw new Error(
    "Usage: node scripts/smoke-installed.mjs /absolute/installed/plugin",
  );
const root = await mkdtemp(path.join(os.tmpdir(), "ludoscope-installed-"));
const exec = promisify(execFile);
let client;
try {
  const cli = path.join(installed, "dist/cli/index.js");
  await exec(process.execPath, [cli, "--project", root, "init"]);
  client = new Client({ name: "installed-plugin-smoke", version: "1.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(installed, "dist/mcp/index.js")],
      env: { ...process.env, LUDOSCOPE_PROJECT_ROOT: root },
      stderr: "pipe",
    }),
  );
  const { tools } = await client.listTools();
  if (
    tools.length !==
    Object.keys(operations).length + agentCapabilities.length
  )
    throw new Error("Installed tool count differs from current core");
  const context = await client.callTool({
    name: "ludoscope_project_context",
    arguments: {},
  });
  if (context.isError) throw new Error(JSON.stringify(context));
  const knowledge = await client.callTool({
    name: "ludoscope_knowledge_get",
    arguments: {
      ids: [
        "knowledge.schell.meaningful_alternatives",
        "source.sylvester_ru_2020",
      ],
    },
  });
  if (
    knowledge.isError ||
    !knowledge.structuredContent.result.entries[0]?.evidence?.length ||
    knowledge.structuredContent.result.sources.length !== 2
  )
    throw new Error("Installed book knowledge or evidence is missing");
  const mastery = await client.callTool({
    name: "ludoscope_mastery_analysis",
    arguments: {
      skills: [
        {
          id: "skill.test",
          requires: [],
          introduced_at: 0,
          practice: ["Try the rule"],
          variation: ["Apply in a new layout"],
        },
      ],
    },
  });
  if (
    mastery.isError ||
    mastery.structuredContent.result.evidence_scope !==
      "structural_plan_only" ||
    !mastery.structuredContent.result.knowledge.some((e) =>
      e.source_ids.includes("source.koster_user_pdf"),
    )
  )
    throw new Error("Installed mastery source context missing");
  const request = {
    api_version: "1.0",
    request_id: "request.installed",
    project_id: "project.installed",
    task_id: "task.design",
    timestamp: new Date().toISOString(),
    status: "submitted",
    artifact_refs: [],
    evidence: [],
    context: { subject: "Planning", author_goals: ["Meaningful choices"] },
  };
  const capabilities = await client.callTool({
    name: "get_capabilities",
    arguments: { request },
  });
  const concept = await client.callTool({
    name: "analyze_concept",
    arguments: {
      request,
      concept: "Choose a route with visible consequences.",
    },
  });
  if (
    capabilities.isError ||
    capabilities.structuredContent.capabilities.length !== 16 ||
    concept.isError ||
    concept.structuredContent.project_id !== request.project_id ||
    concept.structuredContent.task_id !== request.task_id
  )
    throw new Error("Installed WORLD FORGE API failed");
  const model = JSON.parse(
    await readFile(
      path.join(installed, "examples/economic-tycoon/economy.json"),
      "utf8",
    ),
  );
  const r = await client.callTool({
    name: "ludoscope_simulate_system",
    arguments: { model },
  });
  if (r.isError || r.structuredContent.result.final.money !== 20)
    throw new Error(JSON.stringify(r));
  console.log(
    JSON.stringify({
      installed_root: installed,
      tools: tools.length,
      context: "ok",
      book_knowledge: "ok",
      koster_mastery: "ok",
      world_forge_api: "ok",
      tycoon_final_money: r.structuredContent.result.final.money,
    }),
  );
} finally {
  await client?.close();
  await rm(root, { recursive: true, force: true });
}
