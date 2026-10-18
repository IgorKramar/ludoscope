import {
  lstat,
  realpath,
  open,
  mkdir,
  link,
  unlink,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensure } from "./errors.js";
export const MAX_FILE = 2 * 1024 * 1024;
export async function contained(
  root: string,
  relative: string,
  createParents = false,
): Promise<string> {
  const base = await realpath(root);
  ensure(!path.isAbsolute(relative), "PATH", "Relative path required");
  const parts = relative.split(/[\\/]/);
  ensure(
    parts.length > 0 && parts.every((p) => p !== "." && p !== ".." && p !== ""),
    "PATH",
    "Invalid path component",
  );
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try {
      stat = await lstat(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (createParents && i < parts.length - 1) {
        try {
          await mkdir(current);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        stat = await lstat(current);
      } else continue;
    }
    ensure(
      stat && !stat.isSymbolicLink(),
      "SYMLINK",
      "Symbolic links are not allowed",
    );
    if (i < parts.length - 1)
      ensure(stat.isDirectory(), "PATH", "Parent must be a directory");
  }
  return current;
}
export async function readBufferBounded(
  root: string,
  relative: string,
): Promise<Buffer> {
  const file = await contained(root, relative);
  const h = await open(file, "r");
  try {
    const stat = await h.stat();
    ensure(
      stat.isFile() && stat.size <= MAX_FILE,
      "SIZE",
      "File must be regular and at most 2 MiB",
    );
    const buffer = Buffer.alloc(Math.min(MAX_FILE + 1, stat.size + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await h.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    ensure(
      offset <= MAX_FILE && offset === stat.size,
      "FILE_CHANGED",
      "File size changed during read; retry with a fresh snapshot",
    );
    return buffer.subarray(0, offset);
  } finally {
    await h.close();
  }
}
export async function readBounded(
  root: string,
  relative: string,
): Promise<string> {
  return (await readBufferBounded(root, relative)).toString("utf8");
}
// Immutable records: atomic hard-link publication refuses existing destinations, including symlinks.
export async function createFile(
  root: string,
  relative: string,
  text: string,
): Promise<void> {
  ensure(Buffer.byteLength(text) <= MAX_FILE, "SIZE", "Output too large");
  const dest = await contained(root, relative, true);
  const tmp = path.join(path.dirname(dest), `.ludoscope-${randomUUID()}.tmp`);
  const h = await open(tmp, "wx", 0o600);
  try {
    await h.writeFile(text);
    await h.sync();
  } finally {
    await h.close();
  }
  try {
    await link(tmp, dest);
  } finally {
    await unlink(tmp);
  }
}
export async function exists(root: string, relative: string) {
  try {
    await contained(root, relative);
    await readBounded(root, relative);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function replaceWithBackup(
  root: string,
  relative: string,
  content: string,
  expectedSha256: string,
) {
  const { createHash } = await import("node:crypto");
  const { rename } = await import("node:fs/promises");
  const dest = await contained(root, relative),
    lockPath = await contained(root, relative + ".lock");
  const lock = await open(lockPath, "wx", 0o600);
  let tmp: string | undefined;
  try {
    const old = await readBounded(root, relative);
    const actual = createHash("sha256").update(old).digest("hex");
    ensure(
      actual === expectedSha256,
      "STALE_PREVIEW",
      "File changed since preview; review again",
    );
    const backup = `.ludoscope/history/${actual}.json`;
    try {
      await createFile(root, backup, old);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      ensure(
        (await readBounded(root, backup)) === old,
        "BACKUP_CONFLICT",
        "Existing backup differs",
      );
    }
    ensure(Buffer.byteLength(content) <= MAX_FILE, "SIZE", "Output too large");
    tmp = path.join(path.dirname(dest), `.ludoscope-${randomUUID()}.tmp`);
    const h = await open(tmp, "wx", 0o600);
    try {
      await h.writeFile(content);
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, dest);
    tmp = undefined;
    return { backup };
  } finally {
    if (tmp) await unlink(tmp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
