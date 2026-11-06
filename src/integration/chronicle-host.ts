import type { AgentApiOptions } from "./api.js";
import { ChronicleHttpAdapter } from "./chronicle-http.js";

/** Trusted host environment only. Never populate these fields from model input. */
export function chronicleHostOptions(
  env: NodeJS.ProcessEnv = process.env,
): AgentApiOptions {
  const keys = [
    "LUDOSCOPE_CHRONICLE_URL",
    "LUDOSCOPE_CHRONICLE_TOKEN",
    "LUDOSCOPE_CHRONICLE_PROJECT_ID",
    "LUDOSCOPE_CHRONICLE_AGENT_ID",
  ] as const;
  if (!keys.some((k) => env[k] !== undefined)) return {};
  if (keys.some((k) => !env[k]))
    throw new Error("Incomplete Chronicle host configuration");
  for (const key of [
    "LUDOSCOPE_CHRONICLE_ALLOW_LOOPBACK_HTTP",
    "LUDOSCOPE_CHRONICLE_PUBLISH",
  ])
    if (env[key] !== undefined && !["true", "false"].includes(env[key]!))
      throw new Error(`Invalid boolean host option ${key}`);
  const projectId = env.LUDOSCOPE_CHRONICLE_PROJECT_ID!;
  const agentId = env.LUDOSCOPE_CHRONICLE_AGENT_ID!;
  const publishEnabled = env.LUDOSCOPE_CHRONICLE_PUBLISH === "true";
  return {
    chronicler: new ChronicleHttpAdapter({
      endpoint: env.LUDOSCOPE_CHRONICLE_URL!,
      token: env.LUDOSCOPE_CHRONICLE_TOKEN!,
      projectId,
      agentId,
      allowLoopbackHttp: env.LUDOSCOPE_CHRONICLE_ALLOW_LOOPBACK_HTTP === "true",
    }),
    chroniclerTimeoutMs: 10000,
    authorizePublish: (request, analysis) =>
      publishEnabled &&
      request.project_id === projectId &&
      analysis.project_id === projectId &&
      (!request.agent_id || request.agent_id === agentId) &&
      (!analysis.agent_id || analysis.agent_id === agentId),
  };
}
