import { KnowledgeRegistry, type SearchContext } from "./knowledge.js";
import { terms, metadataMatches } from "./retrieval.js";
export interface LensSelectionContext extends SearchContext {
  query: string;
  system: string;
}
export function selectLenses(k: KnowledgeRegistry, c: LensSelectionContext) {
  const tags = [...new Set([...(c.tags ?? []), ...terms(c.query)])];
  const candidates = k.search(c.query, {
    ...c,
    tags,
    kind: "Lens",
    mode: c.mode ?? "design",
    limit: 100,
  });
  return candidates.slice(0, Math.min(c.limit ?? 10, 10)).map((lens) => {
    const matchedTags = metadataMatches(lens.tags, tags);
    const matchedSystems = metadataMatches(
      lens.selection?.required_system_types ?? [],
      c.system_types ?? [],
    );
    const reasons = [
      matchedTags.length
        ? "Совпали тематические признаки запроса."
        : "Общая линза применима к указанному контексту.",
      ...(matchedSystems.length ? ["Явно указаны требуемые типы систем."] : []),
      ...(lens.selection?.modes.length
        ? ["Режим работы удовлетворяет условиям линзы."]
        : []),
      "Линза является оригинальной операционализацией LUDOSCOPE; релевантность не доказывает эффект.",
    ];
    return {
      ...lens,
      bound_questions: lens.questions.map((q) => `${c.system}: ${q}`),
      relevance: {
        matched_tags: matchedTags,
        matched_system_types: matchedSystems,
        reasons,
      },
    };
  });
}
