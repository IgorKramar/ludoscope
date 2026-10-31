import { z } from "zod";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Id } from "../core/schemas.js";
import { contained, readBufferBounded, MAX_FILE } from "../core/files.js";
import { ensure } from "../core/errors.js";

const stages = [
  "requirement",
  "mechanic",
  "implementation",
  "automated_test",
  "playtest",
] as const;
const Stage = z.enum(stages);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const MAX_BYTES = 20 * 1024 * 1024;
const LineRange = z.strictObject({
  start: z.number().int().min(1).max(1_000_000),
  end: z.number().int().min(1).max(1_000_000),
});
export const TraceabilityManifest = z.strictObject({
  schema_version: z.literal("1.0"),
  id: Id,
  revision: Revision.optional(),
  artifacts: z
    .array(
      z.strictObject({
        id: Id,
        kind: Stage,
        path: z.string().min(1).max(1024),
        sha256: Sha256,
        lines: LineRange.optional(),
      }),
    )
    .min(1)
    .max(100),
  links: z.array(z.strictObject({ from: Id, to: Id })).max(500),
});
const BindingStatus = z.enum([
  "current",
  "stale",
  "missing",
  "blocked",
  "unreadable",
  "invalid_range",
  "budget_exceeded",
]);
export const TraceabilityReport = z.strictObject({
  schema_version: z.literal("1.0"),
  id: Id,
  claim_type: z.literal("PROJECT_FACT"),
  status: z.enum(["complete", "partial"]),
  bindings: z
    .array(
      z.strictObject({
        id: Id,
        kind: Stage,
        path: z.string().min(1).max(1024),
        status: BindingStatus,
        expected_sha256: Sha256,
        actual_sha256: Sha256.nullable(),
        bytes: z.number().int().nonnegative().nullable(),
        line_count: z.number().int().nonnegative().nullable(),
        diagnostics: z.array(z.string().min(1).max(1000)).max(10),
      }),
    )
    .max(100),
  coverage: z
    .array(
      z.strictObject({
        requirement_id: Id,
        declared_chain: z.boolean(),
        current_chain: z.boolean(),
        missing_stages: z.array(Stage).max(5),
        chain_artifact_ids: z.array(Id).max(5),
      }),
    )
    .max(100),
  unlinked_artifact_ids: z.array(Id).max(100),
  revision: z.strictObject({
    expected: Revision.nullable(),
    actual: Revision.nullable(),
    status: z.enum(["unpinned", "match", "mismatch", "unavailable"]),
    dirty: z.boolean().nullable(),
  }),
  bytes_read: z.number().int().nonnegative().max(MAX_BYTES),
  limitations: z.array(z.string().min(1).max(1000)).max(20),
});
export type TraceabilityManifestType = z.infer<typeof TraceabilityManifest>;
export type TraceabilityReportType = z.infer<typeof TraceabilityReport>;

/** Pure structural validation. A declared link is not a claim of semantic conformance. */
export function validateTraceability(input: unknown): TraceabilityManifestType {
  const manifest = TraceabilityManifest.parse(input);
  const artifacts = new Map(
    manifest.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  ensure(
    artifacts.size === manifest.artifacts.length,
    "DUPLICATE",
    "Duplicate traceability artifact ID",
  );
  const links = new Set<string>();
  for (const artifact of manifest.artifacts)
    ensure(
      !artifact.lines || artifact.lines.start <= artifact.lines.end,
      "RANGE",
      "Line range start must not exceed end",
    );
  for (const link of manifest.links) {
    const from = artifacts.get(link.from),
      to = artifacts.get(link.to);
    ensure(
      from && to,
      "REFERENCE",
      "Traceability link references an unknown artifact",
    );
    ensure(
      stages.indexOf(to.kind) === stages.indexOf(from.kind) + 1,
      "REFERENCE",
      "Traceability links must join adjacent requirement-to-playtest stages",
    );
    const key = JSON.stringify([link.from, link.to]);
    ensure(!links.has(key), "DUPLICATE", "Duplicate traceability link");
    links.add(key);
  }
  return manifest;
}

type FileSnapshot = {
  status: z.infer<typeof BindingStatus>;
  actual_sha256: string | null;
  bytes: number | null;
  line_count: number | null;
  diagnostics: string[];
};
const runGit = promisify(execFile);
async function checkoutRevision(
  root: string,
  expected: string | undefined,
  signal?: AbortSignal,
) {
  const revision: TraceabilityReportType["revision"] = {
    expected: expected ?? null,
    actual: null,
    status: expected ? "unavailable" : "unpinned",
    dirty: null,
  };
  if (!expected) return revision;
  // Fixed read-only commands only; repository/configured fsmonitor commands are disabled.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  const args = [
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-C",
    root,
  ];
  try {
    const result = await runGit(
      "git",
      [...args, "rev-parse", "--verify", "HEAD"],
      { timeout: 2000, maxBuffer: 65536, signal, env },
    );
    const actual = result.stdout.trim();
    ensure(
      Revision.safeParse(actual).success,
      "REVISION",
      "Git returned an invalid revision",
    );
    revision.actual = actual;
    revision.status = actual === expected ? "match" : "mismatch";
  } catch {
    signal?.throwIfAborted();
    return revision;
  }
  try {
    const result = await runGit(
      "git",
      [
        ...args,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--ignore-submodules=all",
      ],
      { timeout: 2000, maxBuffer: 65536, signal, env },
    );
    revision.dirty = result.stdout.trim().length > 0;
  } catch {
    signal?.throwIfAborted();
  }
  return revision;
}

/** Read-only fingerprint/locator audit. Never executes manifests, game code or tests. */
export async function auditTraceability(
  root: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<TraceabilityReportType> {
  const manifest = validateTraceability(input);
  signal?.throwIfAborted();
  const base = await realpath(root);
  const snapshots = new Map<string, FileSnapshot>();
  let bytesRead = 0;
  const bindings: TraceabilityReportType["bindings"] = [];
  for (const artifact of manifest.artifacts) {
    signal?.throwIfAborted();
    const relative = artifact.path.replaceAll("\\", "/");
    let snapshot = snapshots.get(relative);
    if (!snapshot) {
      snapshot = {
        status: "unreadable",
        actual_sha256: null,
        bytes: null,
        line_count: null,
        diagnostics: [],
      };
      try {
        ensure(
          !path.posix.isAbsolute(artifact.path) &&
            !path.win32.isAbsolute(artifact.path) &&
            !artifact.path.includes("\0"),
          "PATH",
          "Portable relative path required",
        );
        const resolved = await contained(base, relative);
        const stat = await lstat(resolved);
        ensure(
          stat.isFile() && stat.size <= MAX_FILE,
          "SIZE",
          "Regular file of at most 2 MiB required",
        );
        if (bytesRead + MAX_FILE > MAX_BYTES) {
          snapshot.status = "budget_exceeded";
          snapshot.diagnostics.push(
            "Remaining 20 MiB read budget cannot reserve a bounded file snapshot; split the manifest.",
          );
        } else {
          const buffer = await readBufferBounded(base, relative);
          ensure(
            bytesRead + buffer.length <= MAX_BYTES,
            "LIMIT",
            "Total read budget exceeded",
          );
          bytesRead += buffer.length;
          snapshot.status = "current";
          snapshot.actual_sha256 = createHash("sha256")
            .update(buffer)
            .digest("hex");
          snapshot.bytes = buffer.length;
          // Ranges are UTF-8 text locators; the fingerprint always covers exact full-file bytes.
          if (isUtf8(buffer)) {
            const text = buffer.toString("utf8");
            snapshot.line_count =
              text.length === 0
                ? 0
                : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
          }
        }
      } catch (error) {
        signal?.throwIfAborted();
        const code = (error as NodeJS.ErrnoException).code;
        snapshot.status =
          code === "ENOENT"
            ? "missing"
            : ["PATH", "SYMLINK", "ELOOP"].includes(code ?? "")
              ? "blocked"
              : code === "LIMIT"
                ? "budget_exceeded"
                : "unreadable";
        snapshot.diagnostics.push(
          snapshot.status === "missing"
            ? "Declared file is missing."
            : snapshot.status === "blocked"
              ? "Path is outside the allowed relative namespace or traverses a symbolic link."
              : snapshot.status === "budget_exceeded"
                ? "Total read budget of 20 MiB exceeded."
                : "File is not readable as a stable regular file of at most 2 MiB.",
        );
      }
      snapshots.set(relative, snapshot);
    }
    const binding: TraceabilityReportType["bindings"][number] = {
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      expected_sha256: artifact.sha256,
      ...snapshot,
      diagnostics: [...snapshot.diagnostics],
    };
    if (snapshot.status === "current") {
      if (snapshot.actual_sha256 !== artifact.sha256) {
        binding.status = "stale";
        binding.diagnostics.push(
          "Full-file fingerprint differs from the declared SHA-256.",
        );
      }
      if (
        artifact.lines &&
        (snapshot.line_count === null ||
          artifact.lines.end > snapshot.line_count)
      ) {
        if (binding.status === "current") binding.status = "invalid_range";
        binding.diagnostics.push(
          snapshot.line_count === null
            ? "Line ranges require a valid UTF-8 text file."
            : "Declared line range extends beyond the current file.",
        );
      }
    }
    bindings.push(binding);
  }
  const artifacts = new Map(
    manifest.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const current = new Set(
    bindings
      .filter((binding) => binding.status === "current")
      .map((binding) => binding.id),
  );
  const next = new Map<string, string[]>();
  for (const link of manifest.links)
    next.set(link.from, [...(next.get(link.from) ?? []), link.to]);
  function reachable(start: string, eligible?: Set<string>) {
    const paths = new Map<string, string[]>();
    if (eligible && !eligible.has(start)) return paths;
    const queue = [start];
    paths.set(start, [start]);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      for (const target of next.get(id) ?? []) {
        if (paths.has(target) || (eligible && !eligible.has(target))) continue;
        paths.set(target, [...paths.get(id)!, target]);
        queue.push(target);
      }
    }
    return paths;
  }
  const allReachable = new Set<string>();
  const coverage = manifest.artifacts
    .filter((artifact) => artifact.kind === "requirement")
    .map((requirement) => {
      const declared = reachable(requirement.id),
        verified = reachable(requirement.id, current);
      for (const id of declared.keys()) allReachable.add(id);
      const terminal = [...declared.keys()].find(
        (id) => artifacts.get(id)!.kind === "playtest",
      );
      const present = new Set(
        [...declared.keys()].map((id) => artifacts.get(id)!.kind),
      );
      return {
        requirement_id: requirement.id,
        declared_chain: terminal !== undefined,
        current_chain: [...verified.keys()].some(
          (id) => artifacts.get(id)!.kind === "playtest",
        ),
        missing_stages: stages.filter((stage) => !present.has(stage)),
        chain_artifact_ids: terminal ? declared.get(terminal)! : [],
      };
    });
  signal?.throwIfAborted();
  const revision = await checkoutRevision(base, manifest.revision, signal);
  const unlinked = manifest.artifacts
    .filter((artifact) => !allReachable.has(artifact.id))
    .map((artifact) => artifact.id);
  const revisionCurrent =
    revision.status === "unpinned" ||
    (revision.status === "match" && revision.dirty === false);
  return TraceabilityReport.parse({
    schema_version: "1.0",
    id: manifest.id,
    claim_type: "PROJECT_FACT",
    status:
      coverage.length > 0 &&
      bindings.every((binding) => binding.status === "current") &&
      coverage.every((row) => row.current_chain) &&
      unlinked.length === 0 &&
      revisionCurrent
        ? "complete"
        : "partial",
    bindings,
    coverage,
    unlinked_artifact_ids: unlinked,
    revision,
    bytes_read: bytesRead,
    limitations: [
      "Links are caller-declared. Matching fingerprints and complete chains do not establish semantic conformance.",
      "Automated-test and playtest artifacts are located and fingerprinted only. Their contents, execution, participants and outcomes are not authenticated.",
      "SHA-256 covers the full raw file; optional line ranges are UTF-8 text locators, not independent hashes.",
      "Files are read sequentially, not as an atomic snapshot. Re-run after concurrent edits; matching HEAD alone does not establish unchanged working files.",
      "At most 100 artifacts, 500 links, 2 MiB per file and 20 MiB of distinct-file reads. Repeated paths reuse a bounded snapshot.",
      revision.status === "unpinned"
        ? "Git revision is not pinned; checkout revision and dirty state were not inspected."
        : "Pinned revision compares Git HEAD only. Dirty state excludes ignored files and submodule internals; exact artifact fingerprints remain authoritative.",
      "No game code, manifest commands or test programs are executed, and no network request is made.",
    ],
  });
}
