import type maplibregl from "maplibre-gl";

export type GrSpriteCanvas = {
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
};

export type GrSpriteManifest = {
  spriteSheet: string;
  canvases: Record<string, GrSpriteCanvas>;
};

export type GrPlaceholderEntry = {
  sourceId: string;
  layerId: string;
  blobUrl: string;
};

let sheetCache: Map<string, Promise<HTMLImageElement>> = new Map();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = sheetCache.get(url);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  sheetCache.set(url, p);
  return p;
}

async function cropSpriteRegion(sheet: HTMLImageElement, x: number, y: number, w: number, h: number): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.drawImage(sheet, x, y, w, h, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/webp" });
  return URL.createObjectURL(blob);
}

export function grPlaceholderSourceId(groupId: string, canvasId: string): string {
  return `gr-ph-src-${groupId}-${canvasId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function grPlaceholderLayerId(groupId: string, canvasId: string): string {
  return `gr-ph-lyr-${groupId}-${canvasId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export async function addGrSpritePlaceholders(
  map: maplibregl.Map,
  manifest: GrSpriteManifest,
  sheetAbsoluteUrl: string,
  groupId: string,
  opacity = 0.85
): Promise<Map<string, GrPlaceholderEntry>> {
  const result = new Map<string, GrPlaceholderEntry>();
  let sheet: HTMLImageElement;
  try {
    sheet = await loadImage(sheetAbsoluteUrl);
  } catch {
    return result;
  }

  await Promise.all(
    Object.entries(manifest.canvases).map(async ([canvasId, canvas]) => {
      let blobUrl: string;
      try {
        blobUrl = await cropSpriteRegion(sheet, canvas.x, canvas.y, canvas.width, canvas.height);
      } catch {
        return;
      }

      const sourceId = grPlaceholderSourceId(groupId, canvasId);
      const layerId = grPlaceholderLayerId(groupId, canvasId);

      try {
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: "image",
            url: blobUrl,
            coordinates: canvas.coordinates,
          });
        }
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: { "raster-opacity": opacity },
          });
        }
        result.set(canvasId, { sourceId, layerId, blobUrl });
      } catch {
        URL.revokeObjectURL(blobUrl);
      }
    })
  );

  return result;
}

export function removeGrSpritePlaceholder(map: maplibregl.Map, entry: GrPlaceholderEntry): void {
  try {
    if (map.getLayer(entry.layerId)) map.removeLayer(entry.layerId);
  } catch { /* ignore */ }
  try {
    if (map.getSource(entry.sourceId)) map.removeSource(entry.sourceId);
  } catch { /* ignore */ }
  URL.revokeObjectURL(entry.blobUrl);
}

export function removeAllGrSpritePlaceholders(map: maplibregl.Map, placeholders: Map<string, GrPlaceholderEntry>): void {
  for (const entry of placeholders.values()) {
    removeGrSpritePlaceholder(map, entry);
  }
  placeholders.clear();
}

export function resetGrSpritePlaceholderCache(): void {
  sheetCache.clear();
}
