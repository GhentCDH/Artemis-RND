// Toponym normalization — converts raw API responses to normalized items.

import type { RawToponymIndexItem, ToponymIndexItem } from "$lib/artemis/types";
import { asFiniteNumber } from "$lib/artemis/utils";
import { normalizeSearchText } from "$lib/artemis/search";

function centroidFromBounds(bounds: unknown): [number, number] | null {
  if (!Array.isArray(bounds) || bounds.length < 4) return null;
  const [minX, minY, maxX, maxY] = (bounds as unknown[]).map(asFiniteNumber);
  if (minX === null || minY === null || maxX === null || maxY === null) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function extractPositionsFromGeometry(geometry: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      if (Number.isFinite(node[0]) && Number.isFinite(node[1])) {
        out.push([node[0] as number, node[1] as number]);
      }
      return;
    }
    for (const child of node) walk(child);
  };
  walk((geometry as any)?.coordinates);
  return out;
}

function centroidFromGeometry(geometry: unknown): [number, number] | null {
  const positions = extractPositionsFromGeometry(geometry);
  if (positions.length < 1) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of positions) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export function normalizeRawToponym(raw: RawToponymIndexItem): ToponymIndexItem | null {
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) return null;

  const sourceFile = typeof raw?.sourceFile === "string" ? raw.sourceFile : "";
  const sourceGroup =
    typeof raw?.sourceGroup === "string" && raw.sourceGroup.trim()
      ? raw.sourceGroup
      : sourceFile.split("/")[0] || "Unknown";
  const mapName =
    typeof raw?.mapName === "string" && raw.mapName.trim()
      ? raw.mapName
      : sourceGroup;
  const mapId =
    typeof raw?.mapId === "string" && raw.mapId.trim()
      ? raw.mapId
      : sourceGroup.toLowerCase();

  let lon = asFiniteNumber(raw?.lon);
  let lat = asFiniteNumber(raw?.lat);
  if ((lon === null || lat === null) && Array.isArray(raw?.centroid) && raw.centroid.length >= 2) {
    lon = asFiniteNumber(raw.centroid[0]);
    lat = asFiniteNumber(raw.centroid[1]);
  }
  if (lon === null || lat === null) {
    const c = centroidFromBounds(raw?.bounds);
    if (c) { lon = c[0]; lat = c[1]; }
  }
  if (lon === null || lat === null) {
    const c = centroidFromGeometry(raw?.geometry);
    if (c) { lon = c[0]; lat = c[1]; }
  }
  if (lon === null || lat === null) return null;

  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id
        : `${sourceFile}:${Number.isFinite(raw.featureIndex) ? Number(raw.featureIndex) : 0}:${text}`,
    text,
    textNormalized:
      typeof raw.textNormalized === "string" && raw.textNormalized.trim()
        ? raw.textNormalized
        : normalizeSearchText(text),
    sourceGroup,
    sourceFile,
    mapName,
    mapId,
    featureIndex: Number.isFinite(raw.featureIndex) ? Number(raw.featureIndex) : 0,
    lon,
    lat
  };
}
