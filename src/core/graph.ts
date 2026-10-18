import { z } from "zod";
import { Graph, Rules } from "./schemas.js";
import { ensure } from "./errors.js";
export type DesignGraph = z.infer<typeof Graph>;
export function validateGraph(input: unknown) {
  const g = Graph.parse(input);
  const ids = new Set<string>();
  for (const n of g.nodes) {
    ensure(!ids.has(n.id), "DUPLICATE", n.id);
    ids.add(n.id);
  }
  const es = new Set<string>();
  for (const e of g.edges) {
    ensure(
      ids.has(e.from) && ids.has(e.to),
      "REFERENCE",
      `${e.from} → ${e.to}`,
    );
    const key = `${e.from}:${e.type}:${e.to}`;
    ensure(!es.has(key), "DUPLICATE", key);
    es.add(key);
  }
  const visit = new Set<string>(),
    active = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const e of g.edges.filter((e) =>
    ["DependsOn", "Requires"].includes(e.type),
  ))
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  function dfs(id: string) {
    ensure(!active.has(id), "DEPENDENCY_CYCLE", id);
    if (visit.has(id)) return;
    active.add(id);
    for (const n of adj.get(id) ?? []) dfs(n);
    active.delete(id);
    visit.add(id);
  }
  for (const n of ids) dfs(n);
  return g;
}
export function impact(input: unknown, id: string) {
  const g = validateGraph(input);
  ensure(
    g.nodes.some((n) => n.id === id),
    "NOT_FOUND",
    id,
  );
  const seen = new Set([id]);
  const queue = [id];
  const paths: Record<string, string[]> = { [id]: [id] };
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of g.edges) {
      const next = e.from === cur ? e.to : e.to === cur ? e.from : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
        paths[next] = [...paths[cur], next];
      }
    }
  }
  return {
    changed: id,
    affected: g.nodes.filter((n) => seen.has(n.id) && n.id !== id),
    paths,
    limitation:
      "Conservative undirected reachability; possible impact, not causal proof.",
  };
}
export function mermaid(input: unknown) {
  const g = validateGraph(input);
  const index = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  return [
    "graph LR",
    ...g.nodes.map(
      (n) => `${index.get(n.id)}["${n.label.replace(/["<>\[\]\r\n]/g, " ")}"]`,
    ),
    ...g.edges.map(
      (e) => `${index.get(e.from)} -->|${e.type}| ${index.get(e.to)}`,
    ),
  ].join("\n");
}
export function validateRules(input: unknown) {
  const r = Rules.parse(input);
  const states = new Set(r.states);
  ensure(states.size === r.states.length, "DUPLICATE", "Duplicate states");
  for (const id of [
    r.initial,
    ...r.terminal,
    ...r.transitions.flatMap((t) => [t.from, t.to]),
  ])
    ensure(states.has(id), "REFERENCE", id);
  const seen = new Set([r.initial]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of r.transitions)
      if (seen.has(t.from) && !seen.has(t.to)) {
        seen.add(t.to);
        changed = true;
      }
  }
  const canFinish = new Set(r.terminal);
  changed = true;
  while (changed) {
    changed = false;
    for (const t of r.transitions)
      if (canFinish.has(t.to) && !canFinish.has(t.from)) {
        canFinish.add(t.from);
        changed = true;
      }
  }
  return {
    claim_type: "MODEL_RESULT",
    reachable: [...seen],
    unreachable: r.states.filter((s) => !seen.has(s)),
    deadlocks: [...seen].filter(
      (s) =>
        !r.terminal.includes(s) && !r.transitions.some((t) => t.from === s),
    ),
    no_terminal_path: [...seen].filter((s) => !canFinish.has(s)),
    ambiguous_actions: r.transitions.filter((t, i, a) =>
      a.some(
        (u, j) =>
          i !== j &&
          t.from === u.from &&
          t.action === u.action &&
          t.to !== u.to,
      ),
    ),
    limitations: [
      "Finite transitions only; guards and code are not inferred. Cycles may be intentional.",
    ],
  };
}
