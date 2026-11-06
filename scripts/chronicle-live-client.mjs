import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChronicleHttpAdapter } from "../dist/integration/chronicle-http.js";
import { LudoscopeAgentApi } from "../dist/integration/api.js";
import { GameDesignRequest } from "../dist/integration/contracts.js";
const endpoint = process.env.CHRONICLE_FIXTURE_URL;
if (!endpoint || !endpoint.startsWith("http://127.0.0.1:"))
  throw new Error("An isolated loopback fixture URL is required");
const options = {
  endpoint,
  token: "fixture-agent",
  projectId: "game-one",
  agentId: "ludoscope",
  allowLoopbackHttp: true,
};
const adapter = new ChronicleHttpAdapter(options);
const request = GameDesignRequest.parse({
  api_version: "1.0",
  request_id: "request.live",
  project_id: "game-one",
  agent_id: "ludoscope",
  timestamp: "2026-11-01T00:00:00Z",
  status: "submitted",
  context: { subject: "Synthetic factory recovery" },
});
const history = await adapter.getProjectContext(
  request,
  new AbortController().signal,
);
assert.deepEqual(
  history.decisions.map((x) => x.id),
  ["accepted-decision"],
);
assert.equal(history.rejected_alternatives[0].id, "rejected-revision");
assert.equal(history.experiments[0].question, "Is repair worthwhile?");
const mechanic = JSON.parse(
  await readFile(
    new URL("../examples/survival/mechanic.json", import.meta.url),
    "utf8",
  ),
);
const api = await LudoscopeAgentApi.create({
  chronicler: adapter,
  authorizePublish: () => true,
  chroniclerTimeoutMs: 10000,
});
const analysis = await api.call("analyze_mechanic", { request, mechanic });
assert.equal(analysis.history.available, true);
// This fixture proxy loses exactly the first POST acknowledgement AFTER real acceptance.
await assert.rejects(
  adapter.publishAnalysis(analysis, new AbortController().signal),
);
const restarted = new ChronicleHttpAdapter(options);
const receipt = await restarted.publishAnalysis(
  analysis,
  new AbortController().signal,
);
const repeated = await Promise.all([
  restarted.publishAnalysis(analysis, new AbortController().signal),
  restarted.publishAnalysis(analysis, new AbortController().signal),
]);
assert.deepEqual(repeated, [receipt, receipt]);
await assert.rejects(
  restarted.publishAnalysis(
    { ...analysis, markdown: analysis.markdown + "\nChanged content" },
    new AbortController().signal,
  ),
  /409/,
);
const get = async (path, token = "fixture-reader") => {
  const r = await fetch(endpoint + path, {
    headers: { Authorization: `Bearer ${token}`, "FIP-Version": "v1" },
  });
  assert.equal(r.status, 200);
  return r.json();
};
const lookup = await get(
  `/v1/memory/projects/game-one/records/${encodeURIComponent(receipt.receipt_id)}`,
);
assert.equal(lookup.data.record.record_id, receipt.receipt_id);
assert.equal(lookup.data.record.status, "recorded");
assert.deepEqual(lookup.data.record.test_results, []);
assert.equal(lookup.data.record.knowledge[0].status, "proposed");
const page = await get("/v1/memory/projects/game-one/history?limit=100");
assert.equal(
  page.data.items.filter((x) => x.event_type === "ludoscope.analysis").length,
  1,
);
const denied = new ChronicleHttpAdapter({
  ...options,
  projectId: "other-project",
});
await assert.rejects(
  denied.getProjectContext(
    { ...request, project_id: "other-project" },
    new AbortController().signal,
  ),
  /404/,
);
const readOnly = new ChronicleHttpAdapter({
  ...options,
  token: "fixture-reader",
});
await assert.rejects(
  readOnly.publishAnalysis(analysis, new AbortController().signal),
  /rights/,
);
const writeOnly = new ChronicleHttpAdapter({
  ...options,
  token: "fixture-writer",
});
await assert.rejects(
  writeOnly.getProjectContext(request, new AbortController().signal),
  /rights/,
);
console.log(
  JSON.stringify({
    result: "passed",
    history: {
      decisions: history.decisions.length,
      rejected: history.rejected_alternatives.length,
      experiments: history.experiments.length,
    },
    receipt_id: receipt.receipt_id,
    lost_ack_retry: "deduplicated",
    concurrent_retry: "deduplicated",
    changed_body: "409",
    cross_project: "404",
    independent_record_read: true,
    notion: "not configured",
  }),
);
