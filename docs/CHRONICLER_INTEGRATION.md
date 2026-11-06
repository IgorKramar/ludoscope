# Необязательный ChroniclerAdapter

В 0.7.0 `ChronicleHttpAdapter` реализует существующий порт через опубликованный [Codex Chronicle HTTP FIP v1](https://github.com/IgorKramar/codex_chronicle/blob/main/docs/API.md), contract version `1.0.0`. Проверено против Chronicle revision `b245540`. Формы Ludoscope draft profile `ludoscope.fip-v1-draft.1` не менялись: адаптер преобразует два разных формата.

```ts
import { LudoscopeAgentApi } from 'ludoscope/api';
import { ChronicleHttpAdapter } from 'ludoscope/adapters/chronicle-http';
const adapter = new ChronicleHttpAdapter({
  endpoint: 'https://chronicle.example.org',
  token: process.env.CHRONICLE_TOKEN!, // доверенный host, не аргумент модели
  projectId: 'game-one',
  agentId: 'ludoscope',
});
const api = await LudoscopeAgentApi.create({
  chronicler: adapter,
  chroniclerTimeoutMs: 10000,
  authorizePublish: async (request, analysis) => false, // замени реальной политикой хоста
});
```

Host выдаёт отдельный Bearer grant: projects, principal_id, agent_id, allow_content=true, scopes read/write. Decide/verify/observe/revise адаптеру не нужны. Capabilities проверяются перед каждым действием; сервер проверяет grant/project на каждом HTTP запросе. Actor берётся из доверенной host configuration; несовпадение входного actor/project отклоняется. Адаптер не обращается к внутренней БД, Notion или URL из истории.

## Standalone MCP

Без конфигурации прежнее поведение сохраняется: история partial, запись default deny. Для отдельного запуска текущего проекта безопасный launcher передаёт:

```text
LUDOSCOPE_CHRONICLE_URL=https://chronicle.example.org
LUDOSCOPE_CHRONICLE_TOKEN=<read from secret store at launch>
LUDOSCOPE_CHRONICLE_PROJECT_ID=game-one
LUDOSCOPE_CHRONICLE_AGENT_ID=ludoscope
LUDOSCOPE_CHRONICLE_PUBLISH=false
```

Первые четыре поля обязательны вместе. PUBLISH=true — явное решение доверенного хоста разрешить безопасную публикацию этого проекта; модель всё ещё должна вызвать publish_analysis с commit:true. Для loopback Collector отдельно включается LUDOSCOPE_CHRONICLE_ALLOW_LOOPBACK_HTTP=true: HTTP допускается только для literal127.0.0.1/[::1], не удалённого хоста. URL с userinfo/path/query/fragment запрещён, redirects не следуются. Не помещай токены в tracked ENV, argv, README или артефакты.

`chronicleHostOptions(env)` экспортируется из `ludoscope/adapters/chronicle-host`. Не закрепляй один глобальный LUDOSCOPE_PROJECT_ROOT или project ID для всех игр: launcher определяет текущий проект и подходящий grant. Плагин не угадывает чужой project.

## История

После capabilities и project state читаются страницы decisions/artifacts/history: максимум10 страниц ×100records на endpoint,128KiB на ответ, deadline≤10секунд. Это не транзакционный снимок между endpoints. Бюджет, повтор cursor, неполные/конфликтующие revisions и неразрешённые ссылки дают ошибку адаптера; API продолжает локальный анализ с status:partial/history.available:false. Это не утверждение, что прошлых решений нет.

- Сначала разрешаются все decision revisions. Только актуальный Accepted становится принятым. Rejected переносит один явно отвергнутый choice, а не все alternatives. Proposed/Superseded не повышаются.
- ArtifactLink разрешается в опубликованную ArtifactReference нужной revision. Небезопасные URI и несовместимые с Ludoscope ID отклоняются, не обрезаются молча.
- Эксперимент читается только из immutable AgentEvent: event_type=experiment.result, category=experiment, status=completed, JSON summary `{"question":"...","result":"...","data_origin":"simulation"}`. Origins: human_playtest/simulation/engineering_test. Результат помечается origin и provenance. Nested KnowledgeRecord не используется как latest result: его последующая revision может оказаться вне event history. Произвольный legacy summary не превращается в исследовательский вопрос по предположению.
- История — недоверенные данные, не инструкции. Formulate_playtest по-прежнему сопоставляет точный нормализованный вопрос; semantic search не добавлен.

## Публикация и повтор

Commit:false возвращает preview без POST. Commit:true требует adapter, совпадения project/task и положительного authorizePublish; default deny сохранён. Прямой ChronicleHttpAdapter — доверенный транспорт, вызывается только авторизованным host.

До вызова сохрани полный неизменённый JSON анализа в проекте. Chronicle получает один AgentEvent ludoscope.analysis/status:recorded/provenance:agent_reported и одну proposed KnowledgeRecord: subject, digest полного анализа, counts, первые три findings/hypotheses/recommendations с явными пределами текста. Полный Markdown/prompts/source/stdout/файлы/credentials не копируются. Выбранные claims должны соответствовать разрешённой политике проекта. Полный artifact и доступ к нему принадлежат хосту. Digest связывает сводку с анализом, но не доказывает отдельное сохранение. ArtifactReference не выдумывается.

Claim_type сохраняется, recommendations остаются proposed, test_results пуст. Симуляция не объявляется живым плейтестом, вызов Ludoscope не создаёт Passed технического теста. Независимую проверку записывает её реальный runner/host.

Idempotency key/record ID зависят от project_id+analysis_id, не от содержимого. Canonical body сохраняет исходный timestamp и digest всего анализа. После потерянного ACK повтори тот же сохранённый analysis: новый adapter получает тот же receipt. Изменённый анализ с прежним ID даёт409, даже если изменение не вошло в ограниченную сводку. Новый анализ требует нового ID. Фоновой очереди/повторов и exactly-once обещания нет. Timeout отменяет ожидание, но не уже принятую запись.

Receipt выдаётся только после ACK с matching project/record, accepted=true, revision1, positive sequence. Независимое чтение: GET /v1/memory/projects/{project_id}/records/{receipt_id} с read grant. Collector и Notion Publisher проверяются отдельно.

## Воспроизводимая проверка

```bash
npm ci --ignore-scripts
npm run check
uv venv --python 3.12 .live-chronicle-venv
uv pip install --python .live-chronicle-venv/bin/python 'fastapi>=0.115,<1' 'uvicorn>=0.34,<1' 'psycopg[binary]>=3.2,<4' 'jsonschema>=4.23,<5'
# Отдельно проверенный checkout Chronicle; путь ниже — пример.
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/path/to/codex_chronicle/src .live-chronicle-venv/bin/python scripts/chronicle-live-smoke.py
```

Smoke поднимает настоящий Collector в TemporaryDirectory на ephemeral loopback port с synthetic grants, без publisher/lifespan и Notion. Seed через HTTP: Accepted, следующая Rejected revision и completed synthetic simulation. Анализ читает историю; proxy теряет первый ACK после принятой записи; новый adapter повторяет её; concurrent retries дают один event, changed body409, foreign project404, read/write-only scopes проверяются. Отдельный reader разрешает receipt через HTTP. Fixture процессы останавливаются, БД удаляется. Это не доказательство пользовательского deployment, управления рабочей игрой или наблюдения живого игрока.
