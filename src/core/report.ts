import { analyseMechanic } from "../analysis/mechanic.js";
import { Document } from "./schemas.js";
export function renderReport(
  data: Awaited<ReturnType<typeof analyseMechanic>>,
  language: "ru" | "en" = "ru",
) {
  const ru = language === "ru",
    m = data.mechanic;
  return (
    [
      `# LUDOSCOPE — ${m.name}`,
      `\n${ru ? "Статус: черновик. Версия схемы" : "Status: draft. Schema version"}: 1.0`,
      `\n## ${ru ? "Назначение и предполагаемый опыт" : "Purpose and hypothesized experience"}`,
      m.player_goal,
      ...m.expected_experiences.map((x) => `- DESIGN_HYPOTHESIS: ${x}`),
      `\n## ${ru ? "Связь действий и опыта" : "Action–experience chain"}`,
      JSON.stringify(data.experience_chain, null, 2),
      `\n## ${ru ? "Выводы" : "Findings"}`,
      ...data.findings.map(
        (f) =>
          `\n### ${f.claim_type}: ${f.claim}\n\n${ru ? "Основание" : "Evidence"}: ${f.evidence.join("; ")}\n\n${ru ? "Проверка" : "Validation"}: ${f.validation_method}\n\n${ru ? "Альтернативы" : "Alternatives"}: ${f.alternatives.join("; ")}\n\n${ru ? "Предположения" : "Assumptions"}: ${f.assumptions.join("; ")}\n\n${ru ? "Ограничения" : "Limitations"}: ${f.limitations.join("; ")}`,
      ),
      `\n## ${ru ? "Релевантные знания" : "Relevant knowledge"}`,
      ...data.knowledge.map(
        (k) =>
          `- ${k.id}: ${k.title} (${k.verification_status}); ${k.source_ids.join(", ")}; ${k.evidence_locator}`,
      ),
      `\n## ${ru ? "Зависимости" : "Dependencies"}`,
      m.dependencies.join(", ") || "—",
      `\n## ${ru ? "Задачи проектирования" : "Design tasks"}`,
      ...data.reasoning_tasks.map((x) => `- ${x}`),
      `\n## ${ru ? "Эксперимент" : "Experiment"}`,
      data.experiment.question,
      data.experiment.method,
      ...data.experiment.metrics.map((x) => `- ${x}`),
      `\n## ${ru ? "Ограничения" : "Limitations"}`,
      ...data.limitations.map((x) => `- ${x}`),
    ].join("\n") + "\n"
  );
}
export function renderDocument(input: unknown) {
  const d = Document.parse(input);
  return (
    [
      `# ${d.type} — ${d.id}`,
      `Version: ${d.version} | Status: ${d.status} | Language: ${d.language}`,
      `Sources: ${d.sources.join(", ")}`,
      `Links: ${d.links.join(", ")}`,
      d.body,
      "## History",
      ...d.history.map((s) => `- ${s}`),
    ].join("\n\n") + "\n"
  );
}
