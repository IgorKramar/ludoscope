import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  operationInputs,
  operationOutputs,
  type AgentOperation,
} from "./contracts.js";
import {
  LudoscopeAgentApi,
  agentCapabilities,
  type AgentApiOptions,
} from "./api.js";
export function registerAgentTools(
  server: McpServer,
  options: AgentApiOptions = {},
) {
  let api: Promise<LudoscopeAgentApi> | undefined;
  for (const capability of agentCapabilities) {
    const name = capability.operation as AgentOperation;
    server.registerTool(
      name,
      {
        description: capability.description,
        inputSchema: operationInputs[name],
        outputSchema: operationOutputs[name],
        annotations: {
          readOnlyHint: capability.read_only,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: !!options.chronicler,
        },
      },
      async (input: unknown) => {
        try {
          api ??= LudoscopeAgentApi.create(options);
          const body = (await (await api).invoke(name, input)) as Record<
            string,
            unknown
          >;
          return {
            content: [{ type: "text" as const, text: JSON.stringify(body) }],
            structuredContent: body,
            isError: body.status === "error",
          };
        } catch (error) {
          if (operationInputs[name].safeParse(input).success) {
            const instance = await (api ??= LudoscopeAgentApi.create(options));
            const body = instance.failure(name, input, error) as Record<
              string,
              unknown
            >;
            return {
              isError: true,
              content: [{ type: "text" as const, text: JSON.stringify(body) }],
              structuredContent: body,
            };
          }
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: {
                    code:
                      error instanceof z.ZodError ? "VALIDATION" : "API_ERROR",
                    message:
                      error instanceof z.ZodError
                        ? error.issues
                            .map((i) => `${i.path.join(".")}: ${i.message}`)
                            .join("; ")
                        : error instanceof Error
                          ? error.message
                          : "Unknown API error",
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
}
