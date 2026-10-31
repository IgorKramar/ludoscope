import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  TraceabilityManifest,
  TraceabilityReport,
  auditTraceability,
  validateTraceability,
  type TraceabilityManifestType,
} from "../src/analysis/traceability.js";
import { MAX_FILE } from "../src/core/files.js";

const exec = promisify(execFile);
const roots: string[] = [];
const stages = [
  "requirement",
  "mechanic",
  "implementation",
  "automated_test",
  "playtest",
] as const;
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const sandbox = await mkdtemp(path.join(tmpdir(), "ludoscope-traceability-"));
  roots.push(sandbox);
  const root = path.join(sandbox, "project");
  await mkdir(root);
  const artifacts = await Promise.all(
    stages.map(async (kind) => {
      const text = kind + "\nfixture second line\n";
      const relative = kind + ".txt";
      await writeFile(path.join(root, relative), text);
      return {
        id: "artifact." + kind,
        kind,
        path: relative,
        sha256: hash(text),
      };
    }),
  );
  const manifest: TraceabilityManifestType = {
    schema_version: "1.0",
    id: "trace.fixture",
    artifacts,
    links: artifacts.slice(1).map((artifact, index) => ({
      from: artifacts[index].id,
      to: artifact.id,
    })),
  };
  return { root, sandbox, manifest };
}

describe("Explicit design-code traceability", () => {
  it("rejects undeclared fields, duplicate IDs/links and invalid references before reading files", async () => {
    const { manifest } = await fixture();
    expect(validateTraceability(manifest)).toEqual(manifest);
    expect(
      TraceabilityManifest.safeParse({ ...manifest, command: "run something" })
        .success,
    ).toBe(false);
    expect(() =>
      validateTraceability({
        ...manifest,
        artifacts: [...manifest.artifacts, manifest.artifacts[0]],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateTraceability({
        ...manifest,
        links: [...manifest.links, manifest.links[0]],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateTraceability({
        ...manifest,
        links: [{ from: "artifact.unknown", to: manifest.artifacts[1].id }],
      }),
    ).toThrow(/unknown/);
    expect(() =>
      validateTraceability({
        ...manifest,
        links: [
          { from: manifest.artifacts[0].id, to: manifest.artifacts[2].id },
        ],
      }),
    ).toThrow(/adjacent/);
    const reversed = structuredClone(manifest);
    reversed.artifacts[0].lines = { start: 2, end: 1 };
    expect(() => validateTraceability(reversed)).toThrow(/range/);
  });

  it("reports a complete declared and current chain without claiming that tests were run", async () => {
    const { root, manifest } = await fixture();
    manifest.artifacts[2].lines = { start: 1, end: 2 };
    const result = await auditTraceability(root, manifest);
    expect(TraceabilityReport.safeParse(result).success).toBe(true);
    expect(result.status).toBe("complete");
    expect(result.coverage).toEqual([
      {
        requirement_id: manifest.artifacts[0].id,
        declared_chain: true,
        current_chain: true,
        missing_stages: [],
        chain_artifact_ids: manifest.artifacts.map((artifact) => artifact.id),
      },
    ]);
    expect(
      result.bindings.every((binding) => binding.status === "current"),
    ).toBe(true);
    expect(result.revision).toEqual({
      expected: null,
      actual: null,
      status: "unpinned",
      dirty: null,
    });
    expect(result.limitations.join(" ")).toContain(
      "do not establish semantic conformance",
    );
    expect(result.limitations.join(" ")).toContain("not authenticated");
  });

  it("distinguishes declared coverage from stale or missing physical artifacts", async () => {
    const { root, manifest } = await fixture();
    await writeFile(
      path.join(root, manifest.artifacts[2].path),
      "changed implementation\n",
    );
    await rm(path.join(root, manifest.artifacts[4].path));
    const result = await auditTraceability(root, manifest);
    expect(result.status).toBe("partial");
    expect(result.bindings[2].status).toBe("stale");
    expect(result.bindings[2].actual_sha256).not.toBe(
      manifest.artifacts[2].sha256,
    );
    expect(result.bindings[4].status).toBe("missing");
    expect(result.bindings[4].actual_sha256).toBeNull();
    expect(result.coverage[0].declared_chain).toBe(true);
    expect(result.coverage[0].current_chain).toBe(false);
  });

  it("exposes missing stages and unlinked artifacts without inventing links", async () => {
    const { root, manifest } = await fixture();
    manifest.links = manifest.links.slice(0, 2);
    const result = await auditTraceability(root, manifest);
    expect(result.coverage[0].missing_stages).toEqual([
      "automated_test",
      "playtest",
    ]);
    expect(result.coverage[0].declared_chain).toBe(false);
    expect(result.unlinked_artifact_ids).toEqual([
      manifest.artifacts[3].id,
      manifest.artifacts[4].id,
    ]);
    expect(result.status).toBe("partial");
  });

  it("reports implementation-only manifests as unlinked and partial, never vacuously complete", async () => {
    const { root, manifest } = await fixture();
    const result = await auditTraceability(root, {
      ...manifest,
      artifacts: [manifest.artifacts[2]],
      links: [],
    });
    expect(result.bindings[0].status).toBe("current");
    expect(result.coverage).toEqual([]);
    expect(result.unlinked_artifact_ids).toEqual([manifest.artifacts[2].id]);
    expect(result.status).toBe("partial");
  });

  it("checks inclusive line locators against text while hashing complete raw bytes", async () => {
    const { root, manifest } = await fixture();
    manifest.artifacts[0].lines = { start: 1, end: 3 };
    const range = await auditTraceability(root, manifest);
    expect(range.bindings[0].line_count).toBe(2);
    expect(range.bindings[0].status).toBe("invalid_range");
    expect(range.bindings[0].actual_sha256).toBe(manifest.artifacts[0].sha256);
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x0a]);
    await writeFile(path.join(root, manifest.artifacts[0].path), bytes);
    manifest.artifacts[0].sha256 = hash(bytes);
    delete manifest.artifacts[0].lines;
    const binary = await auditTraceability(root, manifest);
    expect(binary.bindings[0].status).toBe("current");
    expect(binary.bindings[0].actual_sha256).toBe(hash(bytes));
    expect(binary.bindings[0].line_count).toBeNull();
    manifest.artifacts[0].lines = { start: 1, end: 1 };
    const binaryRange = await auditTraceability(root, manifest);
    expect(binaryRange.bindings[0].status).toBe("invalid_range");
  });

  it("blocks traversal, absolute paths and file/directory symlinks without reading their targets", async () => {
    const { root, sandbox, manifest } = await fixture();
    const outside = path.join(sandbox, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "outside");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(root, "file-link"),
    );
    await symlink(outside, path.join(root, "directory-link"));
    for (const relative of [
      "../outside/secret.txt",
      path.join(outside, "secret.txt"),
      "C:\\outside\\secret.txt",
      "file-link",
      "directory-link/secret.txt",
    ]) {
      const restricted = {
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], path: relative }],
        links: [],
      };
      const result = await auditTraceability(root, restricted);
      expect(result.bindings[0].status, relative).toBe("blocked");
      expect(result.bytes_read).toBe(0);
      expect(result.bindings[0].actual_sha256).toBeNull();
    }
  });

  it("bounds distinct-file reads and reuses repeated file snapshots", async () => {
    const { root, manifest } = await fixture();
    const buffer = Buffer.alloc(MAX_FILE, 65);
    const artifacts: TraceabilityManifestType["artifacts"] = [];
    for (let index = 0; index < 11; index++) {
      const relative = "large-" + index + ".txt";
      await writeFile(path.join(root, relative), buffer);
      artifacts.push({
        id: "artifact.large" + index,
        kind: "requirement",
        path: relative,
        sha256: hash(buffer),
      });
    }
    const limited = await auditTraceability(root, {
      ...manifest,
      artifacts,
      links: [],
    });
    expect(limited.bytes_read).toBe(20 * 1024 * 1024);
    expect(limited.bindings[10].status).toBe("budget_exceeded");
    expect(limited.bindings[10].actual_sha256).toBeNull();
    const repeated = await auditTraceability(root, {
      ...manifest,
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        path: artifacts[0].path,
      })),
      links: [],
    });
    expect(repeated.bytes_read).toBe(MAX_FILE);
    expect(
      repeated.bindings.every((binding) => binding.status === "current"),
    ).toBe(true);
    await writeFile(
      path.join(root, "too-large.txt"),
      Buffer.alloc(MAX_FILE + 1),
    );
    const oversized = await auditTraceability(root, {
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], path: "too-large.txt" }],
      links: [],
    });
    expect(oversized.bindings[0].status).toBe("unreadable");
    expect(oversized.bytes_read).toBe(0);
  });

  it("compares a pinned checkout and exposes dirty state separately from file fingerprints", async () => {
    const { root, manifest } = await fixture();
    const args = [
      "-C",
      root,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
    ];
    await exec("git", [...args, "init", "--quiet"]);
    await exec("git", [...args, "add", "."]);
    await exec("git", [
      ...args,
      "-c",
      "user.name=Traceability Test",
      "-c",
      "user.email=traceability@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    manifest.revision = (
      await exec("git", [...args, "rev-parse", "HEAD"])
    ).stdout.trim();
    const clean = await auditTraceability(root, manifest);
    expect(clean.revision).toEqual({
      expected: manifest.revision,
      actual: manifest.revision,
      status: "match",
      dirty: false,
    });
    expect(clean.status).toBe("complete");
    await writeFile(path.join(root, "untracked.txt"), "untracked change");
    const dirty = await auditTraceability(root, manifest);
    expect(dirty.revision.status).toBe("match");
    expect(dirty.revision.dirty).toBe(true);
    expect(dirty.coverage[0].current_chain).toBe(true);
    expect(dirty.status).toBe("partial");
    const mismatched = await auditTraceability(root, {
      ...manifest,
      revision: "0".repeat(40),
    });
    expect(mismatched.revision.status).toBe("mismatch");
    expect(mismatched.revision.actual).toBe(manifest.revision);
  });

  it("reports unavailable pinned Git metadata and propagates explicit cancellation", async () => {
    const { root, manifest } = await fixture();
    const unversioned = await auditTraceability(root, {
      ...manifest,
      revision: "0".repeat(40),
    });
    expect(unversioned.revision.status).toBe("unavailable");
    expect(unversioned.status).toBe("partial");
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));
    await expect(
      auditTraceability(root, manifest, controller.signal),
    ).rejects.toThrow("cancelled by test");
  });
});
