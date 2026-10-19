# Проверка LUDOSCOPE 0.4.0 — 2026-10-19

- `npm run check`: TypeScript/JSON Schema собраны; **74/74 теста, 5 файлов**. Прежние сценарии сохранены. Проверены 17 Skills, 30 document templates, официальные Agent Plugins manifests.
- MCP: 24 прежних + 16 новых инструментов, всего 40. Каждый новый инструмент имеет строгие схемы. Все 16 корректных payload/result проверены и Zod, и опубликованной JSON Schema через Ajv; неизвестные поля отклонены. Входные схемы генерируются в input-mode, корректно сохраняя необязательность default-полей.
- Реальный MCP SDK Client через парные transports проверил discovery, вызов анализа, неверные аргументы и сохранение project/task/request в типизированной ошибке превышения бюджета.
- Новый test suite проверил отсутствие/ошибку/timeout/чужой проект Chronicler, запрет неавторизованной записи, preview без вызова publish, историю решений/отклонений/совпавших вопросов, разделение human_playtest/simulation/engineering_test, связывание критериев по hypothesis + metric и сквозной цикл пересмотра.
- `node examples/world-forge/workflow.mjs` реально выполнен: 3 кандидата, синтетический инженерный критерий descriptively_contradicted, пересмотр рекомендации, preview без записи, затем одна разрешённая публикация в in-memory adapter. project_id=demo.forge, task_id=task.hunger сохранены. [Краткий trace](world-forge-demo-run.json).
- `node examples/world-forge/mcp-client.mjs` запустил настоящий stdio-сервер: 16 агентных capabilities, анализ вернул 3 альтернативы, project/task IDs и partial из-за отсутствия истории.
- npm-пакет 0.4.0 установлен в отдельный prefix: CLI вернул 0.4.0. Codex CLI 0.159.2 установил плагин в изолированный CODEX_HOME. Установленный сервер перечислил 40 инструментов, выполнил старые knowledge/mastery/tycoon сценарии и новые get_capabilities/analyze_concept с сохранением идентификаторов. final.money контрольной модели=20.
- `npm audit --json`: 0 известных уязвимостей на момент проверки, новых зависимостей нет. Package regression не допускает исходные книги/OCR/приватные mapping-файлы.

Пределы результата: FIP предварительный (`ludoscope.fip-v1-draft.1`); публичный npm не нашёл fip-contracts, частный пакет не проверен. Реальный официальный Chronicler и весь WORLD FORGE не запускались. Тестовая публикация не является удалённой записью; синтетические инженерные данные не являются реальным плейтестом. HTTP и async jobs не реализованы; вычисления bounded_sync.

Воспроизведение: `npm ci --ignore-scripts && npm run check`, затем два примера из examples/world-forge. Полные ограничения: [LIMITATIONS.md](../LIMITATIONS.md).
