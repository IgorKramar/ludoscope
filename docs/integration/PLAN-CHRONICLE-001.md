---
id: PLAN-CHRONICLE-001
status: in_progress
links_to: [SPEC-CHRONICLE-001, ADR-CHRONICLE-001]
---
# CE: внедрение адаптера Chronicle

Основание: SPEC-CHRONICLE-001 и ADR-CHRONICLE-001. Новый brainstorm не требуется. Исследование: src/integration/chronicler.ts, api.ts; Chronicle docs/API.md, contracts/fip/v1, memory_service.py, fip_routes.py. API version1.0 Ludoscope и v1 Chronicle не смешиваются.

1. Добавить scoped HTTP client и validation/projection для ChroniclerAdapter. Проверить actor/project binding, pagination, revisions, request/response budget, HTTPS/redirect/AbortSignal.
2. Добавить optional standalone host config, export API и безопасный default deny. Secret env только конфигурация хоста.
3. Покрыть meaningful contract/security/regression cases. Передача Proposed/Accepted/Rejected различается; искусственный Passed запрещён.
4. Реальный loopback Collector без Notion: accepted/rejected history → Ludoscope analysis → authorized commit → receipt → independent HTTP read. Проверить retry/lost ACK/conflict/cross-project denial.
5. Обновить CHRONICLER_INTEGRATION/LIMITATIONS/version manifests согласованно, выполнить npm run check.
6. CE code review по корректности/отказам, затем architect review только по ADR/границам. Исправить найденные дефекты, не ослабляя проверку.
7. Push feature branch в IgorKramar/ludoscope и проверить remote SHA. Установить проверенную сборку; host/Collector/Notion конфигурация — приватный kramar-codex-environment.

Откат: выключить optional Chronicle host config и вернуться к исходной сборке; проектные артефакты и Chronicle history не удалять. Запуск ещё не результат: фиксировать exit codes и реальные квитанции.
