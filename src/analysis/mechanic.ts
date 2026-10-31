import { Mechanic, Claim } from "../core/schemas.js";
import {
  registry,
  KnowledgeRegistry,
  retrieveContext,
} from "../core/knowledge.js";
import type { SearchContext } from "../core/knowledge.js";
import type { z } from "zod";
export async function analyseMechanic(
  input: unknown,
  context: SearchContext = {},
  knowledge?: KnowledgeRegistry,
) {
  const m = Mechanic.parse(input);
  const k = knowledge ?? (await registry());
  const retrievalContext = {
    ...context,
    tags: [...(context.tags ?? []), ...m.tags],
    genre: m.genre || context.genre || undefined,
    stage: m.stage,
    mode: context.mode ?? ("design" as const),
    system_types: [
      ...new Set([
        ...(context.system_types ?? []),
        "mechanic",
        ...(m.resources.length ? ["resource"] : []),
      ]),
    ],
    limit: 8,
  };
  const theories = retrieveContext(
    k,
    [m.name, m.player_goal, ...m.tags, ...m.expected_experiences].join(" "),
    retrievalContext,
  );
  const findings: z.infer<typeof Claim>[] = [];
  function finding(
    claim: string,
    evidence: string[],
    validation: string,
    alternatives: string[] = [],
  ) {
    findings.push(
      Claim.parse({
        claim,
        claim_type: "EXPERT_INFERENCE",
        evidence,
        assumptions: [
          "Only the submitted specification is available; player behavior is not measured.",
        ],
        relevant_theories: theories.map((t) => t.id),
        limitations: [
          "Structural heuristic; author intent and playtests may justify the design.",
        ],
        alternatives,
        validation_method: validation,
        status: "open",
      }),
    );
  }
  if (!m.player_goal.trim() || !m.expected_experiences.length)
    finding(
      "Назначение механики или целевой опыт не определены.",
      [`${m.id}: player_goal / expected_experiences`],
      "Сформулировать опыт и наблюдаемые действия, затем сравнить прототипы.",
      ["Уточнить цель", "Проверить версию без механики"],
    );
  if (!m.state_transitions.length)
    finding(
      "Не описаны изменения состояния после действий.",
      [`${m.id}: state_transitions=[]`],
      "Задать входное состояние, действие и ожидаемое состояние.",
    );
  if (!m.feedback.length)
    finding(
      "Спецификация не содержит обратной связи.",
      [`${m.id}: feedback=[]`],
      "Проверить распознавание игроком результата действия.",
      ["Визуальная реакция", "Звуковая или тактильная реакция"],
    );
  if (m.player_actions.length > 0 && m.choices.length < 2)
    finding(
      "Содержательные альтернативы не формализованы; возможны обязательная процедура или намеренный ритуал.",
      [
        `${m.id}: ${m.player_actions.length} actions, ${m.choices.length} formal choices`,
      ],
      "Сравнить полную версию, автоматизацию процедуры и удаление; наблюдать решения, а не только число действий.",
      [
        "Сохранить как авторский ритуал",
        "Автоматизировать после освоения",
        "Добавить контекст выбора",
      ],
    );
  const dominated: string[] = [];
  for (const a of m.choices)
    if (
      a.cost !== undefined &&
      a.benefit !== undefined &&
      m.choices.some(
        (b) =>
          b.id !== a.id &&
          b.cost !== undefined &&
          b.benefit !== undefined &&
          b.cost <= a.cost! &&
          b.benefit >= a.benefit! &&
          (b.cost < a.cost! || b.benefit > a.benefit!),
      )
    )
      dominated.push(a.id);
  if (dominated.length)
    finding(
      "При единственной заданной цене и выгоде обнаружены доминируемые варианты.",
      dominated,
      "Проверить пропущенные контекстные выгоды и доступность вариантов.",
      ["Изменить цену", "Добавить контекстную ценность"],
    );
  return {
    schema_version: "1.0",
    mechanic: m,
    findings,
    knowledge: theories,
    conflicts: theories.flatMap((t) =>
      t.conflicting_entry_ids
        .filter((id) => {
          const target = k.data.entries.find((e) => e.id === id);
          return target && k.applicable(target, retrievalContext);
        })
        .map((id) => ({
          entry: t.id,
          conflicts_with: id,
        })),
    ),
    affected_systems: m.dependencies,
    experience_chain: {
      actions: m.player_actions,
      rules: m.rules,
      state_changes: m.state_transitions,
      feedback: m.feedback,
      experience_hypotheses: m.expected_experiences,
    },
    decision_status: "draft",
    reasoning_tasks: [
      "Уточнить намерение и ограничения проекта.",
      "Codex: предложить минимум три различающихся варианта, включая удаление или упрощение там, где уместно.",
      "Для каждого варианта: опыт, изменение состояния, стоимость, риск, компромисс и опровержимый эксперимент.",
      "Не сохранять выбор до явного решения пользователя.",
    ],
    experiment: {
      question: `Как ${m.name} влияет на ${m.expected_experiences.join(", ") || "целевой опыт"}?`,
      hypothesis_type: "DESIGN_HYPOTHESIS",
      method:
        "Сравнительный плейтест вариантов с одинаковыми задачами; порядок чередовать.",
      metrics: [
        "Наблюдаемые решения и их последствия",
        "Время до понимания правила",
        "Субъективное описание опыта отдельно от измерений",
      ],
      limitations: [
        "Нужны реальные участники и критерии интерпретации до теста.",
      ],
    },
    intentional_tradeoffs: m.intentional_tradeoffs,
    limitations: [
      "This engine provides structural checks and context; creative alternatives are produced by Codex, not a text-template LLM replacement.",
    ],
  };
}
