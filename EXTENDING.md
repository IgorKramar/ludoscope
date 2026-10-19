# Расширение

Контракт расширений — API 1.0, TypeScript interfaces в `src/core/extensions.ts`: KnowledgeProvider, EngineAdapter, AnalysisRule, ReportRenderer, DataImporter, ExternalResearchProvider и UniversalModderAdapter. RetrievalProvider и SimulationProvider находятся рядом с реализациями. Это библиотеки для явного подключения разработчиком, а не автоматический запуск произвольного пакета из project.yaml.

Добавление знания: JSON Schema `RegistrySchema.schema.json`, уникальные namespaced ID, version>=1, sources/entries. Укажите конкретное издание, URL, лицензию, доступность, статус, локатор проверенного фрагмента. Оригинальная методика/интерпретация получает EXPERT_INFERENCE. SOURCE_REQUIRED не попадает в поиск. Подтверждённое содержание требует проверенных source IDs; одна библиографическая карточка не подтверждает пересказ.

Импорт разрешённого пакета, находящегося внутри игрового проекта:

```sh
ludoscope knowledge import notes.json --license 'CC-BY-4.0; permission supplied by author' --allow-redistribution
ludoscope knowledge import notes.json --license 'CC-BY-4.0; permission supplied by author' --allow-redistribution --commit
```

Первый вызов — preview, второй создаёт `.ludoscope/knowledge/notes.registry.json` и permission sidecar. Поиск учитывает этот пакет. Автоматически оценить юридическое право программа не может. Импортируемый пакет должен быть самодостаточным по ссылкам, а при объединении не конфликтовать с встроенными ID. Данные остаются недоверенными; команда/код в текстовом поле не исполняются.

Новая модель: реализуйте SimulationProvider с явной схемой, seed, бюджетом, инвариантами и тестом воспроизводимости. Новое правило: добавьте input и result Zod-схемы, зарегистрируйте операцию, проверьте корректный/некорректный MCP-вызов, обновите docs. `npm run build` регенерирует JSON Schema.

Адаптер движка должен ссылаться на файлы и ревизию. Нельзя извлекать игровое поведение только из названия класса. Universal Modder не имеет реализованного адаптера: сначала нужен проверенный реальный API.

Новая версия несовместимой схемы требует явной миграции и backup. Проектные схемы остаются 1.0; реестр знаний 1.1 принимает прежние пакеты 1.0. Автоматических миграций несовместимых форматов ещё нет; неподдерживаемая версия отклоняется.

## Проектные артефакты

`ludoscope artifact artifact.json` показывает diff; `--commit` создаёт новую неизменяемую версию. Схема обёртки — Artifact.schema.json, поля kind/id/version/data. ID внутри mechanic/experiment/document должен совпадать с ID обёртки; версия document также совпадает. Гипотезы сохраняются только как DESIGN_HYPOTHESIS.

`ludoscope graph graph.json` показывает diff и expected_sha256. Для явного применения передайте `--commit --expected-sha256 <reviewed-hash>`. Предыдущее состояние сохраняется в `.ludoscope/history/`; после изменения исходного файла preview становится устаревшим.

30 двуязычных шаблонов в templates/ru и templates/en можно копировать и заполнять, затем проверять/рендерить через `ludoscope document document.json`.

Для источника предоставленного PDF используйте provenance с SHA-256, pdf_pages, verified_pdf_pages, content_verified и режимом metadata_and_original_analysis_only. Entry.evidence ссылается только на проверенные страницы. VERIFIED_SOURCE допускает author_position; derived_method/cross_source_inference должны оставаться EXPERT_INFERENCE. Проверка копии и длинных буквальных совпадений доступна через scripts/verify-source-evidence.mjs; полноценная редакционная проверка остаётся отдельной работой.

Контекстная линза может задавать selection.any_tags/all_tags/excluded_tags/required_system_types/modes. Эти предварительные условия проверяются до ранжирования. Если нужен просмотр точного ID без выбора по условиям, используйте knowledge_get; отключённые источники/школы при этом сохраняются. Не добавляйте жанровые ограничения только ради продвижения своей записи в поиске.


WORLD FORGE: `ludoscope/api`, `ludoscope/contracts/fip/v1`, `ludoscope/adapters/chronicler` — публичные package exports. [FIP-профиль](contracts/fip/v1/README.md) и [Chronicler port](docs/CHRONICLER_INTEGRATION.md) определяют расширение без доступа к внутренним БД и произвольной загрузки кода источников.
