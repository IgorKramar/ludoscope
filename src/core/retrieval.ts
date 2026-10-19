/** Lexical normalization only: aliases aid RU/EN lookup and do not assert theoretical equivalence. */
const stopwords = new Set(
  "a an the and or to of in on for with from is are be this that how what it as by your game games я мы вы он она это как что для при по на в во и или а но с со из к до не без ли же бы у об от the".split(
    " ",
  ),
);
const aliases: Record<string, string> = {
  голод: "hunger",
  пища: "food",
  еда: "food",
  автоматизация: "automation",
  выбор: "choice",
  решения: "decision",
  решение: "decision",
  переживания: "experience",
  переживание: "experience",
  опыт: "experience",
  эмоции: "emotion",
  эмоция: "emotion",
  обучение: "learning",
  освоение: "mastery",
  мастерство: "mastery",
  нарратив: "narrative",
  повествование: "narrative",
  экономика: "economy",
  производство: "production",
  случайность: "chance",
  риск: "risk",
  неопределенность: "uncertainty",
  интерфейс: "interface",
  головоломка: "puzzle",
  головоломки: "puzzle",
  доступность: "accessibility",
  прогрессия: "progression",
  прототип: "prototype",
  прототипирование: "prototyping",
  плейтест: "playtest",
  исследование: "research",
  агентность: "agency",
  свобода: "agency",
  награда: "reward",
  награды: "reward",
  обратная_связь: "feedback",
  "обратная связь": "feedback",
  вариативность: "variation",
  depth: "depth",
  глубина: "depth",
  сложность: "complexity",
  feedback: "feedback",
  decisions: "decision",
  choices: "choice",
  rules: "rule",
  systems: "system",
  mechanics: "mechanic",
  resources: "resource",
  emotions: "emotion",
  experiences: "experience",
  players: "player",
  patterns: "pattern",
  паттерн: "pattern",
  паттерны: "pattern",
  скука: "boredom",
  повторение: "repetition",
  перенос: "transfer",
  ресурсы: "resource",
  правила: "rule",
  механики: "mechanic",
  системы: "system",
  игрок: "player",
};
export function normalizeTag(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  if (aliases[normalized]) return aliases[normalized];
  if (/^голод[а-я]*$/.test(normalized)) return "hunger";
  if (/^автоматизаци[а-я]*$/.test(normalized)) return "automation";
  if (/^ресурс[а-я]*$/.test(normalized)) return "resource";
  return normalized;
}
export function terms(value: string) {
  return [
    ...new Set(
      (
        value
          .normalize("NFKC")
          .toLowerCase()
          .replace(/ё/g, "е")
          .replace(/обратн(?:ая|ой|ую)\s+связ(?:ь|и|ью)/g, "feedback")
          .match(/[\p{L}\p{N}]+/gu) ?? []
      )
        .filter((t) => t.length > 1 && !stopwords.has(t))
        .map(normalizeTag),
    ),
  ];
}
export function metadataMatches(values: string[], actual: string[]) {
  const a = new Set(actual.map(normalizeTag));
  return values.filter((v) => a.has(normalizeTag(v)));
}
