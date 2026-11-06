---
id: SPEC-CHRONICLE-001
status: active
links_to: [ADR-CHRONICLE-001, PLAN-CHRONICLE-001]
---
# Живой адаптер Codex Chronicle

Поручение владельца 2026-11-06: подключить Ludoscope к Chronicle, реализовать и проверить адаптер, отправить код в репозиторий. Согласован экспорт безопасных отчётов всех проектов этого пользователя; локальные секреты и установка сервисов находятся вне публичного репозитория.

## Требования и приёмка
- Необязательный TypeScript ChroniclerAdapter использует опубликованный HTTP FIP v1; прямого доступа к SQL/Notion нет.
- До анализа проверяет capabilities, доступ к project_id, схемы ответов, актуальные revision-цепочки. Неполная/недоступная история обозначается partial, а не «решений нет».
- Accepted решения, Rejected выборы и завершённые эксперименты сохраняют своё значение. Hypothesis/Proposed не превращаются в доказательство.
- Публикация только commit:true + явная host authorization, scoped trusted actor/project; default deny остаётся.
- Стабильный idempotency key на project+analysis_id; одинаковый retry даёт тот же receipt, изменённое содержимое с тем же ID конфликтует. До ACK receipt не возвращается.
- Ограниченные ответы/страницы/таймауты; AbortSignal, запрет redirect с credential, HTTPS default и explicit loopback только для теста/локального сервера.
- Полный анализ остаётся проектным артефактом; Chronicle получает ограниченную явную projection без full prompts/source/stdout. Технический тест Passed не выдумывается.
- Standalone MCP может подключить адаптер через доверенную host config; без конфигурации прежнее поведение сохраняется. Один project root глобально не закрепляется.
- Реальный loopback Collector проверяет чтение истории, публикацию, отдельное повторное чтение, запрет чужого проекта и повтор после потерянного ACK. npm run check проходит.
