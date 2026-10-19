import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import * as schemas from "../dist/core/schemas.js";
await mkdir("schemas", { recursive: true });
for (const name of [
  "RegistrySchema",
  "Source",
  "Entry",
  "Mechanic",
  "Graph",
  "Decision",
  "Project",
  "Model",
  "Rules",
  "Experiment",
  "Document",
  "Claim",
  "Artifact",
])
  await writeFile(
    `schemas/${name}.schema.json`,
    JSON.stringify(z.toJSONSchema(schemas[name]), null, 2) + "\n",
  );

const { operations } = await import("../dist/core/operations.js");
const { resultSchemas } = await import("../dist/core/results.js");
await mkdir("schemas/tools", { recursive: true });
for (const [name, op] of Object.entries(operations)) {
  await writeFile(
    `schemas/tools/${name}.input.json`,
    JSON.stringify(z.toJSONSchema(op.input), null, 2) + "\n",
  );
  await writeFile(
    `schemas/tools/${name}.output.json`,
    JSON.stringify(z.toJSONSchema(resultSchemas[name]), null, 2) + "\n",
  );
}
