import { describe, it, expect, afterEach } from "vitest";
import { readFile, mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simulate } from "../src/simulation/index.js";
import { validateTraceability } from "../src/analysis/traceability.js";
const exec = promisify(execFile);
const appRoot = path.resolve(import.meta.dirname, "..");
const fixture = async (name: string) =>
  JSON.parse(
    await readFile(
      path.join(appRoot, "examples/hydrocraft-pilot", name),
      "utf8",
    ),
  );
const temporary: string[] = [];
const temp = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ludoscope-pilot-test-"));
  temporary.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Hydrocraft cotton abstraction, not a game runtime", () => {
  it("shows the bootstrap threshold and preserves stock accounting in every state", async () => {
    const model = await fixture("economy.json");
    for (let spindles = 0; spindles <= 3; spindles++) {
      model.initial.spindle = spindles;
      const result = simulate(model);
      expect(result.final.cotton_cloth).toBe(spindles === 3 ? 2 : 0);
      expect(result.final.cotton_seeds).toBe(18);
      expect(result.violations).toEqual([]);
      for (const { resources: s } of result.trajectory) {
        expect(s.spindle + s.cotton_thread).toBe(spindles);
        expect(
          s.cotton_raw + s.cotton + 3 * s.cotton_thread + 9 * s.cotton_cloth,
        ).toBe(18);
      }
    }
  });
  it("requires the selected stations and exposes omission of the callback output", async () => {
    for (const station of ["cotton_gin", "spinning_station", "loom"]) {
      const model = await fixture("economy.json");
      model.initial[station] = 0;
      model.invariants = model.invariants.filter(
        (i: { resource: string }) => i.resource !== station,
      );
      expect(simulate(model).final.cotton_cloth).toBe(0);
    }
    const incomplete = await fixture("economy.json");
    delete incomplete.processes[2].outputs.spindle;
    expect(simulate(incomplete).final).toMatchObject({
      cotton_cloth: 1,
      spindle: 0,
      cotton: 9,
    });
  });
  it("keeps source locators consistent with pinned identities without declaring upstream test evidence", async () => {
    const manifest = validateTraceability(
      await fixture("source-traceability.json"),
    );
    const sources = await fixture("sources.json");
    expect(manifest.revision).toBe(sources.revision);
    expect(manifest.links).toEqual([]);
    for (const artifact of manifest.artifacts) {
      expect(artifact.kind).toBe("implementation");
      expect(
        sources.files.find((f: { path: string }) => f.path === artifact.path)
          .sha256,
      ).toBe(artifact.sha256);
    }
  });
  it("runs offline, exports verifiable artifacts and refuses to replace existing output", async () => {
    const root = await temp(),
      output = path.join(root, "report");
    const args = [
      path.join(appRoot, "scripts/hydrocraft-pilot.mjs"),
      "--output",
      output,
    ];
    const response = await exec(process.execPath, args, { cwd: root });
    expect(JSON.parse(response.stdout)).toMatchObject({
      source_verification_performed: false,
      human_participants: 0,
    });
    const data = JSON.parse(
      await readFile(path.join(output, "data.json"), "utf8"),
    );
    expect(data.source_verification).toBeNull();
    expect(
      data.cases.map(
        (c: { result: { final: { cotton_cloth: number } } }) =>
          c.result.final.cotton_cloth,
      ),
    ).toEqual([0, 0, 0, 2]);
    const manifest = JSON.parse(
      await readFile(path.join(output, "manifest.json"), "utf8"),
    );
    for (const [name, hash] of Object.entries(manifest.artifacts))
      expect(
        createHash("sha256")
          .update(await readFile(path.join(output, name)))
          .digest("hex"),
      ).toBe(hash);
    await expect(exec(process.execPath, args, { cwd: root })).rejects.toThrow();
  });
  it("fails a missing source verification and refuses outputs inside the source checkout", async () => {
    const root = await temp(),
      output = path.join(root, "output");
    const script = path.join(appRoot, "scripts/hydrocraft-pilot.mjs");
    await expect(
      exec(process.execPath, [script, "--source", root, "--output", output]),
    ).rejects.toThrow(/outside the read-only/);
    const sibling = await temp();
    await expect(
      exec(process.execPath, [
        script,
        "--source",
        root,
        "--output",
        path.join(sibling, "report"),
      ]),
    ).rejects.toThrow(/Pinned source files/);
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(sibling)).toEqual([]);
  });
  it("CLI resolves its manifest from cwd while inspecting a separate root without writes", async () => {
    const inspected = await temp(),
      manifests = await temp();
    await writeFile(path.join(inspected, "rules.txt"), "rules\n");
    const manifest = {
      schema_version: "1.0",
      id: "trace.cli",
      artifacts: [
        {
          id: "implementation.rules",
          kind: "implementation",
          path: "rules.txt",
          sha256: createHash("sha256").update("rules\n").digest("hex"),
        },
      ],
      links: [],
    };
    await writeFile(
      path.join(manifests, "manifest.json"),
      JSON.stringify(manifest),
    );
    const args = [
      path.join(appRoot, "dist/cli/index.js"),
      "--project",
      inspected,
      "trace",
      "manifest.json",
    ];
    const { stdout } = await exec(process.execPath, args, { cwd: manifests });
    expect(JSON.parse(stdout)).toMatchObject({
      status: "partial",
      bindings: [{ status: "current" }],
    });
    expect(await readdir(inspected)).toEqual(["rules.txt"]);
    await writeFile(
      path.join(manifests, "manifest.json"),
      JSON.stringify({ ...manifest, unexpected: true }),
    );
    await expect(
      exec(process.execPath, args, { cwd: manifests }),
    ).rejects.toThrow();
  });
});
