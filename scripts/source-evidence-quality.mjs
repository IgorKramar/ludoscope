/** Readability guard for private extracted pages. Heuristic only: neither OCR accuracy nor semantic support is proven. */
export function assertSubstantivePages(pages, citedPages) {
  if (!Array.isArray(pages) || !Array.isArray(citedPages) || !citedPages.length)
    throw new Error("Page corpus and at least one cited page are required");
  const lines = pages.map((page) =>
    typeof page === "string"
      ? page
          .split(/\r?\n/)
          .map((line) =>
            line.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "),
          )
          .filter(Boolean)
      : [],
  );
  const nonempty = lines.filter((ls) => ls.length).length;
  const frequency = new Map();
  for (const ls of lines)
    for (const line of new Set(ls))
      frequency.set(line, (frequency.get(line) ?? 0) + 1);
  const boilerplate = new Set(
    [...frequency]
      .filter(([, n]) => n >= 2 && n >= Math.ceil(nonempty * 0.6))
      .map(([line]) => line),
  );
  const checked = [...new Set(citedPages)];
  let removed = 0;
  for (const page of checked) {
    if (!Number.isInteger(page) || page < 1 || page > pages.length)
      throw new Error("Cited page outside supplied corpus");
    const body = lines[page - 1]
      .filter((line) => {
        if (boilerplate.has(line)) {
          removed++;
          return false;
        }
        return true;
      })
      .join(" ");
    const words = body.match(/[\p{L}]{2,}/gu) ?? [];
    if ((body.match(/\p{L}/gu) ?? []).length < 60 || new Set(words).size < 12)
      throw new Error(
        `Insufficient substantive text on PDF page ${page}; inspect the source image or redo extraction`,
      );
  }
  return { checked_pages: checked.length, excluded_repeated_lines: removed };
}
