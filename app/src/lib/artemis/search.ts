// Text search scoring — used for both toponym and manifest search.

export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Returns a score > 0 if the query matches, -1 if no match.
// Higher scores indicate better matches (exact > prefix > contains).
export function scoreText(
  rawText: string,
  normalizedText: string,
  queryRaw: string,
  queryNorm: string
): number {
  const rawLower = rawText.toLowerCase();
  const queryLower = queryRaw.toLowerCase();
  let score = -1;
  if (normalizedText === queryNorm) score = 500;
  else if (rawLower === queryLower) score = 450;
  else if (normalizedText.startsWith(queryNorm)) score = 300;
  else if (rawLower.startsWith(queryLower)) score = 260;
  else if (normalizedText.includes(queryNorm)) score = 180;
  else if (rawLower.includes(queryLower)) score = 140;
  else return -1;
  score -= Math.abs(normalizedText.length - queryNorm.length);
  return score;
}
