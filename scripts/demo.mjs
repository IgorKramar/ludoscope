#!/usr/bin/env node
/**
 * Reproducible local demonstration.
 * Build first: npm run build
 * Run: node scripts/demo.mjs --output /tmp/ludoscope-demo
 *
 * Simulation results are deterministic; run timestamps, temporary project IDs
 * and analysis UUIDs deliberately identify individual executions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ProjectStore, scan } from "../dist/project/store.js";
import { LudoscopeAgentApi } from "../dist/integration/api.js";
import { economy, simulate } from "../dist/simulation/index.js";
import { impact, mermaid } from "../dist/core/graph.js";
import { VERSION } from "../dist/core/version.js";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(
    "Usage: npm run demo -- [--output NEW_DIRECTORY]\n" +
      "Creates report.md, analysis.md, data.json and manifest.json.\n" +
      "Without --output, artifacts are retained in a new temporary directory.\n" +
      "Existing output directories are never overwritten.",
  );
  process.exit(0);
}

const output = values.output
  ? path.resolve(values.output)
  : await mkdtemp(path.join(os.tmpdir(), "ludoscope-demo-output-"));
if (values.output) await mkdir(output);

const work = await mkdtemp(path.join(os.tmpdir(), "ludoscope-demo-project-"));
const startedAt = new Date().toISOString();
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const json = (data) => JSON.stringify(data, null, 2) + "\n";

try {
  const inputFiles = ["mechanic.json", "economy.json", "graph.json"];
  const inputs = {};
  const sourceHashes = {};
  for (const file of inputFiles) {
    const source = new URL(`../examples/survival/${file}`, import.meta.url);
    const text = await readFile(source, "utf8");
    inputs[file] = JSON.parse(text);
    sourceHashes[`examples/survival/${file}`] = sha256(text);
    await copyFile(source, path.join(work, file));
  }

  const mechanic = inputs["mechanic.json"];
  const model = inputs["economy.json"];
  const graph = inputs["graph.json"];
  const store = new ProjectStore(work);
  const profile = await store.init("ru");
  await store.recordArtifact(
    {
      kind: "mechanic",
      id: mechanic.id,
      version: 1,
      data: mechanic,
    },
    true,
  );

  // Reopen through a fresh store instance; nothing is saved to the fixtures.
  const reopened = new ProjectStore(work);
  const reopenedMechanic = await reopened.mechanic(mechanic.id);
  assert.equal(reopenedMechanic.id, mechanic.id);
  assert.deepEqual(reopenedMechanic.rules, mechanic.rules);
  const context = await reopened.context();
  assert.equal(context.artifact_index.length, 1);
  assert.equal(context.decisions.length, 0);
  const discovery = await scan(work);
  assert.equal(discovery.files.length, inputFiles.length);

  const api = await LudoscopeAgentApi.create();
  const taskId = "task.demo.hunger";
  const request = (id) => ({
    api_version: "1.0",
    request_id: id,
    project_id: profile.id,
    task_id: taskId,
    session_id: "session.demo",
    agent_id: "agent.demo",
    timestamp: new Date().toISOString(),
    status: "submitted",
    artifact_refs: [
      {
        id: "artifact.demo.mechanic",
        project_id: profile.id,
        kind: "mechanic",
        uri: "data.json#/inputs/mechanic.json",
        revision: `sha256:${sourceHashes["examples/survival/mechanic.json"]}`,
        description: "Original survival demonstration specification.",
      },
      {
        id: "artifact.demo.model",
        project_id: profile.id,
        kind: "simulation_model",
        uri: "data.json#/inputs/economy.json",
        revision: `sha256:${sourceHashes["examples/survival/economy.json"]}`,
        description: "Explicit resource rules, seed, steps and invariant.",
      },
    ],
    evidence: [],
    context: {
      subject: "Голод, производство пищи и автоматизация",
      genre: "survival",
      audience: "Аудитория ещё требует исследования",
      author_goals: ["Осмысленное планирование экспедиций"],
      creative_principles: ["Сохранять спокойный ритм подготовки"],
      constraints: ["Не добавлять новые системы без игрового назначения"],
      tags: ["choice", "resources", "feedback"],
      system_types: ["mechanic", "economy"],
    },
  });

  const analysis = await api.call("analyze_mechanic", {
    request: request("request.demo.analysis"),
    mechanic,
  });
  assert.ok(analysis.alternatives.length >= 2);

  // This is a narrowly defined model hypothesis, not a player-experience claim.
  const modelHypothesis = {
    id: "hypothesis.demo.food_cap",
    statement:
      "При seed=42 за 10 тактов модель не нарушит ограничение food <= 12.",
    claim_type: "DESIGN_HYPOTHESIS",
    falsification: "Симулятор зарегистрирует хотя бы одно нарушение инварианта.",
    metric: "invariant_violations",
  };
  const experiment = await api.call("formulate_playtest", {
    request: request("request.demo.experiment"),
    hypothesis: modelHypothesis,
    method: "simulation",
    participants: "Формальная ресурсная модель; людей в эксперименте нет.",
    conditions: [
      "Seed 42; 10 тактов; процессы выполняются в порядке farm, eat.",
      "Начальное состояние: food=5, energy=5.",
    ],
    metrics: ["invariant_violations"],
    interpretation:
      "Критерий задан до прогона: число нарушений <= 0. Вывод относится только к модели.",
  });

  const baseline = simulate(model);
  assert.deepEqual(baseline, simulate(model));
  assert.equal(baseline.seed, 42);
  assert.equal(baseline.final.food, 15);
  assert.equal(baseline.final.energy, 5);
  assert.deepEqual(
    baseline.violations.map((item) => item.step),
    [8, 9, 10],
  );

  // One explicit parameter change, held against the same seed and horizon.
  const candidateModel = structuredClone(model);
  candidateModel.id = "model.survival.candidate";
  const farm = candidateModel.processes.find((process) => process.id === "farm");
  assert.ok(farm);
  farm.outputs.food = 1;
  const candidate = simulate(candidateModel);
  assert.equal(candidate.final.food, 5);
  assert.equal(candidate.violations.length, 0);

  const economyAnalysis = economy(model);
  const dependencies = impact(graph, mechanic.id);
  assert.ok(dependencies.affected.some((node) => node.id === "resource.food"));

  // Use computed violation count. Averaging food would conceal the cap violation.
  const evaluation = await api.call("evaluate_playtest", {
    request: request("request.demo.evaluation"),
    prior_analysis: experiment,
    data_origin: "simulation",
    observations: [
      {
        participant: "model.survival",
        kind: "measurement",
        metric: "invariant_violations",
        value: baseline.violations.length,
        hypothesis: modelHypothesis.id,
        text: "Computed directly from the saved simulator result.",
      },
    ],
    criteria: [
      {
        hypothesis_id: modelHypothesis.id,
        metric: "invariant_violations",
        operator: "lte",
        threshold: 0,
      },
    ],
  });
  assert.equal(evaluation.evaluation.claim_type, "MODEL_RESULT");
  assert.equal(evaluation.evaluation.participants, 0);
  assert.equal(
    evaluation.evaluation.hypothesis_outcomes[0].status,
    "descriptively_contradicted",
  );

  const revision = await api.call("analyze_mechanic", {
    request: request("request.demo.revision"),
    mechanic,
    prior_analysis: evaluation,
  });
  const publicationPreview = await api.call("publish_analysis", {
    request: request("request.demo.preview"),
    analysis: revision,
  });
  assert.equal(publicationPreview.publication.state, "preview");

  for (const result of [
    analysis,
    experiment,
    evaluation,
    revision,
    publicationPreview,
  ]) {
    assert.equal(result.project_id, profile.id);
    assert.equal(result.task_id, taskId);
    assert.notEqual(result.status, "error");
  }
  assert.equal(revision.history.available, false);
  assert.ok(
    revision.hypotheses.every(
      (hypothesis) => hypothesis.claim_type === "DESIGN_HYPOTHESIS",
    ),
  );

  const summary = {
    version: VERSION,
    seed: baseline.seed,
    steps: model.steps,
    baseline: {
      final: baseline.final,
      invariant_violations: baseline.violations.length,
    },
    candidate: {
      final: candidate.final,
      invariant_violations: candidate.violations.length,
    },
    alternatives: analysis.alternatives.length,
    affected_nodes: dependencies.affected.length,
    data_origin: "simulation",
    human_participants: 0,
    hypothesis_outcome: evaluation.evaluation.hypothesis_outcomes[0].status,
    chronicler_publication: publicationPreview.publication.state,
    project_memory_reopened: true,
    identity_preserved: true,
  };
  const data = {
    started_at: startedAt,
    summary,
    source_sha256: sourceHashes,
    inputs,
    candidate_model: candidateModel,
    project_context: context,
    discovery,
    dependency_analysis: dependencies,
    economy_analysis: economyAnalysis,
    baseline,
    candidate,
    analysis,
    experiment,
    evaluation,
    revision,
    publication_preview: publicationPreview,
  };

  const report = [
    "# LUDOSCOPE · От идеи к проверяемой модели",
    "",
    "> Воспроизводимый пример на тестовом survival-проекте. Все численные результаты ниже вычислены этим запуском.",
    "",
    "## Дизайнерская задача",
    "",
    "Голод должен поддерживать планирование экспедиций. Ресурсная модель позволяет проверить накопление пищи; осмысленность решений и желаемый ритм требуют отдельного исследования с игроками.",
    "",
    "## Вычисленный результат",
    "",
    "| Параметр | Исходная модель | Кандидат |",
    "| :--- | ---: | ---: |",
    `| Seed | ${baseline.seed} | ${candidate.seed} |`,
    `| Такты | ${model.steps} | ${candidateModel.steps} |`,
    "| Производство пищи за farm | 2 | 1 |",
    `| Итоговая пища | ${baseline.final.food} | ${candidate.final.food} |`,
    `| Итоговая энергия | ${baseline.final.energy} | ${candidate.final.energy} |`,
    `| Нарушения food ≤ 12 | ${baseline.violations.length} | ${candidate.violations.length} |`,
    "",
    `Исходная модель нарушает ограничение на тактах ${baseline.violations.map((item) => item.step).join(", ")}. Проверяемая гипотеза получила статус \`${summary.hypothesis_outcome}\` по заранее заданному критерию.`,
    "",
    "Кандидат проходит этот инвариант на том же горизонте. Уменьшение производства меняет темп и запас пищи; это ещё не основание принять его как дизайнерское решение.",
    "",
    "## Связанные системы",
    "",
    "```mermaid",
    mermaid(graph),
    "```",
    "",
    "Граф показывает явно объявленные связи. Обход зависимостей консервативен и не доказывает причинность.",
    "",
    "## Передача между агентами",
    "",
    "1. Проанализирована спецификация механики и получены варианты прототипа.",
    "2. До расчёта сформулирована гипотеза об инварианте ресурсной модели.",
    "3. Выполнены два прогона с одинаковым seed; исходный прогон повторён для проверки детерминированности.",
    "4. Реальные результаты симулятора переданы в API с происхождением `simulation`.",
    "5. Анализ пересмотрен с сохранением идентификаторов проекта и задачи.",
    "6. Сформирован preview публикации. Запись в Chronicler не выполнялась.",
    "",
    "## Что проверить с игроками",
    "",
    "- Какие маршруты игроки выбирают при разных запасах и почему?",
    "- Понятны ли причины изменения еды и энергии?",
    "- Сохраняется ли спокойный ритм подготовки или появляется обязательная рутина?",
    "- Как меняются решения после освоения автоматизации?",
    "",
    "Участники ещё не набраны, наблюдения и субъективные оценки не собраны. Число реальных участников в этом запуске: **0**.",
    "",
    "## Артефакты",
    "",
    "- [data.json](data.json) — входные данные, SHA-256, траектории, полный API-цикл и контекст временного проекта.",
    "- [analysis.md](analysis.md) — пересмотренный структурированный анализ.",
    "- [manifest.json](manifest.json) — версия, результаты проверок и контрольные суммы файлов.",
    "",
    "## Границы вывода",
    "",
    "Результаты относятся к последовательной дискретной модели с явно заданными правилами. Это не доказательство интереса, общего баланса или поведения реальных игроков. Chronicler не подключён; история решений неполна. Экспериментальный кандидат не утверждён автором.",
    "",
  ].join("\n");

  const files = {
    "data.json": json(data),
    "report.md": report,
    "analysis.md": revision.markdown + "\n",
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(output, name), content, { flag: "wx" });

  const manifest = {
    version: VERSION,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary,
    checks: {
      seeded_replay: "passed",
      declared_invariant: "violation reproduced",
      candidate_invariant: "passed for this scenario",
      model_origin_preserved: "passed",
      project_task_identity: "passed",
      project_memory_reopen: "passed",
      publication_preview_only: "passed",
    },
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        { sha256: sha256(content), bytes: Buffer.byteLength(content) },
      ]),
    ),
    limitations: [
      "Model results only; no real player observations.",
      "Chronicler unavailable; no remote publication.",
      "Passing this invariant does not approve the candidate design.",
      "Run metadata varies; the seeded simulation result is deterministic.",
    ],
  };
  // Written last so a complete manifest identifies a finished demonstration.
  await writeFile(path.join(output, "manifest.json"), json(manifest), {
    flag: "wx",
  });
  console.log(json({ output, report: path.join(output, "report.md"), ...summary }));
} finally {
  await rm(work, { recursive: true, force: true });
}
