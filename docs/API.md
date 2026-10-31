# Программный API LUDOSCOPE 0.5.0

Основной транспорт — MCP stdio. Дополнительно доступна локальная TypeScript/JavaScript-библиотека. HTTP-сервера нет: для текущих локальных операций он не требуется. Прежние 24 `ludoscope_*` операции сохранены; добавлены 15 запрошенных агентных операций и `publish_analysis`, всего 40 инструментов. Все новые операции имеют строгие схемы аргументов и результатов.

## Локальное использование

```ts
import { LudoscopeAgentApi } from 'ludoscope/api';
import type { GameDesignRequest } from 'ludoscope/contracts/fip/v1';

const request: GameDesignRequest = {
  api_version: '1.0', request_id: 'request.1', project_id: 'project.demo',
  task_id: 'task.mechanic', timestamp: new Date().toISOString(),
  status: 'submitted', artifact_refs: [], evidence: [],
  context: {
    subject: 'Выбор маршрута', genre: 'puzzle', audience: 'новички',
    author_goals: ['Понять правило пространства'], creative_principles: ['Три правила'],
    constraints: ['Без прогрессии персонажа'], tags: ['choice'], system_types: ['mechanic'],
    disabled_sources: [], disabled_schools: []
  }
};
const api = await LudoscopeAgentApi.create();
const capabilities = await api.call('get_capabilities', { request });
```

`call` проверяется TypeScript по имени операции и входной структуре; `invoke` принимает `unknown` для динамического оркестратора. Оба валидируют вход и выход в runtime. Возвращаемый тип зависит от имени операции. Библиотечные ошибки схемы/вычислений отклоняют Promise; результат MCP при корректном запросе сохраняет correlation-поля и `status:error`. Некорректный запрос не считается достоверным envelope: возвращается обычная MCP-ошибка валидации.

## Операции

К каждой операции добавляется обязательное поле `request`. Точные обязательные поля и defaults определяются JSON Schema; таблица — навигация, не альтернативная спецификация.

| Операция | Дополнительный вход | Работа и результат |
|---|---|---|
| get_capabilities | — | Профиль, операции, принадлежность engine, пути схем и режим выполнения |
| list_lenses | query?, limit? | До 10 применимых включённых линз с источниками |
| get_lens | lens_id | Одна включённая линза и её provenance |
| analyze_concept | concept, mechanics? | Цели автора, наличие формальной модели, проверки переданных механик |
| analyze_mechanic | mechanic, prior_analysis? | Правила, действия, состояния, обратная связь, варианты и пересмотр |
| analyze_game_loop | steps | Ссылки, доступность шагов из первого шага, пропуски state_change/feedback |
| evaluate_player_agency | mechanic | Формальные альтернативы и доминирование в одной заданной паре cost/benefit |
| analyze_progression | learning | Предпосылки, порядок, практика и вариации задач |
| analyze_balance | model | Детерминированная ресурсная модель с seed и явными инвариантами |
| evaluate_systems | graph | Потенциальные feedback components и ограниченные цепочки взаимодействий |
| review_gdd | sections | Покрытие тем по переданной классификации разделов; без смысловой проверки прозы |
| generate_alternatives | mechanic, allowed_changes? | Базовая спецификация и варианты feedback/contextual_choice/automation |
| formulate_playtest | hypothesis, participants, metrics, interpretation, method?, conditions? | Проверяемый план, ссылки на совпавшие прошлые вопросы |
| evaluate_playtest | data_origin, observations, criteria?, prior_analysis? | Описательная статистика и проверка порогов по связанным гипотезам |
| compare_designs | designs | Сравнение структурных свойств, без сводного «качества игры» |
| publish_analysis | analysis, commit? | Preview либо публикация через разрешённый хостом адаптер |

`allowed_changes` — разрешение рассмотреть изменение, а не разрешение записать его в проект. Варианты содержат редактируемый `mechanic`, но требуют уточнения условий, последствий и проверки соответствия авторскому замыслу. Новая LLM-инфраструктура не создаётся: алгоритмы дают ограниченные проверки и конструктивные преобразования; творческую интерпретацию выполняет агент.

## MCP

После `initialize` и `notifications/initialized` клиент может вызвать:

```json
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "get_capabilities",
    "arguments": {
      "request": {
        "api_version": "1.0", "request_id": "request.discovery",
        "project_id": "project.demo", "task_id": "task.design",
        "timestamp": "2026-10-19T09:00:00Z", "status": "submitted",
        "artifact_refs": [], "evidence": [],
        "context": { "subject": "Новая механика", "author_goals": ["Осмысленное планирование"] }
      }
    }
  }
}
```

Для `analyze_mechanic` передайте тот же envelope в `request` и объект `mechanic` по существующей [Mechanic schema](../schemas/Mechanic.schema.json). Новый API отдаёт FIP-результат непосредственно в `structuredContent`; прежние операции сохраняют wrapper `{schema_version, operation, result}`. Человекочитаемый Markdown находится в поле `markdown` аналитического результата. Исполняемый пример SDK: `node examples/world-forge/mcp-client.mjs`.

## Доказательства и надёжность

Анализ содержит Context, Lenses, Findings, Problems, Recommendations, Alternatives, Hypotheses, Validation, Evidence, Confidence в полях `context`, `lenses`, `findings`, `problems`, `recommendations`, `alternatives`, `hypotheses`, `validation`, `evidence`, `confidence`. Существенные findings/problems имеют собственную качественную confidence и ссылки evidence_ids; рекомендации — confidence, последствия и компромиссы. Числовой вероятности или индекса удовольствия нет.

`data_origin` обязателен при оценке тестов: `human_playtest`, `simulation`, `engineering_test`. Первое означает заявленные данные людей, а не независимую аутентификацию участников. Для остальных число человеческих участников равно 0. Порог проверяется только на measurement-строках с одновременно совпавшими `metric` и `hypothesis`. Статусы descriptively_supported/contradicted описательные; исходная гипотеза остаётся DESIGN_HYPOTHESIS. Средние повторных строк не доказывают причинность или статистическую значимость.

## Ограничения выполнения

Новые операции выполняются синхронно с лимитами: JSON-запрос до 2 MiB; loop до 100 шагов; learning до 500 навыков; graph до 200 узлов/1000 рёбер; simulation до 500 шагов и 50000 применений процессов; observations до 2000; сравнение до 10 спецификаций. Детальные размеры строк и коллекций заданы схемами. Ошибка лимита контролируема; длительные задания и job API не заявлены. Если появятся тяжёлые операции, их нельзя прятать за этим контрактом bounded_sync: потребуется отдельная версия capability с job_id/status/result и отменой.

Сетевых запросов по источникам/URI нет. Исторический адаптер необязателен; его операции ограничены timeout 1..10000 ms (по умолчанию 1000). Новые агентные операции используют встроенный реестр либо явно переданный `knowledge: KnowledgeRegistry`; расширенный реестр проекта можно передать хостом. Настройки источников нового API передаются через `request.context`; они не подменяются неявно настройками другого проекта.

## Целостность итераций в 0.5.0

- ID относится к неизменяемой записи. Полностью совпадающие записи при объединении принимаются; конфликтующие доказательства, артефакты и гипотезы отклоняются.
- Ссылки evidence → artifact, findings/recommendations → evidence и recommendations/experiments → hypotheses проверяются в runtime дополнительно к JSON Schema. Схема проверяет форму, код — отношения между записями.
- При переносе анализа сохраняются прежние артефакты и определения гипотез. Изменившийся контекст/спецификация получает новую автоматически сформированную гипотезу. У эксперимента ID учитывает метод, условия, метрики и интерпретацию.
- Доказательства знаний учитывают содержимое и версии, поэтому обновлённая привязка к источнику сосуществует со старой.
- Ограничения 100 артефактов / 200 доказательств / 100 гипотез проверяются явно. При превышении разбейте задачу или передайте меньший набор; связанные записи не отбрасываются молча.
- Если передан `prior_analysis`, критерии оценки обязаны ссылаться на объявленные в нём гипотезы. В самостоятельной `evaluate_playtest` идентификаторы критериев могут быть внешними: их определения не выдумываются и не включаются автоматически в рекомендации.
- Несколько критериев одной гипотезы соединяются условием «все»: измеренное нарушение даёт contradicted; при отсутствии нарушений и нехватке данных — inconclusive; все связанные измерения прошли — supported. Это описательная оценка средних строк, не проверка причинности.
- Некорректная или конфликтующая история Chronicler отбрасывается с объяснением; локальная работа продолжается с `status: partial`.

Markdown-отчёт включает авторские цели, компромиссы, критерии, происхождение измерений, ссылки и ограничения. Импортированная разметка выводится как текст. При достижении лимита отображения отчёт содержит явное уведомление; структурированный JSON остаётся источником полного результата.
