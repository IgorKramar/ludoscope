import { z } from "zod";
import {
  RefId,
  ArtifactReference,
  GameDesignAnalysis,
  type DesignRequest,
  type DesignAnalysis,
} from "./contracts.js";
export const ProjectHistory = z.strictObject({
  project_id: RefId,
  decisions: z
    .array(
      z.strictObject({
        id: RefId,
        decision: z.string().min(1).max(4000),
        artifact_refs: z.array(ArtifactReference).max(20),
      }),
    )
    .max(100),
  experiments: z
    .array(
      z.strictObject({
        id: RefId,
        question: z.string().min(1).max(4000),
        result: z.string().min(1).max(4000),
      }),
    )
    .max(100),
  rejected_alternatives: z
    .array(
      z.strictObject({
        id: RefId,
        title: z.string().min(1).max(4000),
        reason: z.string().min(1).max(4000),
      }),
    )
    .max(100),
});
/** Host implements this port using Chronicler's actual official API. No endpoints or DB schema assumed. */
export interface ChroniclerAdapter {
  getProjectContext(
    request: DesignRequest,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ProjectHistory>>;
  publishAnalysis(
    analysis: DesignAnalysis,
    signal: AbortSignal,
  ): Promise<{ receipt_id: string }>;
}
export type PublishAuthorization = (
  request: DesignRequest,
  analysis: DesignAnalysis,
) => boolean | Promise<boolean>;
export async function bounded<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Chronicler timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function validatePublication(analysis: unknown) {
  return GameDesignAnalysis.parse(analysis);
}
