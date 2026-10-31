#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { simulate } from "../dist/simulation/index.js";
import { auditTraceability } from "../dist/analysis/traceability.js";
import { analyseMechanic } from "../dist/analysis/mechanic.js";
import { registry } from "../dist/core/knowledge.js";
import { renderReport } from "../dist/core/report.js";
import { VERSION } from "../dist/core/version.js";
import { readBufferBounded } from "../dist/core/files.js";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(
    "Usage: npm run pilot:hydrocraft -- [--source CHECKOUT] [--output NEW_DIRECTORY]\nWithout --source, runs the original model offline; upstream files are not verified.\nThe checkout is read-only. Output must be outside it. Existing output directories are never replaced.",
  );
  process.exit(0);
}
const fixture = (name) =>
  new URL(`../examples/hydrocraft-pilot/${name}`, import.meta.url);
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const readJson = async (name) =>
  JSON.parse(await readFile(fixture(name), "utf8"));
const model = await readJson("economy.json");
const mechanic = await readJson("mechanic.json");
const sourceManifest = await readJson("source-traceability.json");
const sourceMap = await readJson("sources.json");
const output = values.output
  ? path.resolve(values.output)
  : path.join(os.tmpdir(), `ludoscope-hydrocraft-${randomUUID()}`);
let sourceVerification = null;
const sourceFileChecks = [];
if (values.source) {
  const sourceRoot = await realpath(path.resolve(values.source));
  {
    // Resolve the existing parent to catch an output path through a symlink.
    const dest = output;
    const parent = await realpath(path.dirname(dest));
    const relative = path.relative(
      sourceRoot,
      path.join(parent, path.basename(dest)),
    );
    assert(
      relative.startsWith(".." + path.sep) ||
        relative === ".." ||
        path.isAbsolute(relative),
      "Output must be outside the read-only source checkout",
    );
  }
  sourceVerification = await auditTraceability(sourceRoot, sourceManifest);
  assert(
    sourceVerification.bindings.every((b) => b.status === "current"),
    "Pinned source files differ or cannot be read; review the manifest before analysis",
  );
  assert.equal(
    sourceVerification.revision.status,
    "match",
    "Checkout must match the pinned upstream revision",
  );
  assert.equal(
    sourceVerification.revision.dirty,
    false,
    "Use a clean checkout for the pinned-source pilot",
  );
  assert.equal(sourceMap.revision, sourceManifest.revision);
  for (const file of sourceMap.files) {
    const buffer = await readBufferBounded(sourceRoot, file.path);
    const actual = sha(buffer);
    assert.equal(
      actual,
      file.sha256,
      `Source metadata fingerprint: ${file.path}`,
    );
    assert.equal(
      buffer.length,
      file.bytes,
      `Source metadata size: ${file.path}`,
    );
    sourceFileChecks.push({
      path: file.path,
      sha256: actual,
      bytes: buffer.length,
    });
  }
}

const cases = [0, 1, 2, 3].map((spindles) => {
  const input = structuredClone(model);
  input.initial.spindle = spindles;
  const result = simulate(input);
  assert.equal(result.final.cotton_cloth, spindles === 3 ? 2 : 0);
  assert.equal(result.final.cotton_seeds, 18);
  assert.equal(result.violations.length, 0);
  for (const { resources: s } of result.trajectory) {
    assert.equal(
      s.spindle + s.cotton_thread,
      spindles,
      "Spindle stock accounting",
    );
    assert.equal(
      s.cotton_raw + s.cotton + 3 * s.cotton_thread + 9 * s.cotton_cloth,
      18,
      "Cotton equivalent-unit accounting",
    );
  }
  return { initial_spindles: spindles, result };
});
const omittedCallback = structuredClone(model);
delete omittedCallback.processes.find((p) => p.id === "weave_cotton").outputs
  .spindle;
const incompleteModel = simulate(omittedCallback);
assert.equal(incompleteModel.final.cotton_cloth, 1);
assert.equal(incompleteModel.final.spindle, 0);
const analysis = await analyseMechanic(mechanic, await registry());
const limitations = [
  "Original bounded stock-flow abstraction; upstream code was read, not executed.",
  "Sequential process order, one execution per process per tick; ticks are scheduler passes, not seconds or game time.",
  "Assumes successful callbacks, available stations, no initial thread and no outside supply. Acquisition, skill, interruptions, runtime loading and other recipes are excluded.",
  "The spindle threshold is a MODEL_RESULT under these assumptions, not a confirmed game defect or a recommendation to change the mod.",
  "No human participants, game build or interface inspection. Source fingerprints establish identity, not semantic equivalence or runtime correctness.",
];
const data = {
  schema_version: "1.0",
  ludoscope_version: VERSION,
  timestamp: new Date().toISOString(),
  project_id: "project.hydrocraft-pilot",
  task_id: "task.cotton-circulation",
  upstream: sourceMap,
  source_verification: sourceVerification,
  source_file_checks: sourceFileChecks,
  source_verification_performed: sourceVerification !== null,
  origin: "simulation",
  human_participants: 0,
  cases,
  omitted_callback_diagnostic: incompleteModel,
  analysis,
  limitations,
};
const rows = cases
  .map(
    ({ initial_spindles: n, result: r }) =>
      `| ${n} | ${r.final.cotton_cloth} | ${r.final.cotton_thread} | ${r.final.spindle} | ${r.final.cotton} |`,
  )
  .join("\n");
const report = `# Hydrocraft Reinvented · хлопковая цепочка

**LUDOSCOPE ${VERSION} · анализ без изменения мода**

Ревизия источника: [${sourceManifest.revision}](https://github.com/IgorKramar/HydrocraftReinvented/tree/${sourceManifest.revision}).

${sourceVerification ? "Файлы проверены по SHA-256; Git HEAD совпадает, рабочая копия чистая." : "Запуск без исходников: выполнена только оригинальная модель. Файлы внешнего проекта в этом запуске не проверялись."}

## Что обнаружено

В выбранных исходниках веретено расходуется при изготовлении нити. Три веретена возвращаются отдельным Lua-обработчиком изготовления ткани. Анализ одних декларативных выходов рецепта пропускает этот возврат. Точные файлы, строки и границы интерпретации записаны в sources.json примера и data.json отчёта.

## Вычислительная проверка · MODEL_RESULT

18 единиц сырого хлопка, доступные станции, успешные callbacks, seed 42, 18 проходов планировщика. В начале нет нити и ткани; внешние поставки отсутствуют.

| Веретён в начале | Ткань в конце | Оставшаяся нить | Свободные веретёна | Оставшийся хлопок |
|---:|---:|---:|---:|---:|
${rows}

В этой модели трёх веретён достаточно для двух единиц ткани; при 0–2 цепочка не завершает первую ткань. На каждом шаге проверены учёт хлопка и оборот веретён. Это ограничение стартового запаса само по себе не доказывает дефект дизайна.

Диагностический вариант модели с пропущенным возвратом веретён даёт только одну ткань и ноль свободных веретён. Он показывает цену неполной формализации; это не предложенное изменение игры.

## Возможные следующие решения · DESIGN_HYPOTHESIS

1. Сохранить правила; пояснить, что веретено временно находится в промежуточном продукте. Цена — дополнительная информация в интерфейсе.
2. Сохранить правила; показывать полный стартовый запас для партии. Цена — работа над представлением цепочки и меньше самостоятельных открытий.
3. Сохранить текущую подачу как авторский выбор. Проверить, воспринимается ли открытие оборота как осмысленная задача или как потеря инструмента.

Ни один вариант не утверждён. Они поддерживают принцип проекта «дополнить, не задублировать» и не требуют расширять набор игровых систем.

## План проверки

Сначала в отдельном игровом тестовом профиле проверить фактическое списание и возврат предметов, загрузку callback и сообщения об ошибках. Затем сравнить два прототипа объяснения: попросить реальных участников предсказать запас для первой ткани, записать ошибки прогноза, действия и субъективную обратную связь отдельно. Критерии и выборку задать до теста. Сейчас участников: **0**.

Трассировка внешних файлов остаётся частичной: сохранённые fingerprints не заменяют утверждённую спецификацию мода, его автоматические тесты и плейтесты. Отчёт не создаёт такие свидетельства автоматически.

## Границы вывода

${limitations.map((x) => `- ${x}`).join("\n")}

Структурированный расчёт: [data.json](data.json). Аналитический контекст: [analysis.md](analysis.md). Контрольные суммы: [manifest.json](manifest.json).
`;
await mkdir(output);
const artifacts = {
  "report.md": report,
  "analysis.md": renderReport(analysis, "ru"),
  "data.json": json(data),
};
for (const [name, content] of Object.entries(artifacts))
  await writeFile(path.join(output, name), content, { flag: "wx" });
const inputs = {};
for (const name of [
  "economy.json",
  "mechanic.json",
  "source-traceability.json",
  "sources.json",
])
  inputs[name] = sha(await readFile(fixture(name)));
await writeFile(
  path.join(output, "manifest.json"),
  json({
    schema_version: "1.0",
    inputs,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, content]) => [name, sha(content)]),
    ),
  }),
  { flag: "wx" },
);
console.log(
  json({
    output,
    source_verification_performed: !!sourceVerification,
    pinned_revision: sourceManifest.revision,
    cases: cases.map(({ initial_spindles, result }) => ({
      initial_spindles,
      cloth: result.final.cotton_cloth,
    })),
    human_participants: 0,
  }),
);
