---
id: ADR-CHRONICLE-001
status: Accepted
links_to: [SPEC-CHRONICLE-001, PLAN-CHRONICLE-001]
---
# Optional HTTP/FIP adapter в Ludoscope

## Контекст
ADR-006 уже отделяет ChroniclerAdapter от ядра. Chronicle FIP v1 опубликован и достаточен; Ludoscope draft FIP имеет другую форму. Нельзя переслать analysis как AgentEvent без преобразования. Секреты/размещение — ответственность хоста.

## Альтернативы
1. Сохранить агентскую передачу: минимум кода, но нет проверяемой программной связи; не выполняет текущий запрос.
2. TypeScript HTTP adapter: небольшая отдельная граница, переносима, использует AbortSignal; требует явной валидации/projection и идемпотентного retry.
3. Мост к Python FipClient: готовая durable outbox, но вводит Python/runtime/subprocess в TypeScript host и усложняет распространение.

## Решение
Выбран вариант2 в рамках явно порученной реализации: optional HTTP adapter + host configuration. Публичные FIP v1 формы не меняются. Используем существующие project/history/record/write endpoints. Для доставки анализа сохраняем deterministic body/key, подтверждаем только настоящий ACK. Фоновую durable доставку пользовательских session reports обеспечивает существующий Chronicle worker; адаптер не становится новым оркестратором. После неопределённого timeout пользователь/агент повторяет тот же сохранённый анализ; changed body конфликтует.

## Последствия и границы
Не обещается exactly-once delivery, semantic search или автоматическое принятие решений. Бounded история при превышении бюджета становится partial. Если потребуется unattended очередь именно анализов, добавить отдельный явно спроектированный outbox. Секреты/host endpoint/project mappings/Notion IDs никогда не входят в публичный source.
