import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const client = new Client({ name: "world-forge-example", version: "1.0" });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../../dist/mcp/index.js", import.meta.url)),
      ],
      stderr: "pipe",
    }),
  );
  const request = {
    api_version: "1.0",
    request_id: "request.mcp.1",
    project_id: "demo.forge",
    task_id: "task.hunger",
    timestamp: new Date().toISOString(),
    status: "submitted",
    artifact_refs: [],
    evidence: [],
    context: {
      subject: "Hunger planning",
      author_goals: ["Meaningful planning"],
      creative_principles: ["Preserve quiet rituals"],
      tags: ["choice"],
      system_types: ["mechanic"],
    },
  };
  const discovery = await client.callTool({
    name: "get_capabilities",
    arguments: { request },
  });
  const mechanic = JSON.parse(
    await readFile(
      new URL("../survival/mechanic.json", import.meta.url),
      "utf8",
    ),
  );
  const response = await client.callTool({
    name: "analyze_mechanic",
    arguments: {
      request: { ...request, request_id: "request.mcp.2" },
      mechanic,
    },
  });
  if (discovery.isError || response.isError)
    throw new Error(JSON.stringify(response));
  const analysis = response.structuredContent;
  console.log(
    JSON.stringify({
      capabilities: discovery.structuredContent.capabilities.length,
      project_id: analysis.project_id,
      task_id: analysis.task_id,
      status: analysis.status,
      alternatives: analysis.alternatives.length,
      evidence: analysis.evidence.length,
      history_available: analysis.history.available,
    }),
  );
} finally {
  await client.close();
}
