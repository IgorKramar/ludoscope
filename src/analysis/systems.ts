import { validateGraph, type DesignGraph } from "../core/graph.js";
export function analyseSystems(input: unknown) {
  const g = validateGraph(input),
    adj = new Map<string, string[]>();
  for (const e of g.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  let next = 0;
  const indices = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>(),
    components: string[][] = [];
  function visit(v: string) {
    indices.set(v, next);
    low.set(v, next++);
    stack.push(v);
    active.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (active.has(w))
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
    }
    if (low.get(v) === indices.get(v)) {
      const c: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        active.delete(w);
        c.push(w);
      } while (w !== v);
      components.push(c);
    }
  }
  for (const n of g.nodes) if (!indices.has(n.id)) visit(n.id);
  const loops = components
    .filter(
      (c) =>
        c.length > 1 || g.edges.some((e) => e.from === c[0] && e.to === c[0]),
    )
    .map((nodes) => ({
      nodes,
      edges: g.edges.filter(
        (e) => nodes.includes(e.from) && nodes.includes(e.to),
      ),
      claim_type: "EXPERT_INFERENCE",
      interpretation:
        "Potential feedback component. Signs, delays, conditions and magnitude require a formal model.",
    }));
  const chains: string[][] = [];
  for (const n of g.nodes) {
    if (chains.length >= 200) break;
    const queue = [[n.id]];
    while (queue.length && chains.length < 200) {
      const p = queue.shift()!;
      if (p.length >= 3) chains.push(p);
      if (p.length >= 5) continue;
      for (const w of adj.get(p[p.length - 1]) ?? [])
        if (!p.includes(w) && queue.length < 1000) queue.push([...p, w]);
    }
  }
  return {
    feedback_components: loops,
    interaction_chains: chains,
    experience_links: g.edges.filter(
      (e) => g.nodes.find((n) => n.id === e.to)?.type === "ExperienceGoal",
    ),
    scenario_tasks: [
      "Указать условия запуска цепочки и наблюдаемые последствия.",
      "Формализовать ресурсные правила или переходы состояния.",
      "Сравнить сценарии с отключением одного взаимодействия.",
      "Проверить читаемость последствий реальными игроками.",
    ],
    limitations: [
      "Graph topology identifies possible interactions, not observed emergence or causality. Chains limited to 200 paths of at most five nodes.",
    ],
  };
}
