import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const roots = new Set(["docs", "examples", "skills", "contracts", ".github"]);
const files = [];
async function walk(directory, top = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && (!top || roots.has(entry.name)))
      await walk(target);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
}
await walk(root, true);
let checked = 0;
const errors = [];
for (const file of files) {
  const markdown = (await readFile(file, "utf8")).replace(
    /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
    "",
  );
  for (const match of markdown.matchAll(
    /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const raw = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;
    const relative = decodeURIComponent(raw.split("#")[0].split("?")[0]);
    const target = path.resolve(path.dirname(file), relative);
    if (!target.startsWith(root)) {
      errors.push(
        path.relative(root, file) + ": link escapes repository: " + raw,
      );
      continue;
    }
    try {
      await stat(target);
      checked++;
    } catch {
      errors.push(path.relative(root, file) + ": missing " + raw);
    }
  }
}
if (errors.length)
  throw new Error("Broken documentation links:\n" + errors.join("\n"));
console.log(
  JSON.stringify({
    documentation_files: files.length,
    relative_links_checked: checked,
    external_urls: "not fetched",
  }),
);
