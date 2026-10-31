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

const { agentCapabilities } = await import("../dist/integration/api.js");
const { contractSchemas } = await import("../dist/integration/contracts.js");
for (const capability of agentCapabilities) {
  await access(capability.input_schema);
  await access(capability.output_schema);
}
for (const name of Object.keys(contractSchemas))
  await access(`contracts/fip/v1/${name}.schema.json`);
console.log(
  JSON.stringify({
    agent_tools: agentCapabilities.length,
    total_mcp_tools: Object.keys(operations).length + agentCapabilities.length,
    fip_profile: "ludoscope.fip-v1-draft.1",
  }),
);

const { VERSION } = await import("../dist/core/version.js");
const packageInfo = await json("package.json");
const pluginInfo = await json("plugin.json");
const lockInfo = await json("package-lock.json");
if (
  [
    packageInfo.version,
    pluginInfo.version,
    lockInfo.version,
    lockInfo.packages[""].version,
  ].some((v) => v !== VERSION)
)
  throw new Error("Package, plugin, lockfile and runtime versions must agree");
console.log(JSON.stringify({ version: VERSION, version_consistency: "valid" }));
