import { resultSchemas } from "../core/results.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { operations, invoke, type OperationName } from "../core/operations.js";
import { ProjectStore } from "../project/store.js";
import { LudoscopeError } from "../core/errors.js";
export function createServer(root: string) {
  const server = new McpServer({ name: "ludoscope", version: "0.1.0" });
  const store = new ProjectStore(root);
  for (const [name, op] of Object.entries(operations)) {
    server.registerTool(
      name,
      {
        description: op.description,
        inputSchema: op.input,
        outputSchema: z.strictObject({
          schema_version: z.literal("1.0"),
          operation: z.literal(name),
          result: resultSchemas[name as OperationName],
        }),
        annotations: {
          readOnlyHint: !op.write,
          destructiveHint: false,
          idempotentHint: !op.write,
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        try {
          const result = await invoke(name as OperationName, input, store);
          const body = {
            schema_version: "1.0" as const,
            operation: name,
            result: JSON.parse(JSON.stringify(result)),
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(body) }],
            structuredContent: body,
          };
        } catch (error) {
          const code =
            error instanceof LudoscopeError
              ? error.code
              : error instanceof z.ZodError
                ? "VALIDATION"
                : ((error as NodeJS.ErrnoException).code ?? "ERROR");
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: {
                    code,
                    message:
                      error instanceof z.ZodError
                        ? error.issues
                            .map((i) => `${i.path.join(".")}: ${i.message}`)
                            .join("; ")
                        : error instanceof Error
                          ? error.message
                          : "Unknown error",
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
