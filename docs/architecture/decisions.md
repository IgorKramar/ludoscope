# Architecture Decision Records

## ADR-001 — переносимый пакет, 2026-10-18, принято
Проблема: ТЗ зависит от меняющегося формата Codex. Проверены официальные guides plugins/skills/mcp-server и корневые JSON Schema Agent Plugins 1.0.0. Выбран корневой plugin.json + mcp.json + skills/. Старый README openai/plugins ещё описывает .codex-plugin; текущая документация считает его fallback. Не дублируем manifests. Пересмотр: изменение официальной схемы или несовместимость проверенного клиента.

## ADR-002 — вычисления, а не вторая LLM, принято
Core — чистые/ограниченные TypeScript-функции, Zod 4, SDK MCP 1.x, CLI commander. Codex формирует творческие альтернативы и связывает контекст. Никаких облачных зависимостей в runtime. JSON вместо SQLite: текущий набор мал; индекс создаётся лениво в памяти. Последствие: полнотекстовый поиск лексический, масштаб больших библиотек ограничен.

## ADR-003 — проектная запись только по намерению, принято
Анализ возвращает данные. init создаёт память, decision без --commit возвращает diff; commit создаёт неизменяемую запись. Атомарная публикация через hard link временного файла не заменяет существующее имя. Отклоняем traversal и символические ссылки. Не предполагаем враждебный процесс того же пользователя, меняющий каталоги одновременно; см. LIMITATIONS.

## ADR-004 — модель ограничена заданными правилами, принято
Базовый Systems Lab: дискретные ресурсные процессы с вероятностями, последовательность важна. Seed и полные параметры включены в результат. Поиск ресурсных циклов ограничен четырьмя применениями; это свидетельства потенциального роста, не доказательство бесконечной прибыли или интереса. FSM и Boolean narrative имеют отдельные контракты.

## ADR-005 — проверяемое происхождение, принято
Источники с недоступным содержанием остаются SOURCE_REQUIRED; библиографическая проверка не доказывает теорию. Оригинальные исследовательские методы — EXPERT_INFERENCE. Связанные знания могут образовывать циклы, Requires/DependsOn в design graph — нет. Утверждённые решения физически отделены от знаний.

## Проверенные технические источники
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/skills
- https://developers.openai.com/plugins/build/mcp-server
- https://github.com/openai/plugins
- https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
- https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
- https://github.com/modelcontextprotocol/typescript-sdk

Копии официальных JSON Schema сохранены в schemas/agent-*.schema.json; полные веб-страницы и книги в пакет не включены.
