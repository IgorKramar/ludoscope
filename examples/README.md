# Четыре воспроизводимых сценария

Все данные синтетические, написаны для проверки инструментов; они не являются результатами плейтестов или рекомендациями по качеству игры. Запустите `npm ci && npm run build` из корня LUDOSCOPE. Каждый каталог содержит строгую спецификацию механики, граф и модель ресурсов с seed 42.

- `survival`: голод связан с погодой, фермой и автоматизацией. Ферма потребляет энергию, еда восстанавливает её; цикл накапливает пищу и нарушает заданную верхнюю границу. Это повод проверить намерение автора и влияние голода на решения.
- `card-roguelike`: розыгрыш комбинации расходует ману, а вероятность успеха формально задана. Симуляция иллюстрирует разброс, но не моделирует стратегию игрока или реальный драфт карт.
- `economic-tycoon`: покупка сырья за 2, производство и продажа за 3 дают воспроизводимое увеличение денег. За десять шагов баланс растёт с 10 до 20; превышение 15 нарушает именно введённое ограничение. Прибыль сама по себе не является эксплойтом.
- `narrative-strategy`: обещания расходуют влияние, петиции добавляют его с вероятностью 0,5. Отдельная Boolean-модель показывает путь `betray`, который нарушает объявленный канон `treaty=true`. Это намеренная тестовая ошибка, не предложение переписать канон.

Самостоятельный запуск на временной копии (из корня репозитория):

```bash
npm run build
DEMO_ROOT=$(mktemp -d)
cp -R examples/survival/. "$DEMO_ROOT/"
node dist/cli/index.js --project "$DEMO_ROOT" init --language ru
node dist/cli/index.js --project "$DEMO_ROOT" scan
node dist/cli/index.js --project "$DEMO_ROOT" analyse mechanic mechanic.json
node dist/cli/index.js --project "$DEMO_ROOT" analyse economy economy.json
node dist/cli/index.js --project "$DEMO_ROOT" simulate economy.json
node dist/cli/index.js --project "$DEMO_ROOT" simulate economy.json --seeds 1,2,3
node dist/cli/index.js --project "$DEMO_ROOT" report mechanic.json --format markdown
node dist/cli/index.js --project "$DEMO_ROOT" validate
```

Для другого сценария замените `survival` при копировании. Для анализа входного графа без изменения проектной памяти:

```bash
node --input-type=module - "$DEMO_ROOT" <<'JS'
import {readFile} from 'node:fs/promises';
import {impact,mermaid} from './dist/core/graph.js';
const graph=JSON.parse(await readFile(`${process.argv[2]}/graph.json`,'utf8'));
console.log(JSON.stringify(impact(graph,graph.nodes[0].id),null,2));
console.log(mermaid(graph));
JS
```

Эксперимент для survival: сравнить ручной голод, автоматизацию после освоения и отсутствие голода на одной задаче; чередовать порядок прототипов. До приглашения участников определить гипотезу, наблюдаемые изменения маршрутов и выбора, время понимания и отдельный субъективный опрос. Не путать число нажатий с содержательностью выбора. Никакие результаты участников в примеры не включены.

Тестовый Decision Record расположен в `tests/fixtures/decision.json`. `decision FILE` показывает preview; `decision FILE --commit` явно создаёт неизменяемую запись. Содержимое fixtures не следует автоматически утверждать для реального проекта.
