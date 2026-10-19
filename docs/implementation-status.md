# Состояние реализации

Версия 0.3.0, 2026-10-19. Критерии полной1.0 ещё не закрыты. Это перечень фактических возможностей, а не обещание готовности будущих подсистем.

| Фаза ТЗ | Реализовано и проверено | Осталось |
|---|---|---|
|0 Research & Architecture | Официальные спецификации, SDK, ADR, лицензии | Матрица других версий Codex/платформ |
|1 Vertical Slice | Установка CLI Codex,init,context,knowledge,mechanic,report,decision,reopen | UI и реальные рабочие проекты |
|2 Knowledge | Реестр 1.1,19 source/208 entry,страницы и provenance,поиск/get,импорт,контекстные линзы | Глубокое подтверждённое покрытие всех школ |
|3 Design Reasoning | Findings,структурные проверки,graph impact,версии артефактов,backup graph | Семантический code audit,адресные документационные patches |
|4 Systems | Ресурсная модель,FSM,seed,invariants,Monte Carlo,sensitivity,gain witnesses | Общие discrete-event/ABM,асинхронное прерывание |
|5 Experience & Narrative | Learning graph,UX/game feel workflows,Boolean narrative,PCG samples,SCC chains | Исследования пользователей,visual artifacts,продвинутые модели |
|6 Research & Testing | Experiment schema,CSV/JSON,descriptive observations,49 тестов,AI рубрики | Реальные плейтесты и независимая оценка |
|7 Integration & Release |17 Skills,24 tools,CLI,30 шаблонов,4 demo,MIT,упаковка | Полная локализация,движковые адаптеры и release1.0 |

Approved decisions не перезаписываются. Project context хранит требования и canon отдельно; версии механик/гипотез/экспериментов/плейтестов/GDD индексируются по путям. Самостоятельного незаметного обновления кода игры или авторского канона нет.

Точные ограничения и план: LIMITATIONS.md и ROADMAP.md. Результаты проверок: verification.md и demo-result.json.
