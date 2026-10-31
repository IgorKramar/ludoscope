# Состояние реализации

Версия **0.5.0**, 2026-10-31. Полная приёмка 1.0 ещё не закрыта. [Проверки](../TESTING.md) и [ограничения](../LIMITATIONS.md) описывают фактический объём.

| Фаза | Реализовано | Осталось |
| :--- | :--- | :--- |
| Research & Architecture | Официальные спецификации, SDK, ADR, лицензии | Матрица версий Codex и платформ |
| Vertical Slice | Init, context, knowledge, mechanic, report, decision, reopen; новый isolated demo | Реальный игровой пилот |
| Knowledge | Реестр 1.1, 19 источников, 208 записей, страницы и provenance, поиск/get/импорт | Глубокое покрытие остальных школ |
| Design Reasoning | Структурные проверки, graph impact, версии артефактов, целостность ссылок | Semantic code audit и адресные патчи GDD |
| Systems | Ресурсная модель, FSM, seed, инварианты, Monte Carlo, sensitivity | Общие discrete-event/ABM, jobs/cancellation |
| Experience & Narrative | Learning graph, UX/game feel workflow, Boolean narrative, PCG samples | Реальные исследования и развитые модели |
| Research & Testing | Эксперименты, CSV/JSON, совместные критерии, CI Node 22/24, регрессии | Независимая оценка Skills и плейтесты |
| Integration & Release | 17 Skills, 40 MCP tools, CLI, 30 шаблонов, 4 demo contexts, FIP API, отчёты | Полная локализация, engine adapters и 1.0 |

WORLD FORGE: 16 агентных операций дополняют 24 прежних. FIP предварительный, ChroniclerAdapter является портом; официальный внешний сервис не подключён. HTTP и async jobs отсутствуют.

Новый demo runner передаёт реальные модельные данные через анализ → эксперимент → оценку → пересмотр с сохранением project/task IDs. Он создаёт preview публикации и не отправляет данные в Chronicler.

Авторские решения не перезаписываются. Гипотеза автоматически не становится фактом. Дальнейшие действия: [ROADMAP.md](../ROADMAP.md).
