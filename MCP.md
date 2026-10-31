# MCP API 1.0

Локальный stdio-сервер на официальном @modelcontextprotocol/sdk. Запуск: `node dist/mcp/index.js`. stdout зарезервирован протоколом. Корень определяется LUDOSCOPE_PROJECT_ROOT или cwd при старте; инструменты не принимают произвольный root. Данные не отправляются в сеть.

Ниже описаны 25 операций ядра; новый агентный контракт — в разделе «Агентный API 0.4.0». Каждый input/output строго проверяется Zod. JSON Schema: `schemas/tools/<name>.input.json` и `<name>.output.json`. Успех: `{schema_version:"1.0",operation:<name>,result:<typed result>}`. Ошибка: isError=true и текст JSON `{error:{code,message}}`; ошибки аргументов SDK могут возвращаться до обработчика. Типы данных экспортируются TypeScript-библиотекой.

| Инструмент | Назначение | Доступ |
|---|---|---|
| ludoscope_check_traceability | Проверка объявленных связей, SHA-256 файлов и ревизии; не запускает код и тесты. | read-only |
| ludoscope_knowledge_get | Load specific knowledge entries and source provenance by stable IDs without retrieving full books. Respects disabled sources/schools. | read-only |
| ludoscope_record_artifact | Preview or explicitly commit a versioned mechanic, hypothesis, experiment, playtest or GDD document. Existing versions are immutable. | preview; explicit commit writes |
| ludoscope_update_graph | Preview graph replacement; explicit commit requires reviewed expected_sha256 and creates an immutable backup. | preview; explicit commit writes |
| ludoscope_analyse_systems | Feedback components and bounded interaction chains; not causal proof. | read-only |
| ludoscope_project_scan | Bounded read-only file inventory with fingerprints; no mechanics inferred. | read-only |
| ludoscope_project_context | Read project profile, vision, graph and immutable decisions. | read-only |
| ludoscope_knowledge_search | Offline full-text and metadata search; source-required entries excluded. | read-only |
| ludoscope_get_lenses | Select original lenses by query, tags, genre and stage; bind questions to named system. | read-only |
| ludoscope_analyse_mechanic | Structured mechanic checks and relevant knowledge for Codex reasoning. | read-only |
| ludoscope_analyse_dependencies | Conservative dependency impact and Mermaid export. | read-only |
| ludoscope_validate_rules | Finite state reachability, deadlocks and ambiguous actions. | read-only |
| ludoscope_analyse_economy | Resource rates, free sources and bounded nonnegative conversion witnesses. | read-only |
| ludoscope_simulate_system | Seeded bounded discrete resource simulation. | read-only |
| ludoscope_compare_variants | Compare fixed-seed model variants or seeded Monte Carlo summaries. | read-only |
| ludoscope_design_experiment | Validate a draft experiment and expose limitations. | read-only |
| ludoscope_evaluate_playtest | Describe real supplied observations, measurements and subjective feedback separately. | read-only |
| ludoscope_generate_report | Render a mechanic report or versioned GDD document; returns text without writing. | read-only |
| ludoscope_check_consistency | Validate local project graph and immutable decisions; no inferred code equivalence. | read-only |
| ludoscope_record_decision | Preview an immutable approved decision. commit=true writes only within .ludoscope/decisions. | preview; explicit commit writes |
| ludoscope_mastery_analysis | Check explicit learning prerequisites and practice opportunities. | read-only |
| ludoscope_ux_review | Artifact inventory and cognitive UX / game feel review prompts. | read-only |
| ludoscope_narrative_consistency | Explore bounded Boolean world states and test explicit canon invariants. | read-only |
| ludoscope_procedural_review | Descriptive distribution and validity checks of supplied generator samples. | read-only |
| ludoscope_sensitivity_analysis | Vary one process output multiplier with fixed seed. | read-only |

## Вызовы

`ludoscope_project_context({})` читает память; сначала инициализируйте проект через CLI.

`ludoscope_knowledge_search({"query":"meaningful choice","limit":5})` ищет самостоятельно сформулированные записи. SOURCE_REQUIRED исключён; отключённые источники и школы берутся из project.yaml. Поиск может работать до init.

Для механики используйте `ludoscope_analyse_mechanic({"mechanic": <Mechanic JSON>})`; пример корректного значения: examples/survival/mechanic.json. Ответ содержит исходную спецификацию, findings со всеми полями Claim, релевантные знания, зависимости и задачи для Codex. Не означает, что отдельная LLM уже создала альтернативы.

`ludoscope_simulate_system({"model": <Model JSON>})` возвращает MODEL_RESULT, полную модель и seed. `ludoscope_compare_variants({"models":[<Model>],"seeds":[1,2,3]})` — описательный Monte Carlo.

`ludoscope_record_decision({"decision": <Decision JSON>})` возвращает preview/diff. Только явный `commit:true` создаёт .ludoscope/decisions/<id>.json, не заменяя существующий файл. Пример решения: tests/fixtures/decision.json. Имя инструмента не означает утверждение за пользователя.

Аналитические инструменты имеют annotations readOnlyHint=true, destructiveHint=false, openWorldHint=false. record_decision имеет readOnlyHint=false, поскольку commit может записывать. Аннотации не заменяют серверную защиту. Запись кода игры, удаление, исполнение знаний и внешние запросы не поддерживаются.

Ресурсные лимиты определены в schemas и SIMULATION.md. Некоторые операции требуют .ludoscope/project.yaml; ENOENT — контролируемая ошибка. Результаты SQL, реальных плейтестов и недоступного кода не выдумываются.

## Происхождение знаний и контекст линз

`ludoscope_knowledge_get({"ids":["knowledge.schell.meaningful_alternatives","source.sylvester_ru_2020"],"include_sources":true})` возвращает entries, sources и missing_ids. У новых записей evidence содержит точные PDF-страницы и область утверждения; provenance источника задаёт hash и ограниченное проверенное покрытие. Файлы книг не передаются. include_sources=false отключает автоматическую подгрузку связанных библиографий; явно запрошенный source ID по-прежнему возвращает его метаданные.

knowledge_search и get_lenses поддерживают mode и system_types. Поиск добавляет слова запроса к тематическим признакам, но не выводит тип системы из имени файла. Требование procedural/narrative в selection требует явного типа системы. get_lenses возвращает bound_questions и relevance: matched_tags, matched_system_types, reasons. Это причины выбора вопроса, не научная оценка и не прогноз интереса.

record_artifact и update_graph работают как прежде: preview по умолчанию, commit по явному намерению. Предыдущее состояние графа сохраняется; stale hash отклоняется. Новые знания не меняют утверждённые проектные решения автоматически.

## Mastery Analysis в 0.3

Вход skills/requires/introduced_at/practice/variation сохранён. Результат содержит прежние structural issues и limitations, а также до6 связанных knowledge entries, research_questions и evidence_scope=structural_plan_only. Claim остаётся EXPERT_INFERENCE. Присутствие VERIFIED_SOURCE среди оснований не означает, что человек освоил навык. Источники и школы, отключённые в проекте, не включаются в контекст. Инструмент работает и без project profile, с mode=design.


## Агентный API 0.4.0

Дополнительно зарегистрированы 16 агентных операций: get_capabilities, list_lenses, get_lens, analyze_concept, analyze_mechanic, analyze_game_loop, evaluate_player_agency, analyze_progression, analyze_balance, evaluate_systems, review_gdd, generate_alternatives, formulate_playtest, evaluate_playtest, compare_designs, publish_analysis. Всего 40 инструментов. Они используют самостоятельный предварительный FIP envelope; wrapper старых 24 операций сохранён. Схемы — contracts/fip/v1/operations. Полное описание и MCP-вызов: [docs/API.md](docs/API.md). Текущий standalone сервер не подключает Chronicler; это дополнительная возможность встраиваемого сервера/API.

## Трассировка 0.6.0

`ludoscope_check_traceability({"manifest": <TraceabilityManifest>})` возвращает строгий `TraceabilityReport` внутри обычного wrapper. Работает до init; файлы читаются только из корня сервера. [Контракт, CLI и ограничения](docs/TRACEABILITY.md).
