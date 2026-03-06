// $lib/artemis/map/mapInit.ts
import maplibregl from "maplibre-gl";

let map: maplibregl.Map | null = null;

type HistCartLayerKey = "ferraris" | "vandermaelen";

const HISTCART_LAYERS: Record<
  HistCartLayerKey,
  { sourceId: string; layerId: string; layerName: string }
> = {
  ferraris: {
    sourceId: "histcart-ferraris-source",
    layerId: "histcart-ferraris-layer",
    layerName: "ferraris"
  },
  vandermaelen: {
    sourceId: "histcart-vandermaelen-source",
    layerId: "histcart-vandermaelen-layer",
    layerName: "vandermaelen"
  }
};

const PRIMITIVE_SOURCE_ID = "primitive-parcels-source";
const PRIMITIVE_LAYER_ID = "primitive-parcels-layer";

function wmtsTiles(layerName: string): string[] {
  const url =
    "https://geo.api.vlaanderen.be/HISTCART/wmts" +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerName}` +
    "&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL" +
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  return [url];
}

function firstWarpedLayerId(map: maplibregl.Map): string | undefined {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  return layers.find((l) => l.id.startsWith("warped-layer-"))?.id;
}

export function ensureMapContext(container: HTMLElement): maplibregl.Map {
  if (map) return map;

  map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [4.23, 51.10], // Bornem, Scheldt valley
    zoom: 10
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

export function setHistCartLayerVisible(map: maplibregl.Map, key: HistCartLayerKey, visible: boolean): void {
  const cfg = HISTCART_LAYERS[key];
  if (!cfg) return;

  const hasSource = !!map.getSource(cfg.sourceId);
  const hasLayer = !!map.getLayer(cfg.layerId);
  if (visible) {
    if (!hasSource) {
      map.addSource(cfg.sourceId, {
        type: "raster",
        tiles: wmtsTiles(cfg.layerName),
        tileSize: 256,
        bounds: [2.53, 50.685, 5.92, 51.52]
      });
    }
    if (!hasLayer) {
      const beforeId = firstWarpedLayerId(map);
      map.addLayer(
        {
          id: cfg.layerId,
          type: "raster",
          source: cfg.sourceId,
          paint: { "raster-opacity": 1 }
        },
        beforeId
      );
    }
    return;
  }

  if (hasLayer) map.removeLayer(cfg.layerId);
  if (hasSource) map.removeSource(cfg.sourceId);
}

export function isHistCartLayerVisible(map: maplibregl.Map, key: HistCartLayerKey): boolean {
  const cfg = HISTCART_LAYERS[key];
  return !!(cfg && map.getLayer(cfg.layerId));
}

export function setHistCartLayerOpacity(map: maplibregl.Map, key: HistCartLayerKey, opacity: number): void {
  const cfg = HISTCART_LAYERS[key];
  if (!cfg || !map.getLayer(cfg.layerId)) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  map.setPaintProperty(cfg.layerId, "raster-opacity", clamped);
}

export function moveHistCartLayerToTop(map: maplibregl.Map, key: HistCartLayerKey): void {
  const cfg = HISTCART_LAYERS[key];
  if (!cfg || !map.getLayer(cfg.layerId)) return;
  map.moveLayer(cfg.layerId);
}

export function setPrimitiveLayerVisible(map: maplibregl.Map, visible: boolean, geojsonUrl: string): void {
  const hasSource = !!map.getSource(PRIMITIVE_SOURCE_ID);
  const hasLayer = !!map.getLayer(PRIMITIVE_LAYER_ID);

  if (visible) {
    if (!hasSource) {
      map.addSource(PRIMITIVE_SOURCE_ID, {
        type: "geojson",
        data: geojsonUrl
      });
    }
    if (!hasLayer) {
      map.addLayer({
        id: PRIMITIVE_LAYER_ID,
        type: "line",
        source: PRIMITIVE_SOURCE_ID,
        paint: {
          "line-color": "#bf360c",
          "line-width": 1.1,
          "line-opacity": 1
        }
      });
    }
    return;
  }

  if (hasLayer) map.removeLayer(PRIMITIVE_LAYER_ID);
  if (hasSource) map.removeSource(PRIMITIVE_SOURCE_ID);
}

export function setPrimitiveLayerOpacity(map: maplibregl.Map, opacity: number): void {
  if (!map.getLayer(PRIMITIVE_LAYER_ID)) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  map.setPaintProperty(PRIMITIVE_LAYER_ID, "line-opacity", clamped);
}

export function isPrimitiveLayerVisible(map: maplibregl.Map): boolean {
  return !!map.getLayer(PRIMITIVE_LAYER_ID);
}

export function getPrimitiveLayerIds(): string[] {
  return [PRIMITIVE_LAYER_ID];
}
