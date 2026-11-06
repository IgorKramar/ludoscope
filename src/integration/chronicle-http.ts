import { createHash } from "node:crypto";
import { z } from "zod";
import { ProjectHistory, type ChroniclerAdapter } from "./chronicler.js";
import {
  GameDesignAnalysis,
  RefId,
  type DesignAnalysis,
  type DesignRequest,
} from "./contracts.js";

/** The frozen Chronicle HTTP v1 contract is distinct from Ludoscope's draft profile. */
const Id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.:@/-]+$/);
const ProjectId = RefId.refine((id) => !id.includes("/"));
const Line = z.string().min(1).max(4000);
const Link = z.object({ artifact_id: Id, record_id: Id.nullable() });
const Evidence = z.object({
  evidence_id: Id,
  project_id: ProjectId,
  kind: z.enum(["event", "record", "test_result", "commit", "uri"]),
  target_id: Id.nullable(),
  uri: z.string().max(2000).nullable(),
  provenance: z.enum(["observed", "agent_reported", "derived"]),
});
const RecordBase = z.object({
  api_version: z.literal("v1"),
  project_id: ProjectId,
  record_id: RefId,
  revision: z.number().int().positive(),
  supersedes: Id.nullable(),
  artifact_refs: z.array(Link).max(20),
  evidence: z.array(Evidence).max(30),
  provenance: z.enum(["observed", "agent_reported", "derived"]),
  status: z.string(),
});
const Decision = RecordBase.extend({
  decision_id: Id,
  // FIP permits blank pending decisions; validate projected records after revision/status selection.
  choice: z.string().max(4000),
  rationale: z.string().max(4000),
  status: z.enum(["Proposed", "Accepted", "Rejected", "Superseded"]),
}).refine(
  (d) => d.status !== "Accepted" || d.evidence.length > 0,
  "Confirmed Chronicle decision requires primary evidence",
);
const Artifact = RecordBase.extend({
  artifact_id: Id,
  title: Line,
  uri: z.string().url().max(2000),
  artifact_type: Line,
  status: z.enum(["available", "superseded", "unavailable"]),
});
const Event = RecordBase.extend({
  event_id: Id,
  event_type: z.string(),
  category: z.string(),
  summary: z.string().max(4000),
  provenance: z.enum(["observed", "agent_reported", "derived"]),
});
const ExperimentSummary = z.strictObject({
  question: Line,
  result: Line,
  data_origin: z.enum(["human_playtest", "simulation", "engineering_test"]),
});
const Envelope = z.object({
  api_version: z.literal("v1"),
  status: z.literal("ok"),
  project_id: ProjectId,
  data: z.unknown(),
});
const Page = z.object({
  items: z.array(z.unknown()).max(100),
  has_more: z.boolean(),
  next_cursor: z.string().max(16000).nullable(),
  snapshot: z.string().min(1).max(16000),
});
const Capabilities = z.object({
  api_version: z.literal("v1"),
  status: z.literal("ok"),
  service: z.literal("Chronicler"),
  contract_version: z.literal("1.0.0"),
  supported_api_versions: z.array(z.string()),
  operations: z.array(z.string()),
  max_page_size: z.number().int().positive(),
  max_response_bytes: z.number().int().positive(),
  write_requires_idempotency_key: z.literal(true),
});
const Ack = z.object({
  accepted: z.literal(true),
  record_id: RefId,
  revision: z.literal(1),
  sequence: z.number().int().positive(),
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function latest<T extends z.infer<typeof RecordBase>>(
  items: T[],
  identity: (r: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.record_id)) throw new Error("Duplicate Chronicle record");
    ids.add(item.record_id);
    const key = identity(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((chain) => {
    chain.sort((a, b) => a.revision - b.revision);
    for (let i = 0; i < chain.length; i++)
      if (
        chain[i].revision !== i + 1 ||
        chain[i].supersedes !== (i ? chain[i - 1].record_id : null)
      )
        throw new Error("Incomplete or conflicting Chronicle revision chain");
    return chain.at(-1)!;
  });
}
export interface ChronicleHttpOptions {
  endpoint: string;
  token: string;
  projectId: string;
  agentId: string;
  /** Explicit opt-in for a loopback Collector; never permits remote plain HTTP. */
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  maxPages?: number;
}

/** No database access, background retry, global project root or Notion credential. */
export class ChronicleHttpAdapter implements ChroniclerAdapter {
  private readonly endpoint: URL;
  private readonly options: ChronicleHttpOptions;
  constructor(options: ChronicleHttpOptions) {
    let u: URL;
    try {
      u = new URL(options.endpoint);
    } catch {
      throw new Error("Invalid Chronicle endpoint");
    }
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["", "/"].includes(u.pathname)
    )
      throw new Error(
        "Chronicle endpoint must be an origin without credentials, path or query",
      );
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        options.allowLoopbackHttp &&
        ["127.0.0.1", "[::1]"].includes(u.hostname)
      )
    )
      throw new Error(
        "Chronicle requires HTTPS or explicitly permitted loopback HTTP",
      );
    ProjectId.parse(options.projectId);
    RefId.parse(options.agentId);
    if (!options.token || /[\r\n]/.test(options.token))
      throw new Error("Chronicle bearer token required");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 10000)
    )
      throw new Error("Chronicle timeout must be 1..10000 ms");
    if (
      options.maxPages !== undefined &&
      (!Number.isInteger(options.maxPages) ||
        options.maxPages < 1 ||
        options.maxPages > 10)
    )
      throw new Error("Chronicle maxPages must be 1..10");
    this.endpoint = u;
    this.options = { ...options };
  }
  private bind(project: string, agent?: string) {
    if (
      project !== this.options.projectId ||
      (agent !== undefined && agent !== this.options.agentId)
    )
      throw new Error("Chronicle project or actor mismatch");
  }
  private signal(signal: AbortSignal) {
    return AbortSignal.any([
      signal,
      AbortSignal.timeout(this.options.timeoutMs ?? 10000),
    ]);
  }
  private async json(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    const payload = body === undefined ? undefined : canonical(body);
    if (payload && Buffer.byteLength(payload) > 64000)
      throw new Error("Chronicle write exceeds 64000 bytes");
    let response: Response;
    try {
      response = await fetch(new URL(path, this.endpoint), {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "FIP-Version": "v1",
          ...(payload
            ? { "Content-Type": "application/json", "Idempotency-Key": key! }
            : {}),
        },
        body: payload,
        signal,
        redirect: "error",
      });
    } catch {
      throw new Error("Chronicle transport unavailable or cancelled");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Chronicle HTTP ${response.status}`);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel();
      throw new Error("Chronicle JSON response required");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Chronicle response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 131072)
          throw new Error("Chronicle response exceeds byte budget");
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  private scoped(value: unknown): unknown {
    const envelope = Envelope.parse(value);
    this.bind(envelope.project_id);
    return envelope.data;
  }
  private async capabilities(signal: AbortSignal, operations: string[]) {
    const c = Capabilities.parse(await this.json("/v1/capabilities", signal));
    if (
      !c.supported_api_versions.includes("v1") ||
      operations.some((op) => !c.operations.includes(op)) ||
      c.max_response_bytes < 131072 ||
      c.max_page_size < 100
    )
      throw new Error("Chronicle capabilities or rights unavailable");
  }
  private async list<T extends z.infer<typeof RecordBase>>(
    suffix: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T[]> {
    let cursor: string | null = null;
    const seen = new Set<string>();
    const result: T[] = [];
    for (let n = 0; n < (this.options.maxPages ?? 10); n++) {
      const path = `/v1/memory/projects/${encodeURIComponent(this.options.projectId)}/${suffix}`;
      const u = new URL(path, this.endpoint);
      u.searchParams.set("limit", "100");
      u.searchParams.set("max_response_bytes", "131072");
      if (cursor) u.searchParams.set("cursor", cursor);
      const page = Page.parse(
        this.scoped(await this.json(u.pathname + u.search, signal)),
      );
      for (const raw of page.items) {
        const item = schema.parse(raw);
        this.bind(item.project_id);
        for (const source of item.evidence) this.bind(source.project_id);
        result.push(item);
      }
      if (!page.has_more) {
        if (page.next_cursor !== null)
          throw new Error("Inconsistent Chronicle pagination");
        return result;
      }
      if (!page.items.length || !page.next_cursor || seen.has(page.next_cursor))
        throw new Error("Incomplete Chronicle pagination");
      cursor = page.next_cursor;
      seen.add(cursor);
    }
    throw new Error(
      "Chronicle history exceeds page budget; context is partial",
    );
  }
  async getProjectContext(
    request: DesignRequest,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ProjectHistory>> {
    this.bind(request.project_id, request.agent_id);
    signal = this.signal(signal);
    await this.capabilities(signal, [
      "get_project_state",
      "get_decisions",
      "get_project_history",
      "get_artifacts",
    ]);
    const state = z
      .object({ project_id: ProjectId })
      .parse(
        this.scoped(
          await this.json(
            `/v1/memory/projects/${encodeURIComponent(this.options.projectId)}/state`,
            signal,
          ),
        ),
      );
    this.bind(state.project_id);
    const decisions = latest(
      await this.list("decisions", Decision, signal),
      (r) => r.decision_id,
    );
    const artifacts = await this.list("artifacts", Artifact, signal);
    const currentArtifacts = latest(artifacts, (r) => r.artifact_id);
    // Events are immutable. Nested KnowledgeRecord can be revised outside event history,
    // so never resurrect a stale nested result by treating it as the latest knowledge.
    const events = await this.list("history", Event, signal);
    const experiments = events
      .filter(
        (e) =>
          e.category === "experiment" &&
          e.event_type === "experiment.result" &&
          e.status === "completed",
      )
      .map((e) => {
        // Explicit producer convention, not an inference from an arbitrary event summary.
        const summary = ExperimentSummary.parse(JSON.parse(e.summary));
        return {
          id: e.record_id,
          question: summary.question,
          result: `[${summary.data_origin}; ${e.provenance}] ${summary.result}`,
        };
      });
    const resolve = (links: z.infer<typeof Link>[]) =>
      links.map((link) => {
        const a = (link.record_id ? artifacts : currentArtifacts).find(
          (a) =>
            a.artifact_id === link.artifact_id &&
            (!link.record_id || a.record_id === link.record_id),
        );
        if (!a || a.status === "unavailable")
          throw new Error("Unresolved Chronicle artifact link");
        const u = new URL(a.uri);
        if (
          u.username ||
          u.password ||
          u.search ||
          u.hash ||
          !["https:", "urn:"].includes(u.protocol)
        )
          throw new Error("Unsafe Chronicle artifact URI");
        return {
          id: a.record_id,
          project_id: a.project_id,
          kind: a.artifact_type,
          uri: a.uri,
          revision: String(a.revision),
          description: a.title,
        };
      });
    return ProjectHistory.parse({
      project_id: this.options.projectId,
      decisions: decisions
        .filter((d) => d.status === "Accepted")
        .map((d) => ({
          id: d.record_id,
          decision: d.choice,
          artifact_refs: resolve(d.artifact_refs),
        })),
      rejected_alternatives: decisions
        .filter((d) => d.status === "Rejected")
        .map((d) => ({
          id: d.record_id,
          title: d.choice,
          reason: d.rationale,
        })),
      experiments,
    });
  }
  async publishAnalysis(
    input: DesignAnalysis,
    signal: AbortSignal,
  ): Promise<{ receipt_id: string }> {
    const a = GameDesignAnalysis.parse(input);
    this.bind(a.project_id, a.agent_id);
    signal = this.signal(signal);
    await this.capabilities(signal, ["append_event"]);
    const id = `ludoscope:${hash(`${a.project_id}\n${a.analysis_id}`)}`;
    const digest = hash(canonical(a));
    const base = {
      api_version: "v1",
      request_id: id,
      project_id: a.project_id,
      session_id: a.session_id ?? null,
      agent_id: this.options.agentId,
      timestamp: a.timestamp,
      status: "recorded",
      artifact_refs: [],
      evidence: [],
      record_id: id,
      revision: 1,
      supersedes: null,
      provenance: "agent_reported",
    };
    // Bounded explicit projection; full JSON/Markdown remains in the caller's project.
    const projection = {
      analysis_id: a.analysis_id,
      sha256: digest,
      subject: a.context.subject.slice(0, 1000),
      history_available: a.history.available,
      counts: {
        findings: a.findings.length,
        hypotheses: a.hypotheses.length,
        recommendations: a.recommendations.length,
      },
      findings: a.findings.slice(0, 3).map((f) => ({
        claim: f.claim.slice(0, 600),
        claim_type: f.claim_type,
        validation_method: f.validation_method.slice(0, 300),
      })),
      hypotheses: a.hypotheses.slice(0, 3).map((h) => ({
        statement: h.statement.slice(0, 600),
        claim_type: h.claim_type,
      })),
      recommendations: a.recommendations
        .slice(0, 3)
        .map((r) => ({ action: r.action.slice(0, 600), status: r.status })),
      projection_limits:
        "First 3 items per kind; text bounded; full analysis retained by caller. No independent observation or test execution is asserted.",
    };
    const event = {
      ...base,
      event_id: id,
      event_type: "ludoscope.analysis",
      category: "game_design",
      summary: `Ludoscope analysis ${a.analysis_id}; SHA-256 ${digest}; findings ${a.findings.length}, hypotheses ${a.hypotheses.length}, recommendations ${a.recommendations.length}. Bounded agent-reported projection; full artifact remains in the project.`,
      knowledge: [
        {
          ...base,
          record_id: `${id}:summary`,
          knowledge_id: `${id}:summary`,
          status: "proposed",
          category: "game_design",
          title: "Ludoscope analysis projection",
          text: canonical(projection),
          source_event_ids: [id],
        },
      ],
      test_results: [],
    };
    const ack = Ack.parse(
      this.scoped(await this.json("/v1/memory/events", signal, event, id)),
    );
    if (ack.record_id !== id)
      throw new Error("Chronicle acknowledgement record mismatch");
    return { receipt_id: ack.record_id };
  }
}
