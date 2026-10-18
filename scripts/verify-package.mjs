import Ajv2020 from "ajv/dist/2020.js";
import { readFile, readdir, access } from "node:fs/promises";
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const ajv = new Ajv2020({ strict: false });
for (const [schema, file] of [
  ["schemas/agent-plugin.schema.json", "plugin.json"],
  ["schemas/agent-mcp.schema.json", "mcp.json"],
]) {
  const check = ajv.compile(await json(schema));
  if (!check(await json(file)))
    throw new Error(`${file}: ${JSON.stringify(check.errors)}`);
}
const skills = await readdir("skills");
for (const skill of skills) {
  const text = await readFile(`skills/${skill}/SKILL.md`, "utf8");
  if (!/^---\nname: [a-z0-9-]+\ndescription: .+\n---/m.test(text))
    throw new Error(`Invalid skill ${skill}`);
}
const { operations } = await import("../dist/core/operations.js");
for (const name of Object.keys(operations)) {
  await access(`schemas/tools/${name}.input.json`);
  await access(`schemas/tools/${name}.output.json`);
}
console.log(
  JSON.stringify({
    manifests: "valid against official Agent Plugins 1.0.0 schemas",
    skills: skills.length,
    tools: Object.keys(operations).length,
  }),
);
const { Document } = await import("../dist/core/schemas.js");
let templates = 0;
for (const language of ["ru", "en"])
  for (const file of await readdir(`templates/${language}`)) {
    Document.parse(await json(`templates/${language}/${file}`));
    templates++;
  }
console.log(JSON.stringify({ document_templates: templates }));
