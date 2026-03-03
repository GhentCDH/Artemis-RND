// $lib/artemis/map/mapInit.ts
import maplibregl from "maplibre-gl";

let map: maplibregl.Map | null = null;

export function ensureMapContext(container: HTMLElement): maplibregl.Map {
  if (map) return map;

  map = new maplibregl.Map({
    container,
    style: "https://demotiles.maplibre.org/style.json",
    center: [4.35, 50.85],
    zoom: 12
  });

  // Resize once style is loaded (helps when container size settles after layout mount)
  map.once("load", () => {
    try {
      map?.resize();
    } catch {
      // ignore
    }
  });

  return map;
}

export function destroyMapContext() {
  map?.remove();
  map = null;
}

export function getMapContext(): maplibregl.Map {
  if (!map) throw new Error("Map context not initialized");
  return map;
}