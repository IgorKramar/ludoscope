# LUDOSCOPE

**Game Design Intelligence Engine** — локальный open-source плагин Codex для проектирования игрового опыта, анализа правил, воспроизводимых моделей и проектной памяти. Русский и English. MIT для оригинального кода и самостоятельно написанных материалов; права на сторонние источники сохраняются.

Рабочий релиз **0.3.0**: функциональное ядро, а не заявление о выполнении всех критериев 1.0. [Ограничения](LIMITATIONS.md) перечисляют неполные подсистемы.

## Установка из исходного репозитория

Нужен Node.js 22+ (проверено на 24.19.0), npm, локальный Codex с поддержкой Agent Plugins (проверено на CLI 0.159.2).

```sh
cd /path/to/ludoscope
npm ci --ignore-scripts
npm run check
codex plugin marketplace add /path/to/ludoscope
codex plugin add ludoscope@ludoscope-local
codex plugin list --json
```

Сначала собирайте плагин: локальная установка Codex копирует каталог, включая готовый `dist/` и установленные зависимости. Marketplace находится в `.agents/plugins/marketplace.json`. Пакет работает через stdio, без аккаунтов внешних сервисов, телеметрии и обязательной сети. Сеть нужна для первоначальной установки npm-зависимостей. При обновлении пересоберите и переустановите локальный плагин; кэш Codex содержит копию, а не живую ссылку.

Откройте игровой репозиторий как текущую рабочую директорию Codex. MCP привязан к cwd при запуске; для самостоятельного сервера можно явно установить `LUDOSCOPE_PROJECT_ROOT=/path/to/game`. Параметры инструментов не позволяют выбрать произвольный корень.

Альтернатива без plugin marketplace — отдельный MCP:

```sh
codex mcp add ludoscope --env LUDOSCOPE_PROJECT_ROOT=/absolute/path/to/game -- node /absolute/path/to/ludoscope/dist/mcp/index.js
```

Этот вариант подключает инструменты; Skills нужно подключить отдельно по правилам клиента. Полный плагин включает их автоматически.

## Быстрый старт: голод и автоматизация

```sh
# Выполняется из каталога LUDOSCOPE; --project задаёт игровой репозиторий.
node dist/cli/index.js --project examples/survival init
node dist/cli/index.js --project examples/survival scan
node dist/cli/index.js --project examples/survival analyse mechanic mechanic.json
node dist/cli/index.js --project examples/survival analyse economy economy.json
node dist/cli/index.js --project examples/survival simulate economy.json
node dist/cli/index.js --project examples/survival report mechanic.json --output .ludoscope/reports/hunger.md
node dist/cli/index.js --project examples/survival validate
```

`scan` без аргумента использует `--project`; явный путь разрешается относительно cwd. `init` создаёт новые файлы и отказывается заменять существующие: повторно открывайте через `context`.

После установки:

> LUDOSCOPE, хочу добавить голод. Помоги сделать его источником решений, а не раздражающим таймером.

Skill запрашивает контекст, выбирает знания и инструменты. Код выявляет структурные пробелы, зависимости и проверяет заданные числа. Codex разрабатывает несколько содержательно разных вариантов, отмечает гипотезы, компромиссы и предлагает плейтест. Симуляция не доказывает интерес. Утверждённое решение сохраняется только по явному намерению:

```sh
cp tests/fixtures/decision.json examples/survival/decision.json
node dist/cli/index.js --project examples/survival decision decision.json
node dist/cli/index.js --project examples/survival decision decision.json --commit
node dist/cli/index.js --project examples/survival context
```

Файловые пути CLI ограничены корнем проекта; первый вызов решения показывает diff, второй явно сохраняет запись.

## Что нового в 0.3.0

По предоставленному PDF Костера добавлены 29 пересказов с постраничными ссылками, 6 оригинальных методик, 6 линз и 5 сравнительных разборов со Шеллом и Сильвестром. Реестр: 19 источников, 208 записей, включая 134 проверенных пересказа. Mastery Analysis дополняет проверку учебного плана тематическими знаниями и вопросами исследования. Это не измерение реального обучения или удовольствия.

[Практический пример](docs/knowledge/koster-worked-mastery.md) показывает переработку плана и эксперимент на перенос навыка. Полные книги и OCR не распространяются.

## Что работает

- 17 независимых [Skills](SKILLS.md), четыре режима и семь аналитических профилей.
- 24 инструмента [MCP API](MCP.md), CLI и общее типизированное ядро; строгие схемы аргументов и результатов.
- Проектный профиль, vision, principles, граф, версии проектных артефактов и неизменяемые Decision Records.
- Сканирование с ревизией Git и SHA-256 файлов, без выдумывания механик по именам.
- 19 источников, 208 записей знаний; поиск без API-ключа и отключение источников/направлений.
- Анализ механик и доминирования в явно заданной паре цена–выгода, граф влияния, feedback components и Mermaid.
- Ресурсная экономика, фиксированный seed, инварианты, Monte Carlo и чувствительность параметров.
- Конечные автоматы, булевы состояния нарратива, учебные зависимости, UX и процедурные выборки.
- Дизайн экспериментов, импорт CSV/JSON, разделение измерений, наблюдений и субъективных оценок.
- Markdown/JSON-отчёты, рендеринг GDD и 30 шаблонов на ru/en.

Полные тексты коммерческих книг и карточек не распространяются. Проверка библиографии не означает проверку содержания. [KNOWLEDGE.md](KNOWLEDGE.md) объясняет происхождение и границы записей.

## English quick start

Build with `npm ci --ignore-scripts && npm run check`. Register the repository as a Codex plugin marketplace and install `ludoscope@ludoscope-local`. Start Codex in your game repository; initialize it using `node /path/to/ludoscope/dist/cli/index.js init --language en`. Use `report mechanic.json --language en` for English headings. Knowledge titles preserve bibliographic identity; Codex Skills follow the user's language. Structural diagnostics currently contain Russian text; see localization limits.

## Документация

[Архитектура](ARCHITECTURE.md) · [Методология](METHODOLOGY.md) · [Знания](KNOWLEDGE.md) · [MCP](MCP.md) · [Симуляция](SIMULATION.md) · [Расширения](EXTENDING.md) · [Тесты](TESTING.md) · [Ограничения](LIMITATIONS.md) · [План](ROADMAP.md) · [Изменения](CHANGELOG.md)
