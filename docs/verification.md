# Проверки0.1.0 — 2026-10-18

Окружение: Linux,Node24.19.0,npm11.9.0,Codex CLI0.159.2. Версии зависимостей фиксирует package-lock.json.

- `npm run check`: TypeScript+JSON Schema build успешен; Vitest5.0.5 —34/34 теста,2 файла,3.66s; официальный Agent Plugins1.0.0 manifest/mcp schema validation успешен;17 Skills и23 пары input/output schema;30 шаблонов прошли Document schema.
- `npm audit --json`:0 info/low/moderate/high/critical на момент проверки. Обновлены csv-parse7.0.3 и Vitest5.0.5 после обнаруженных advisories. Это снимок базы уязвимостей, а не гарантия отсутствия всех дефектов.
- `codex plugin marketplace add /workspace/ludoscope --json`, затем `codex plugin add ludoscope@ludoscope-local --json` с отдельным CODEX_HOME: успешно. `plugin list --json` показывает installed=true,enabled=true. Пользовательская основная конфигурация не менялась.
- `scripts/smoke-installed.mjs <cache-path>` проверяет MCP из фактически установленной копии:23 tools,project_context и economy simulation; tycoon final.money=20.
- Сквозная демонстрация init→scan→graph preview/hash/commit→mechanic version→analyse by ID→report→simulation→decision preview/commit→reopen→validate выполнена отдельными CLI-процессами. Числовой итог и путь к отчёту: demo-result.json.
- npm-пакет установлен в отдельный prefix; его исполняемый `ludoscope doctor` вернул16 источников/49 записей,network_required=false.

Автотесты включают реальный SDK client/server,stdio,все корректные/некорректные MCP-инструменты,immutable records,symlink/traversal,stale preview/backup,determinism,budgets,playtest participant counts,knowledge provenance и импорт с отказом публикации дубликата.

Реальные игроки не участвовали; desktop UI,LLM-качество и независимая экспертная оценка не проверялись. Рубрики docs/ai-evaluations.json и tests/fixtures/ai-evaluation.json не являются результатами оценки.

Дополнительно проверен SHA-256 исходных байтов файла с невалидным UTF-8; scanner не хеширует перекодированный текст. File reader ограничивает чтение буфером и отклоняет изменение размера в процессе. Суммарный контекст решений ограничен20MiB.

Актуальное углубление базы и проверки версии 0.2.0: [verification-0.2.0.md](verification-0.2.0.md). Исторические результаты 0.1.0 выше сохранены как фактически выполненный этап.

Проверки текущей версии 0.3.0: [verification-0.3.0.md](verification-0.3.0.md).

Текущий агентный API и проверки 0.4.0: [verification-0.4.0.md](verification-0.4.0.md).
