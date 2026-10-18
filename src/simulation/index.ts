import { z } from "zod";
import { Model } from "../core/schemas.js";
import { ensure } from "../core/errors.js";
export type SystemModel = z.infer<typeof Model>;
export interface SimulationProvider {
  run(model: SystemModel, signal?: AbortSignal): ReturnType<typeof simulate>;
}
export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function simulate(input: unknown, signal?: AbortSignal) {
  const m = Model.parse(input);
  const random = rng(m.seed);
  const state = { ...m.initial };
  const trajectory: { step: number; resources: Record<string, number> }[] = [
    { step: 0, resources: { ...state } },
  ];
  const violations: {
    step: number;
    resource: string;
    value: number;
    min?: number;
    max?: number;
  }[] = [];
  const counts: Record<string, number> = {};
  const ids = new Set<string>();
  for (const p of m.processes) {
    ensure(!ids.has(p.id), "DUPLICATE", p.id);
    ids.add(p.id);
  }
  let overflow = false;
  function check(step: number) {
    for (const inv of m.invariants) {
      const value = state[inv.resource];
      if (
        (inv.min !== undefined && value < inv.min) ||
        (inv.max !== undefined && value > inv.max)
      )
        violations.push({ step, ...inv, value });
    }
  }
  check(0);
  for (let step = 1; step <= m.steps; step++) {
    signal?.throwIfAborted();
    for (const p of m.processes)
      for (let i = 0; i < p.limit; i++) {
        if (!Object.entries(p.inputs).every(([r, a]) => state[r] >= a)) break;
        if (random() >= p.probability) continue;
        for (const [r, a] of Object.entries(p.inputs)) state[r] -= a;
        for (const [r, a] of Object.entries(p.outputs)) state[r] += a;
        counts[p.id] = (counts[p.id] ?? 0) + 1;
        ensure(
          Object.values(state).every(Number.isFinite),
          "OVERFLOW",
          "Non-finite resource",
        );
      }
    check(step);
    if (violations.length > 10000) {
      overflow = true;
      break;
    }
    if (step % Math.max(1, Math.ceil(m.steps / 1000)) === 0 || step === m.steps)
      trajectory.push({ step, resources: { ...state } });
  }
  return {
    claim_type: "MODEL_RESULT" as const,
    model: m,
    seed: m.seed,
    final: state,
    executions: counts,
    violations,
    stopped_early: overflow,
    trajectory,
    limitations: [
      "Sequential discrete ticks in declared process order; fixed per-tick limits. No proof of player enjoyment or general economic stability.",
    ],
  };
}
export function economy(input: unknown) {
  const m = Model.parse(input);
  const resources = Object.keys(m.initial);
  const net = Object.fromEntries(
    resources.map((r) => [
      r,
      m.processes.reduce(
        (s, p) =>
          s +
          ((p.outputs[r] ?? 0) - (p.inputs[r] ?? 0)) * p.limit * p.probability,
        0,
      ),
    ]),
  );
  const freeSources = m.processes
    .filter(
      (p) =>
        Object.values(p.inputs).every((x) => x === 0) &&
        Object.values(p.outputs).some((x) => x > 0),
    )
    .map((p) => p.id);
  // Bounded exhaustive integer combinations certify a nonnegative net conversion, not reachability.
  const candidates = m.processes.filter(
    (p) => p.probability === 1 && p.limit > 0,
  );
  const witnesses: { processes: string[]; net: Record<string, number> }[] = [];
  let searched = 0;
  const max = 5000;
  function search(
    start: number,
    chosen: number[],
    sum: Record<string, number>,
  ) {
    if (chosen.length) {
      searched++;
      if (
        resources.every((r) => sum[r] >= 0) &&
        resources.some((r) => sum[r] > 0)
      ) {
        witnesses.push({
          processes: chosen.map((i) => candidates[i].id),
          net: { ...sum },
        });
        return;
      }
    }
    if (chosen.length === 4 || searched >= max || witnesses.length >= 20)
      return;
    for (
      let i = start;
      i < candidates.length && searched < max && witnesses.length < 20;
      i++
    ) {
      const p = candidates[i];
      search(
        i,
        [...chosen, i],
        Object.fromEntries(
          resources.map((r) => [
            r,
            sum[r] + (p.outputs[r] ?? 0) - (p.inputs[r] ?? 0),
          ]),
        ),
      );
    }
  }
  search(0, [], Object.fromEntries(resources.map((r) => [r, 0])));
  return {
    claim_type: "MODEL_RESULT",
    expected_unconstrained_net_per_tick: net,
    free_sources: freeSources,
    gain_witnesses: witnesses,
    searched_combinations: searched,
    limitations: [
      "Net rates ignore availability. Witnesses use at most four firings and deterministic rules; require seed stock and feasible scheduling. Legitimate sources are not automatically exploits. Absence of witnesses does not prove absence of arbitrage.",
    ],
  };
}
export function compare(input: unknown, seeds: number[]) {
  ensure(
    seeds.length > 0 && seeds.length <= 100,
    "LIMIT",
    "1–100 seeds required",
  );
  const m = Model.parse(input);
  ensure(
    m.steps * m.processes.reduce((s, p) => s + p.limit, 0) * seeds.length <=
      2_000_000,
    "LIMIT",
    "Batch work budget exceeded",
  );
  const results = seeds.map((seed) => simulate({ ...m, seed }));
  return {
    claim_type: "MODEL_RESULT",
    runs: results.map((r) => ({
      seed: r.seed,
      final: r.final,
      violations: r.violations,
    })),
    summary: Object.fromEntries(
      Object.keys(m.initial).map((k) => {
        const xs = results.map((r) => r.final[k]);
        return [
          k,
          {
            min: Math.min(...xs),
            max: Math.max(...xs),
            mean: xs.reduce((a, b) => a + b, 0) / xs.length,
          },
        ];
      }),
    ),
    limitations: [
      "Descriptive Monte Carlo across supplied seeds; not an inference about real players.",
    ],
  };
}
export function sensitivity(
  input: unknown,
  processId: string,
  multipliers: number[],
) {
  const m = Model.parse(input);
  ensure(
    multipliers.length > 0 &&
      multipliers.length <= 20 &&
      multipliers.every((v) => Number.isFinite(v) && v >= 0 && v <= 100),
    "LIMIT",
    "Provide 1–20 finite multipliers in [0,100]",
  );
  ensure(
    m.processes.some((p) => p.id === processId),
    "NOT_FOUND",
    processId,
  );
  ensure(
    m.steps *
      m.processes.reduce((s, p) => s + p.limit, 0) *
      multipliers.length <=
      2_000_000,
    "LIMIT",
    "Sensitivity work budget exceeded",
  );
  return multipliers.map((multiplier) => {
    const result = simulate({
      ...m,
      processes: m.processes.map((p) =>
        p.id === processId
          ? {
              ...p,
              outputs: Object.fromEntries(
                Object.entries(p.outputs).map(([k, v]) => [k, v * multiplier]),
              ),
            }
          : p,
      ),
    });
    return { multiplier, final: result.final, violations: result.violations };
  });
}
