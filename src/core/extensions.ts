import type { KnowledgeEntry, SearchContext } from "./knowledge.js";
import type { SystemModel } from "../simulation/index.js";
export const EXTENSION_API_VERSION = "1.0" as const;
export interface KnowledgeProvider {
  apiVersion: "1.0";
  id: string;
  search(query: string, context: SearchContext): Promise<KnowledgeEntry[]>;
}
export interface EngineAdapter {
  apiVersion: "1.0";
  id: string;
  detect(files: string[]): {
    confidence: "marker" | "unknown";
    evidence: string[];
  };
  readDesign(root: string): Promise<unknown>;
}
export interface AnalysisRule {
  apiVersion: "1.0";
  id: string;
  analyse(input: unknown, signal?: AbortSignal): Promise<unknown>;
}
export interface ReportRenderer {
  apiVersion: "1.0";
  format: string;
  render(data: unknown, language: "ru" | "en"): string;
}
export interface DataImporter {
  apiVersion: "1.0";
  format: string;
  parse(text: string): unknown;
}
export interface ExternalResearchProvider {
  apiVersion: "1.0";
  id: string;
  lookup(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; excerpt: string; license: string }[]>;
}
export interface UniversalModderAdapter extends EngineAdapter {
  capabilities(): Promise<string[]>;
  proposeModification(
    specification: unknown,
  ): Promise<{ preview: string; unsupported: string[] }>;
}
// No concrete Universal Modder API is assumed. Extensions are application-provided, never loaded from knowledge documents.
