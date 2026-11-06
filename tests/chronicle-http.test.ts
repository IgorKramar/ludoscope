import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { ChronicleHttpAdapter } from "../src/integration/chronicle-http.js";
import { chronicleHostOptions } from "../src/integration/chronicle-host.js";
import { LudoscopeAgentApi } from "../src/integration/api.js";
import { GameDesignRequest } from "../src/integration/contracts.js";

const request = GameDesignRequest.parse({
  api_version: "1.0",
  request_id: "request.test",
  project_id: "game-one",
  agent_id: "ludoscope",
  timestamp: "2026-11-01T00:00:00Z",
  status: "submitted",
  context: { subject: "Factory recovery" },
});
const mechanic = JSON.parse(
  await readFile(
    new URL("../examples/survival/mechanic.json", import.meta.url),
    "utf8",
  ),
);
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
const capabilities = {
  api_version: "v1",
  status: "ok",
  service: "Chronicler",
  contract_version: "1.0.0",
  supported_api_versions: ["v1"],
  operations: [
    "get_project_state",
    "get_decisions",
    "get_project_history",
    "get_artifacts",
    "append_event",
  ],
  max_page_size: 100,
  max_response_bytes: 131072,
  write_requires_idempotency_key: true,
};
function record(id: string, extra: Record<string, unknown> = {}) {
  return {
    api_version: "v1",
    project_id: "game-one",
    record_id: id,
    revision: 1,
    supersedes: null,
    artifact_refs: [],
    evidence: [
      {
        evidence_id: "ref.seed",
        project_id: "game-one",
        kind: "event",
        target_id: "seed",
        uri: null,
        provenance: "agent_reported",
      },
    ],
    provenance: "agent_reported",
    status: "Accepted",
    ...extra,
  };
}
async function fixture(overrides: Record<string, unknown> = {}) {
  const posts: { body: any; key: string }[] = [];
  const s = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let value: any;
    if (url.pathname === "/v1/capabilities") value = capabilities;
    else if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const parsed = JSON.parse(body);
      posts.push({ body: parsed, key: String(req.headers["idempotency-key"]) });
      value = {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          accepted: true,
          record_id: parsed.record_id,
          revision: 1,
          sequence: 1,
        },
      };
    } else if (url.pathname.endsWith("/state"))
      value = {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: { project_id: "game-one" },
      };
    else
      value = {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          items: [],
          has_more: false,
          next_cursor: null,
          snapshot: "fixture",
        },
      };
    value = overrides[url.pathname] ?? value;
    if (typeof value === "function") value = value(url);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(value));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servers.push(s);
  const endpoint = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const adapter = new ChronicleHttpAdapter({
    endpoint,
    token: "fixture-token",
    projectId: "game-one",
    agentId: "ludoscope",
    allowLoopbackHttp: true,
  });
  return { adapter, endpoint, posts };
}
describe("Chronicle HTTP contract", () => {
  it("follows pagination and resolves an explicit immutable artifact revision", async () => {
    const page = (items: unknown[], next: string | null = null) => ({
      api_version: "v1",
      status: "ok",
      project_id: "game-one",
      data: {
        items,
        has_more: next !== null,
        next_cursor: next,
        snapshot: "s",
      },
    });
    const old = record("decision-old", {
      decision_id: "choice",
      choice: "Old choice",
      rationale: "Before",
    });
    const current = record("decision-new", {
      decision_id: "choice",
      choice: "New choice",
      rationale: "After",
      revision: 2,
      supersedes: "decision-old",
      artifact_refs: [{ artifact_id: "document", record_id: "document-first" }],
    });
    const first = record("document-first", {
      artifact_id: "document",
      title: "Original SPEC",
      uri: "urn:example:spec:1",
      artifact_type: "document",
      status: "available",
    });
    const second = {
      ...first,
      record_id: "document-second",
      revision: 2,
      supersedes: "document-first",
      uri: "urn:example:spec:2",
    };
    const { adapter } = await fixture({
      "/v1/memory/projects/game-one/decisions": (url: URL) =>
        url.searchParams.get("cursor") ? page([current]) : page([old], "next"),
      "/v1/memory/projects/game-one/artifacts": page([first, second]),
    });
    const history = await adapter.getProjectContext(
      request,
      new AbortController().signal,
    );
    expect(history.decisions[0].decision).toBe("New choice");
    expect(history.decisions[0].artifact_refs[0]).toMatchObject({
      id: "document-first",
      uri: "urn:example:spec:1",
      revision: "1",
    });
  });
  it("does not accept a confirmed decision without primary evidence", async () => {
    const { adapter } = await fixture({
      "/v1/memory/projects/game-one/decisions": {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          items: [
            record("unfounded", {
              decision_id: "unfounded",
              choice: "Repair",
              rationale: "Claimed",
              evidence: [],
            }),
          ],
          has_more: false,
          next_cursor: null,
          snapshot: "s",
        },
      },
    });
    await expect(
      adapter.getProjectContext(request, new AbortController().signal),
    ).rejects.toThrow();
  });
  it("projects latest decisions without promoting proposals or every considered alternative", async () => {
    const old = record("old", {
      decision_id: "decision-one",
      choice: "Repair",
      rationale: "Earlier",
      status: "Accepted",
    });
    const latest = record("latest", {
      decision_id: "decision-one",
      choice: "Repair",
      rationale: "Too costly",
      status: "Rejected",
      revision: 2,
      supersedes: "old",
      alternatives: ["Repair", "Scrap"],
    });
    const accepted = record("accepted", {
      decision_id: "decision-two",
      choice: "Keep ownership",
      rationale: "",
    });
    const proposed = record("proposed", {
      decision_id: "decision-three",
      choice: "",
      rationale: "",
      status: "Proposed",
    });
    const superseded = record("previous-accepted", {
      decision_id: "decision-four",
      choice: "Old boundary",
      rationale: "Earlier",
    });
    const pendingRevision = record("pending-revision", {
      decision_id: "decision-four",
      choice: "",
      rationale: "",
      status: "Proposed",
      revision: 2,
      supersedes: "previous-accepted",
    });
    const { adapter } = await fixture({
      "/v1/memory/projects/game-one/decisions": {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          items: [old, latest, accepted, proposed, superseded, pendingRevision],
          has_more: false,
          next_cursor: null,
          snapshot: "s",
        },
      },
    });
    const history = await adapter.getProjectContext(
      request,
      new AbortController().signal,
    );
    expect(history.decisions.map((x) => x.id)).toEqual(["accepted"]);
    expect(history.rejected_alternatives).toEqual([
      { id: "latest", title: "Repair", reason: "Too costly" },
    ]);
  });
  it("returns partial local analysis for wrong-project history", async () => {
    const { adapter } = await fixture({
      "/v1/memory/projects/game-one/state": {
        api_version: "v1",
        status: "ok",
        project_id: "other",
        data: { project_id: "other" },
      },
    });
    const api = await LudoscopeAgentApi.create({ chronicler: adapter });
    const result = await api.call("analyze_mechanic", { request, mechanic });
    expect(result.history.available).toBe(false);
    expect(result.status).toBe("partial");
  });
  it("requires host authorization and sends stable immutable projection without invented Passed results", async () => {
    const { adapter, posts } = await fixture();
    const local = await LudoscopeAgentApi.create({ chronicler: adapter });
    const analysis = await local.call("analyze_mechanic", {
      request,
      mechanic,
    });
    await local.call("publish_analysis", { request, analysis, commit: true });
    expect(posts).toHaveLength(0);
    const api = await LudoscopeAgentApi.create({
      chronicler: adapter,
      authorizePublish: () => true,
    });
    await api.call("publish_analysis", { request, analysis, commit: false });
    expect(posts).toHaveLength(0);
    const first = await api.call("publish_analysis", {
      request,
      analysis,
      commit: true,
    });
    await api.call("publish_analysis", { request, analysis, commit: true });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0].body.test_results).toEqual([]);
    expect(posts[0].body.provenance).toBe("agent_reported");
    expect(posts[0].body.status).toBe("recorded");
    expect(first).toBeDefined();
    expect(JSON.stringify(posts[0].body)).not.toContain(analysis.markdown);
  });
  it("rejects insecure endpoints, credentials in URLs, and cross-project callers", async () => {
    for (const endpoint of [
      "http://example.org",
      "https://user:pass@example.org",
      "https://example.org?token=x",
    ])
      expect(
        () =>
          new ChronicleHttpAdapter({
            endpoint,
            token: "fixture",
            projectId: "game-one",
            agentId: "ludoscope",
          }),
      ).toThrow();
    const { adapter } = await fixture();
    await expect(
      adapter.getProjectContext(
        { ...request, project_id: "other" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("leaves standalone unconfigured and denies writes unless explicitly enabled", async () => {
    expect(chronicleHostOptions({})).toEqual({});
    expect(() =>
      chronicleHostOptions({ LUDOSCOPE_CHRONICLE_URL: "https://example.org" }),
    ).toThrow();
    const { endpoint, posts } = await fixture();
    const env = {
      LUDOSCOPE_CHRONICLE_URL: endpoint,
      LUDOSCOPE_CHRONICLE_TOKEN: "fixture-token",
      LUDOSCOPE_CHRONICLE_PROJECT_ID: "game-one",
      LUDOSCOPE_CHRONICLE_AGENT_ID: "ludoscope",
      LUDOSCOPE_CHRONICLE_ALLOW_LOOPBACK_HTTP: "true",
    };
    for (const publish of [undefined, "false"]) {
      const api = await LudoscopeAgentApi.create(
        chronicleHostOptions({
          ...env,
          LUDOSCOPE_CHRONICLE_PUBLISH: publish,
        }),
      );
      const analysis = await api.call("analyze_mechanic", {
        request,
        mechanic,
      });
      const result = await api.call("publish_analysis", {
        request,
        analysis,
        commit: true,
      });
      expect(result.publication.state).toBe("denied");
      expect(posts).toHaveLength(0);
    }
    const options = chronicleHostOptions({
      ...env,
      LUDOSCOPE_CHRONICLE_PUBLISH: "true",
    });
    const api = await LudoscopeAgentApi.create(options);
    const analysis = await api.call("analyze_mechanic", { request, mechanic });
    for (const field of ["project_id", "agent_id"] as const) {
      expect(
        await options.authorizePublish!(
          { ...request, [field]: "other" },
          analysis,
        ),
      ).toBe(false);
      expect(
        await options.authorizePublish!(request, {
          ...analysis,
          [field]: "other",
        }),
      ).toBe(false);
      // A consistently foreign caller passes API identity checks but must fail host binding.
      const denied = await api.call("publish_analysis", {
        request: { ...request, [field]: "other" },
        analysis: { ...analysis, [field]: "other" },
        commit: true,
      });
      expect(denied.publication.state).toBe("denied");
      expect(posts).toHaveLength(0);
    }
    const preview = await api.call("publish_analysis", {
      request,
      analysis,
      commit: false,
    });
    expect(preview.publication.state).toBe("preview");
    expect(posts).toHaveLength(0);
    const published = await api.call("publish_analysis", {
      request,
      analysis,
      commit: true,
    });
    expect(published.publication.state).toBe("published");
    expect(posts).toHaveLength(1);
  });
  it("rejects unsupported capabilities, repeated cursors and incomplete revision chains", async () => {
    const malformed = [
      { "/v1/capabilities": { ...capabilities, contract_version: "2.0.0" } },
      { "/v1/capabilities": { ...capabilities, operations: ["append_event"] } },
      {
        "/v1/memory/projects/game-one/decisions": {
          api_version: "v1",
          status: "ok",
          project_id: "game-one",
          data: {
            items: [
              record("d", { decision_id: "d", choice: "A", rationale: "B" }),
            ],
            has_more: true,
            next_cursor: "same",
            snapshot: "s",
          },
        },
      },
      {
        "/v1/memory/projects/game-one/decisions": {
          api_version: "v1",
          status: "ok",
          project_id: "game-one",
          data: {
            items: [
              record("d2", {
                decision_id: "d",
                choice: "A",
                rationale: "B",
                revision: 2,
                supersedes: "missing",
              }),
            ],
            has_more: false,
            next_cursor: null,
            snapshot: "s",
          },
        },
      },
    ];
    for (const override of malformed) {
      const { adapter } = await fixture(override);
      await expect(
        adapter.getProjectContext(request, new AbortController().signal),
      ).rejects.toThrow();
    }
  });
  it("keeps experiment origin and provenance and ignores proposed plans", async () => {
    const result = record("experiment", {
      status: "completed",
      event_id: "experiment",
      event_type: "experiment.result",
      category: "experiment",
      provenance: "agent_reported",
      summary: JSON.stringify({
        question: "Is repair worthwhile?",
        result: "Three simulated runs favoured repair",
        data_origin: "simulation",
      }),
    });
    const proposal = {
      ...result,
      record_id: "proposal",
      event_id: "proposal",
      status: "recorded",
      summary: "A future playtest",
    };
    const { adapter } = await fixture({
      "/v1/memory/projects/game-one/history": {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          items: [result, proposal],
          has_more: false,
          next_cursor: null,
          snapshot: "s",
        },
      },
    });
    const history = await adapter.getProjectContext(
      request,
      new AbortController().signal,
    );
    expect(history.experiments).toEqual([
      {
        id: "experiment",
        question: "Is repair worthwhile?",
        result:
          "[simulation; agent_reported] Three simulated runs favoured repair",
      },
    ]);
  });
  it("rejects mismatched acknowledgement and actor before reporting a receipt", async () => {
    const { adapter } = await fixture({
      "/v1/memory/events": {
        api_version: "v1",
        status: "ok",
        project_id: "game-one",
        data: {
          accepted: true,
          record_id: "not-the-written-record",
          revision: 1,
          sequence: 1,
        },
      },
    });
    const api = await LudoscopeAgentApi.create();
    const a = await api.call("analyze_mechanic", { request, mechanic });
    await expect(
      adapter.publishAnalysis(a, new AbortController().signal),
    ).rejects.toThrow("acknowledgement");
    await expect(
      adapter.publishAnalysis(
        { ...a, agent_id: "impersonator" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("actor");
  });
  it("obeys cancellation and refuses redirects without forwarding bearer credentials", async () => {
    let forwarded = 0;
    const target = createServer((_q, r) => {
      forwarded++;
      r.end("{}");
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    servers.push(target);
    const s = createServer((_q, r) => {
      r.writeHead(302, {
        location: `http://127.0.0.1:${(target.address() as { port: number }).port}`,
      });
      r.end();
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s);
    const adapter = new ChronicleHttpAdapter({
      endpoint: `http://127.0.0.1:${(s.address() as { port: number }).port}`,
      token: "fixture-secret-not-in-errors",
      projectId: "game-one",
      agentId: "ludoscope",
      allowLoopbackHttp: true,
    });
    await expect(
      adapter.getProjectContext(request, new AbortController().signal),
    ).rejects.toThrow("transport unavailable");
    expect(forwarded).toBe(0);
    const c = new AbortController();
    c.abort();
    await expect(
      adapter.getProjectContext(request, c.signal),
    ).rejects.toThrow();
  });
  it("bounds the actual streamed response even without Content-Length", async () => {
    const s = createServer((_q, r) => {
      r.setHeader("content-type", "application/json");
      r.write('{"padding":"');
      r.end("x".repeat(140000) + '"}');
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s);
    const adapter = new ChronicleHttpAdapter({
      endpoint: `http://127.0.0.1:${(s.address() as { port: number }).port}`,
      token: "fixture",
      projectId: "game-one",
      agentId: "ludoscope",
      allowLoopbackHttp: true,
    });
    await expect(
      adapter.getProjectContext(request, new AbortController().signal),
    ).rejects.toThrow("byte budget");
  });
  it("times out a stalled HTTP body rather than leaving an unbounded request", async () => {
    const s = createServer((_q, r) => {
      r.writeHead(200, { "content-type": "application/json" });
      r.write('{"unfinished":');
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s);
    const adapter = new ChronicleHttpAdapter({
      endpoint: `http://127.0.0.1:${(s.address() as { port: number }).port}`,
      token: "fixture",
      projectId: "game-one",
      agentId: "ludoscope",
      allowLoopbackHttp: true,
      timeoutMs: 30,
    });
    await expect(
      adapter.getProjectContext(request, new AbortController().signal),
    ).rejects.toThrow();
  });
});
