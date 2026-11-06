# Проверка optional Chronicle HTTP adapter 0.7.0

2026-11-06, Linux, отдельный checkout Ludoscope на базе `2c2b999` и Codex Chronicle `b24554048dcef4edf3e3c70bd42ba3cb5efb434b`. Это наблюдаемые результаты изолированной проверки; пользовательский deployment, Notion и редактор игры не проверялись этим прогоном.

- `npm ci --ignore-scripts`: dependencies установлены, audit 0 vulnerabilities.
- Первичный тест до реализации: missing module `src/integration/chronicle-http.js`.
- Отдельная поведенческая регрессия до исправления: тест «does not accept a confirmed decision without primary evidence» падал, потому что malformed Accepted попадал в историю. После проверки evidence тест проходит.
- `npm run check`: exit0, **124 tests /12 files**, включая13 новых HTTP contract tests. Сборка, package/schema checks,30 templates,17 skills,41 MCP tools и version consistency0.7.0 прошли.
- `git diff --check`: exit0.
- Настоящий `scripts/chronicle-live-smoke.py`: exit0. Изолированный Collector + ephemeral loopback HTTP, без Notion, synthetic grants. Чтение1 принятого решения,1 актуального отвергнутого решения,1 результата синтетической симуляции; настоящий Ludoscope analysis использовал историю.
- Proxy потерял ACK **после принятия записи**. Новый adapter повторил тот же сохранённый analysis, concurrent retries вернули ту же квитанцию; HTTP history содержал ровно1 `ludoscope.analysis`. Изменённый body с тем же analysis ID получил409. Независимый read-only reader разрешил receipt и проверил record/status/proposed knowledge/пустой test_results.
- Чужой project получил404. Read-only grant не публикует, write-only grant не читает историю. Contract tests отдельно покрывают несовместимые capabilities, неполные revision-цепочки, повтор cursor, позитивную pagination, immutable artifact revision, actor/project mismatch, неправильный ACK, redirect без пересылки bearer, stream size и stalled-body timeout.

Сводка получена из реально завершённых команд, а не по факту запуска. Команды восстановления тестового окружения и ограничения описаны в [CHRONICLER_INTEGRATION.md](CHRONICLER_INTEGRATION.md). Полный проектный анализ не публикуется автоматически; transport не является универсальным фильтром секретов в произвольных claims.

## Исправления после инженерного ревью

Полное CE review:9 локальных направлений,2 P2; оба устранены и независимо перепроверены. Cross-model corroboration отсутствует: доступные Claude/Grok review routes требовали авторизации; использована локальная adversarial-проверка.

- Regression с пустым Proposed сначала завершилась exit1 (Zod too_small). После согласования входной схемы с публичным FIP v1 проходит; latest Proposed не воскрешает прежний Accepted, пустой непроецируемый rationale Accepted не ломает историю.
- Полностью настроенный host проверен через реальный AgentApi и HTTP fixture: PUBLISH отсутствует/false → denied и0 POST; foreign project/actor → denied и0 POST; preview →0 POST; explicit true+совпадающая привязка → published.
- Повторный `npm run check`:124 passed; независимая целевая перепроверка:2 passed. Повторный реальный Collector smoke: passed, lost-ACK/concurrent retries deduplicated, changed body409, чужой project404, независимое чтение записи успешно.

## Проверка architect: ADR-CHRONICLE-001

Итог: архитектурных блокеров нет. ChroniclerAdapter остаётся портом домена; HTTP/FIP projection находится в integration/chronicle-http.ts, trusted host policy — в chronicle-host.ts, композиция — в MCP entry point. Ядро анализа не зависит от Collector, Infisical, Notion или SQL. Новых runtime-зависимостей не добавлено. Офлайн-режим сохранён; partial и timeout отражены явно; публикация требует отдельного разрешения и настоящего ACK.

Неблокирующие предложения: нет. Открытые архитектурные вопросы: нет в пределах согласованного ADR. Полный локальный анализ и повтор после неизвестного ACK остаются ответственностью вызывающего хоста; durable outbox для анализов не заявлен. Удачное решение: host deployment не попадает в переносимый публичный пакет.
