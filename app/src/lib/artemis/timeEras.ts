// Historical map eras — drives the time slider UI.
// Each zone maps a year range to a specific data layer (WMTS or IIIF).

export type HistCartKey = "ferraris" | "vandermaelen";

export type TimeZone = {
  id: string;
  label: string;
  yearStart: number;
  yearEnd: number;
  type: "wmts" | "iiif";
  // WMTS zones
  wmtsKey?: HistCartKey;
  // IIIF zones — case-insensitive substring matched against sourceCollectionLabel
  iiifLabelMatch?: string;
  // WMTS layer shown alongside this zone (e.g. Vandermaelen 1846 alongside Gereduceerd)
  companionWmtsKey?: HistCartKey;
  color: string;
};

export const YEAR_MIN = 1760;
export const YEAR_MAX = 1860;

// Zones ordered chronologically. Vandermaelen (1846) is a companion to Gereduceerd
// rather than its own zone — they are contemporaneous.
export const TIME_ZONES: TimeZone[] = [
  {
    id: "ferraris",
    label: "Ferraris",
    yearStart: 1769,
    yearEnd: 1778,
    type: "wmts",
    wmtsKey: "ferraris",
    color: "#c0392b",
  },
  {
    id: "primitief",
    label: "Primitief Kadaster",
    yearStart: 1806,
    yearEnd: 1834,
    type: "iiif",
    iiifLabelMatch: "primitief",
    color: "#2980b9",
  },
  {
    id: "gereduceerd",
    label: "Gereduceerd Kadaster",
    yearStart: 1845,
    yearEnd: 1855,
    type: "iiif",
    iiifLabelMatch: "gereduceerd",
    color: "#27ae60",
    companionWmtsKey: "vandermaelen",
  },
];

export function getActiveZone(year: number): TimeZone | null {
  return TIME_ZONES.find((z) => year >= z.yearStart && year <= z.yearEnd) ?? null;
}

export function yearToPercent(year: number): number {
  return ((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
}

export function eraRepresentativeYear(zone: TimeZone): number {
  return Math.round((zone.yearStart + zone.yearEnd) / 2);
}

// Builds the CSS linear-gradient for the slider track, with colored bands per zone.
export function buildSliderGradient(): string {
  const range = YEAR_MAX - YEAR_MIN;
  const GAP = "#d5d5d5";
  const sorted = [...TIME_ZONES].sort((a, b) => a.yearStart - b.yearStart);
  const stops: string[] = [];
  let prev = 0;

  for (const zone of sorted) {
    const s = ((zone.yearStart - YEAR_MIN) / range) * 100;
    const e = ((zone.yearEnd - YEAR_MIN) / range) * 100;
    if (s > prev + 0.01) stops.push(`${GAP} ${prev.toFixed(2)}%`, `${GAP} ${s.toFixed(2)}%`);
    stops.push(`${zone.color} ${s.toFixed(2)}%`, `${zone.color} ${e.toFixed(2)}%`);
    prev = e;
  }

  if (prev < 99.99) stops.push(`${GAP} ${prev.toFixed(2)}%`, `${GAP} 100%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
