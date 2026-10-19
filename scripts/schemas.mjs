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
    JSON.stringify(z.toJSONSchema(op.input, { io: "input" }), null, 2) + "\n",
  );
  await writeFile(
    `schemas/tools/${name}.output.json`,
    JSON.stringify(z.toJSONSchema(resultSchemas[name]), null, 2) + "\n",
  );
}

const { contractSchemas, operationInputs, operationOutputs } =
  await import("../dist/integration/contracts.js");
await mkdir("contracts/fip/v1/operations", { recursive: true });
for (const [name, schema] of Object.entries(contractSchemas))
  await writeFile(
    `contracts/fip/v1/${name}.schema.json`,
    JSON.stringify(
      z.toJSONSchema(
        schema,
        name === "GameDesignRequest" ? { io: "input" } : {},
      ),
      null,
      2,
    ) + "\n",
  );
for (const [name, input] of Object.entries(operationInputs)) {
  await writeFile(
    `contracts/fip/v1/operations/${name}.input.schema.json`,
    JSON.stringify(z.toJSONSchema(input, { io: "input" }), null, 2) + "\n",
  );
  await writeFile(
    `contracts/fip/v1/operations/${name}.output.schema.json`,
    JSON.stringify(z.toJSONSchema(operationOutputs[name]), null, 2) + "\n",
  );
}
