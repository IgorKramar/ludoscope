![LUDOSCOPE](docs/assets/ludoscope.svg)

[English](README.en.md) · [Портфолио](docs/PORTFOLIO.md) · [API](docs/API.md) · [Ограничения](LIMITATIONS.md)

# LUDOSCOPE

**Game Design Intelligence Engine** — локальный open-source плагин Codex для проектирования игрового опыта, анализа правил, воспроизводимых моделей и проектной памяти.

Рабочая версия **0.6.0**. 17 Skills, 41 MCP-инструментов и общее ядро TypeScript. Русский язык — основной; поддержка английского частичная. [Состав и история версий](CHANGELOG.md).

## Попробовать за один запуск

Нужны Node.js 22+ и npm. CI проверяет Node.js 22 и 24 на Linux.

```sh
git clone https://github.com/IgorKramar/ludoscope.git
cd ludoscope
npm ci --ignore-scripts
npm run check
npm run demo
```

Демо создаёт временный игровой проект и отдельную папку результатов: `report.md`, `analysis.md`, `data.json`, `manifest.json`. В консоли появится путь к отчёту. Оно сравнивает две ресурсные модели, передаёт реальные результаты симулятора в агентный API и проверяет сохранение контекста между итерациями.

```sh
# Сохранить результат в выбранную НОВУЮ папку:
npm run demo -- --output /tmp/ludoscope-demo
```

[Разбор демо](docs/DEMO.md) объясняет условия модели и границы вывода. Для каждого запуска используйте новую папку либо не указывайте `--output`.

## Пилот на реальном моде

Для кейса на реальных исходниках доступен [пилот Hydrocraft Reinvented](examples/hydrocraft-pilot/README.md): рецепты, возвраты инструментов через Lua-callback, четыре сценария и отчёт. Без исходников запуск проверяет модель офлайн:

```sh
npm run pilot:hydrocraft
# При наличии отдельной копии закреплённой ревизии мода:
npm run pilot:hydrocraft -- --source ../hydrocraft-readonly
```

Мод остаётся без изменений. [Трассировка](docs/TRACEABILITY.md) обнаруживает устаревшие привязки и явно показывает отсутствие подтверждённых тестов или плейтестов.

## Установка в Codex

После сборки зарегистрируйте локальный каталог как marketplace:

```sh
codex plugin marketplace add /absolute/path/to/ludoscope
codex plugin add ludoscope@ludoscope-local
codex plugin list --json
```

Формат локальной установки проверен на Codex CLI 0.159.2 в [отчёте 0.4.0](docs/verification-0.4.0.md). Новые CI-проверки отдельно проверяют установленный npm-пакет и MCP, а не интерфейс каждой версии Codex.

Codex копирует каталог вместе с готовым `dist/` и зависимостями. После обновления исходников пересоберите и переустановите плагин. Marketplace описан в `.agents/plugins/marketplace.json`.

Откройте игровой репозиторий как рабочий каталог Codex. Инициализировать память можно через CLI:

```sh
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game init
```

`init` создаёт `.ludoscope/` и отказывается заменять существующие файлы. Для повторного открытия используйте `context`.

Альтернатива — подключить только MCP-инструменты:

```sh
codex mcp add ludoscope --env LUDOSCOPE_PROJECT_ROOT=/absolute/path/to/game -- node /absolute/path/to/ludoscope/dist/mcp/index.js
```

Полный плагин также включает Skills. В отдельном MCP-подключении Skills подключаются по правилам клиента. Корень MCP задаётся при запуске и не выбирается произвольным аргументом инструмента.

## Работа с механикой

> LUDOSCOPE, хочу добавить голод. Помоги сделать его источником решений, а не раздражающим таймером.

Skill собирает цели автора и ограничения, выбирает знания и инструменты. Ядро проверяет структуру механики, зависимости и явно заданные числа. Codex разрабатывает варианты с компромиссами, гипотезами и планом проверки.

```sh
# Файлы mechanic.json и economy.json относятся к вашему игровому проекту.
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game scan
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game analyse mechanic mechanic.json
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game simulate economy.json
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game report mechanic.json --output .ludoscope/reports/mechanic.md
```

Примеры входных данных: [четыре демонстрационных проекта](examples/README.md). Аналитические операции читают данные; команда `report --output` явно сохраняет отчёт. Решение сначала просматривается, затем сохраняется по явному намерению:

```sh
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game decision decision.json
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game decision decision.json --commit
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game context
```

Формат решения показан в [фикстуре](tests/fixtures/decision.json). Утверждённые записи не перезаписываются.

## Возможности

| Область | Реализация |
| :--- | :--- |
| Знания | 19 источников, 208 записей, поиск без API-ключа, контекстные линзы |
| Механики | Цели, действия, правила, состояния, выбор, зависимости и риски |
| Системы | Граф влияния, feedback components, Mermaid, ограниченные проверки циклов |
| Модели | Ресурсный баланс, seed, инварианты, Monte Carlo, чувствительность |
| Исследования | Эксперименты, CSV/JSON, измерения отдельно от субъективных отзывов |
| Память | Профиль, vision, principles, версии артефактов и Decision Records |
| Агентный API | 16 FIP-операций поверх общего ядра; ещё 25 операций ядра |
| Документы | Markdown/JSON, GDD и 30 шаблонов на ru/en |

[Практический Mastery Analysis](docs/knowledge/koster-worked-mastery.md) · [WORLD FORGE цикл](docs/WORLD_FORGE_INTEGRATION.md).

## На чём основаны выводы

Источники, проектные факты, результаты моделей, наблюдения плейтестов и гипотезы имеют разные статусы. Версия 0.5.0 проверяет целостность ссылок и не допускает тихой замены разных записей под одним ID. Несколько критериев одной гипотезы образуют совместное условие: должны выполниться все.

Реестр содержит самостоятельные пересказы выбранных доступных фрагментов Шелла, Сильвестра, Костера и открытых материалов. Методы и линзы отделены от авторских положений. Полные книги и OCR не публикуются. [Происхождение знаний](KNOWLEDGE.md).

Базовый продукт работает локально без обязательных API-ключей, телеметрии и сети во время анализа. Сеть нужна при первоначальной установке зависимостей.

## Документация

| Начало работы | Инженерные контракты | Методология |
| :--- | :--- | :--- |
| [Демо](docs/DEMO.md) | [Архитектура](ARCHITECTURE.md) | [Знания](KNOWLEDGE.md) |
| [Skills](SKILLS.md) | [API](docs/API.md) · [MCP](MCP.md) | [Анализ](METHODOLOGY.md) |
| [Портфолио-кейс](docs/PORTFOLIO.md) | [Chronicler](docs/CHRONICLER_INTEGRATION.md) | [Симуляция](SIMULATION.md) |
| [Roadmap](ROADMAP.md) | [Расширения](EXTENDING.md) | [Тестирование](TESTING.md) |

MIT для оригинального кода и самостоятельно написанных материалов. Права сторонних источников сохраняются: [THIRD_PARTY.md](THIRD_PARTY.md). [CONTRIBUTING.md](CONTRIBUTING.md).
