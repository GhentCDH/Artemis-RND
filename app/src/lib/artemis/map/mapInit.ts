// $lib/artemis/map/mapInit.ts
import maplibregl from "maplibre-gl";

let map: maplibregl.Map | null = null;
type BaseMapTheme = "light" | "dark";
const mapThemeByInstance = new WeakMap<maplibregl.Map, BaseMapTheme>();

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

function wmtsTiles(layerName: string): string[] {
  const url =
    "https://geo.api.vlaanderen.be/HISTCART/wmts" +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerName}` +
    "&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL" +
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
  return [url];
}

// Land usage WMS overlay layers (rendered on top of the HISTCART WMTS base).
// These are colour-coded index layers from the INBO WMS service.
function wmsRasterTiles(baseUrl: string, layers: string): string[] {
  return [
    `${baseUrl}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
    `&LAYERS=${encodeURIComponent(layers)}&STYLES=` +
    `&FORMAT=image%2Fpng&TRANSPARENT=TRUE` +
    `&CRS=EPSG%3A3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256`
  ];
}

const LAND_USAGE_LAYERS: Record<
  HistCartLayerKey,
  { sourceId: string; layerId: string; tiles: string[] }
> = {
  ferraris: {
    sourceId: "landusage-ferraris-source",
    layerId:  "landusage-ferraris-layer",
    tiles: wmsRasterTiles("https://geo.api.vlaanderen.be/INBO/wms", "Lgbrk1778")
  },
  vandermaelen: {
    sourceId: "landusage-vandermaelen-source",
    layerId:  "landusage-vandermaelen-layer",
    tiles: wmsRasterTiles("https://geo.api.vlaanderen.be/inbo/wms", "B1850")
  }
};

const BELGIUM_BOUNDS: [number, number, number, number] = [2.53, 50.685, 5.92, 51.52];

const IIIF_HOVER_SOURCE_ID = "iiif-hover-mask-source";
const IIIF_HOVER_LINE_LAYER_ID = "iiif-hover-mask-line";

const PRIMITIVE_SOURCE_ID = "primitive-parcels-source";
const PRIMITIVE_FILL_LAYER_ID = "primitive-parcels-fill-layer";
const PRIMITIVE_LAYER_ID = "primitive-parcels-layer";
const PRIMITIVE_HOVER_SOURCE_ID = "primitive-parcels-hover-source";
const PRIMITIVE_HOVER_LAYER_ID = "primitive-parcels-hover-layer";
const PRIMITIVE_SELECT_SOURCE_ID = "primitive-parcels-select-source";
const PRIMITIVE_SELECT_FILL_LAYER_ID = "primitive-parcels-select-fill";
const PRIMITIVE_SELECT_LINE_LAYER_ID = "primitive-parcels-select-line";
const primitiveDebugDetachByMap = new WeakMap<maplibregl.Map, () => void>();

function firstWarpedLayerId(map: maplibregl.Map): string | undefined {
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  return layers.find((l) => l.id.startsWith("warped-layer-"))?.id;
}

export function createMapContext(container: HTMLElement): maplibregl.Map {
  return createMapContextWithTheme(container, "light");
}

export function getBaseMapStyleUrl(theme: BaseMapTheme): string {
  return theme === "dark"
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/positron";
}

export function createMapContextWithTheme(container: HTMLElement, theme: BaseMapTheme = "light"): maplibregl.Map {
  const nextMap = new maplibregl.Map({
    container,
    style: getBaseMapStyleUrl(theme),
    center: [4.23, 51.10], // Bornem, Scheldt valley
    zoom: 10,
    attributionControl: false
  });
  mapThemeByInstance.set(nextMap, theme);

  // Resize once style is loaded (helps when container size settles after layout mount)
  nextMap.once("load", () => {
    try {
      nextMap.resize();
    } catch {
      // ignore
    }
    ensureIiifHoverLayers(nextMap);
  });

  return nextMap;
}

export function setBaseMapTheme(targetMap: maplibregl.Map, theme: BaseMapTheme): boolean {
  if (mapThemeByInstance.get(targetMap) === theme) return false;
  targetMap.setStyle(getBaseMapStyleUrl(theme));
  mapThemeByInstance.set(targetMap, theme);
  return true;
}

export function destroyMapContextInstance(targetMap: maplibregl.Map | null | undefined) {
  targetMap?.remove();
}

export function ensureMapContext(container: HTMLElement, theme: BaseMapTheme = "light"): maplibregl.Map {
  if (map) return map;
  map = createMapContextWithTheme(container, theme);
  return map;
}

export function destroyMapContext() {
  destroyMapContextInstance(map);
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
        bounds: BELGIUM_BOUNDS
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

// ---------------------------------------------------------------------------
// Land usage WMS overlay layers (on top of HISTCART WMTS base)
// ---------------------------------------------------------------------------

export function setLandUsageLayerVisible(map: maplibregl.Map, key: HistCartLayerKey, visible: boolean): void {
  const cfg = LAND_USAGE_LAYERS[key];
  if (!cfg) return;
  const hasSource = !!map.getSource(cfg.sourceId);
  const hasLayer  = !!map.getLayer(cfg.layerId);
  if (visible) {
    if (!hasSource) {
      map.addSource(cfg.sourceId, {
        type: "raster",
        tiles: cfg.tiles,
        tileSize: 256,
        bounds: BELGIUM_BOUNDS
      });
    }
    if (!hasLayer) {
      map.addLayer({ id: cfg.layerId, type: "raster", source: cfg.sourceId, paint: { "raster-opacity": 1 } });
    }
    return;
  }
  if (hasLayer)  map.removeLayer(cfg.layerId);
  if (hasSource) map.removeSource(cfg.sourceId);
}

export function setLandUsageLayerOpacity(map: maplibregl.Map, key: HistCartLayerKey, opacity: number): void {
  const cfg = LAND_USAGE_LAYERS[key];
  if (!cfg || !map.getLayer(cfg.layerId)) return;
  map.setPaintProperty(cfg.layerId, "raster-opacity", Math.max(0, Math.min(1, opacity)));
}

export function getLandUsageLayerId(key: HistCartLayerKey): string {
  return LAND_USAGE_LAYERS[key].layerId;
}

function ensureIiifHoverLayers(m: maplibregl.Map): void {
  if (!m.getSource(IIIF_HOVER_SOURCE_ID)) {
    m.addSource(IIIF_HOVER_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
  }
  if (!m.getLayer(IIIF_HOVER_LINE_LAYER_ID)) {
    m.addLayer({
      id: IIIF_HOVER_LINE_LAYER_ID,
      type: "line",
      source: IIIF_HOVER_SOURCE_ID,
      paint: {
        "line-color": ["get", "lineColor"] as any,
        "line-width": 1.5,
        "line-opacity": 0.9
      }
    });
  }
}

export type IiifHoverMask = { ring: Array<[number, number]>; fillColor: string; lineColor: string };

export function setIiifHoverMasks(m: maplibregl.Map, masks: IiifHoverMask[] | null): void {
  const source = m.getSource(IIIF_HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  if (!masks || masks.length === 0) {
    source.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  const features = masks
    .filter(({ ring }) => ring.length >= 3)
    .map(({ ring, fillColor, lineColor }) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [[...ring, ring[0]]] },
      properties: { fillColor, lineColor }
    }));
  source.setData({ type: "FeatureCollection", features });
  try { if (m.getLayer(IIIF_HOVER_LINE_LAYER_ID)) m.moveLayer(IIIF_HOVER_LINE_LAYER_ID); } catch { /* ignore */ }
}

export function setPrimitiveLayerVisible(map: maplibregl.Map, visible: boolean, geojsonUrl: string): void {
  const hasSource = !!map.getSource(PRIMITIVE_SOURCE_ID);
  const hasHoverSource = !!map.getSource(PRIMITIVE_HOVER_SOURCE_ID);
  const hasFillLayer = !!map.getLayer(PRIMITIVE_FILL_LAYER_ID);
  const hasLayer = !!map.getLayer(PRIMITIVE_LAYER_ID);
  const hasHoverLayer = !!map.getLayer(PRIMITIVE_HOVER_LAYER_ID);
  console.debug(
    `[primitive] set visible=${visible} hasSource=${hasSource} hasHoverSource=${hasHoverSource} hasFillLayer=${hasFillLayer} hasLayer=${hasLayer} hasHoverLayer=${hasHoverLayer} url=${geojsonUrl}`
  );

  if (visible) {
    if (!hasSource) {
      attachPrimitiveDebugListeners(map, geojsonUrl);
      console.debug(`[primitive] addSource id=${PRIMITIVE_SOURCE_ID} data=${geojsonUrl}`);
      map.addSource(PRIMITIVE_SOURCE_ID, {
        type: "geojson",
        data: geojsonUrl
      });
    }
    if (!hasFillLayer) {
      console.debug(`[primitive] addLayer id=${PRIMITIVE_FILL_LAYER_ID} source=${PRIMITIVE_SOURCE_ID}`);
      map.addLayer({
        id: PRIMITIVE_FILL_LAYER_ID,
        type: "fill",
        source: PRIMITIVE_SOURCE_ID,
        filter: ["==", ["get", "type"], "parcel"],
        paint: {
          // Invisible pick layer: captures hover inside polygons.
          "fill-color": "#000000",
          "fill-opacity": 0.001
        }
      });
    }
    if (!hasLayer) {
      console.debug(`[primitive] addLayer id=${PRIMITIVE_LAYER_ID} source=${PRIMITIVE_SOURCE_ID}`);
      map.addLayer({
        id: PRIMITIVE_LAYER_ID,
        type: "line",
        source: PRIMITIVE_SOURCE_ID,
        filter: ["==", ["get", "type"], "parcel"],
        paint: {
          "line-color": "#C07B28",
          "line-width": 1.1,
          "line-opacity": 1
        }
      });
    }
    if (!hasHoverSource) {
      console.debug(`[primitive] addSource id=${PRIMITIVE_HOVER_SOURCE_ID} data=empty`);
      map.addSource(PRIMITIVE_HOVER_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }
    if (!hasHoverLayer) {
      console.debug(`[primitive] addLayer id=${PRIMITIVE_HOVER_LAYER_ID} source=${PRIMITIVE_HOVER_SOURCE_ID}`);
      map.addLayer({
        id: PRIMITIVE_HOVER_LAYER_ID,
        type: "fill",
        source: PRIMITIVE_HOVER_SOURCE_ID,
        paint: {
          "fill-color": "#ff6f00",
          "fill-opacity": 0.22
        }
      });
    }
    if (!map.getSource(PRIMITIVE_SELECT_SOURCE_ID)) {
      map.addSource(PRIMITIVE_SELECT_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }
    if (!map.getLayer(PRIMITIVE_SELECT_FILL_LAYER_ID)) {
      map.addLayer({
        id: PRIMITIVE_SELECT_FILL_LAYER_ID,
        type: "fill",
        source: PRIMITIVE_SELECT_SOURCE_ID,
        paint: {
          "fill-color": "#C07B28",
          "fill-opacity": 0.28
        }
      });
    }
    if (!map.getLayer(PRIMITIVE_SELECT_LINE_LAYER_ID)) {
      map.addLayer({
        id: PRIMITIVE_SELECT_LINE_LAYER_ID,
        type: "line",
        source: PRIMITIVE_SELECT_SOURCE_ID,
        paint: {
          "line-color": "#C07B28",
          "line-width": 2,
          "line-opacity": 1
        }
      });
    }
    return;
  }

  for (const id of [PRIMITIVE_SELECT_LINE_LAYER_ID, PRIMITIVE_SELECT_FILL_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(PRIMITIVE_SELECT_SOURCE_ID)) map.removeSource(PRIMITIVE_SELECT_SOURCE_ID);
  if (hasHoverLayer) {
    console.debug(`[primitive] removeLayer id=${PRIMITIVE_HOVER_LAYER_ID}`);
    map.removeLayer(PRIMITIVE_HOVER_LAYER_ID);
  }
  if (hasHoverSource) {
    console.debug(`[primitive] removeSource id=${PRIMITIVE_HOVER_SOURCE_ID}`);
    map.removeSource(PRIMITIVE_HOVER_SOURCE_ID);
  }
  if (hasFillLayer) {
    console.debug(`[primitive] removeLayer id=${PRIMITIVE_FILL_LAYER_ID}`);
    map.removeLayer(PRIMITIVE_FILL_LAYER_ID);
  }
  if (hasLayer) {
    console.debug(`[primitive] removeLayer id=${PRIMITIVE_LAYER_ID}`);
    map.removeLayer(PRIMITIVE_LAYER_ID);
  }
  if (hasSource) {
    const detach = primitiveDebugDetachByMap.get(map);
    if (detach) {
      detach();
      primitiveDebugDetachByMap.delete(map);
    }
    console.debug(`[primitive] removeSource id=${PRIMITIVE_SOURCE_ID}`);
    map.removeSource(PRIMITIVE_SOURCE_ID);
  }
}

export function setPrimitiveLayerOpacity(map: maplibregl.Map, opacity: number): void {
  if (!map.getLayer(PRIMITIVE_LAYER_ID)) return;
  const clamped = Math.max(0, Math.min(1, opacity));
  map.setPaintProperty(PRIMITIVE_LAYER_ID, "line-opacity", clamped);
}

export function isPrimitiveLayerVisible(map: maplibregl.Map): boolean {
  return !!map.getLayer(PRIMITIVE_LAYER_ID) || !!map.getLayer(PRIMITIVE_FILL_LAYER_ID);
}

export function getPrimitiveLayerIds(): string[] {
  return [PRIMITIVE_FILL_LAYER_ID, PRIMITIVE_LAYER_ID];
}

function renderedFeatureToPolygon(feature: any): { type: "Feature"; geometry: any; properties: Record<string, never> } | null {
  const geom = feature?.geometry;
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) return null;
  return { type: "Feature", geometry: geom, properties: {} };
}

export function setPrimitiveHoverFeature(map: maplibregl.Map, feature: any | null): void {
  const source = map.getSource(PRIMITIVE_HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  if (!feature) {
    source.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  const poly = renderedFeatureToPolygon(feature);
  if (!poly) return;
  source.setData({ type: "FeatureCollection", features: [poly] });
  try { if (map.getLayer(PRIMITIVE_HOVER_LAYER_ID)) map.moveLayer(PRIMITIVE_HOVER_LAYER_ID); } catch { /* ignore */ }
}

export function setPrimitiveSelectFeature(map: maplibregl.Map, feature: any | null): void {
  const source = map.getSource(PRIMITIVE_SELECT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  if (!feature) {
    source.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  const poly = renderedFeatureToPolygon(feature);
  if (!poly) return;
  source.setData({ type: "FeatureCollection", features: [poly] });
  try { if (map.getLayer(PRIMITIVE_SELECT_FILL_LAYER_ID)) map.moveLayer(PRIMITIVE_SELECT_FILL_LAYER_ID); } catch { /* ignore */ }
  try { if (map.getLayer(PRIMITIVE_SELECT_LINE_LAYER_ID)) map.moveLayer(PRIMITIVE_SELECT_LINE_LAYER_ID); } catch { /* ignore */ }
}

function attachPrimitiveDebugListeners(map: maplibregl.Map, geojsonUrl: string): void {
  if (primitiveDebugDetachByMap.has(map)) return;

  let started = false;
  let loaded = false;

  const onSourceDataLoading = (e: any) => {
    if (e?.sourceId !== PRIMITIVE_SOURCE_ID) return;
    if (started) return;
    started = true;
    console.debug(`[primitive] source loading start source=${PRIMITIVE_SOURCE_ID} url=${geojsonUrl}`);
  };

  const onSourceData = (e: any) => {
    if (e?.sourceId !== PRIMITIVE_SOURCE_ID) return;
    if (loaded) return;
    if (e?.isSourceLoaded !== true) return;
    loaded = true;
    const sourceFeatures = map.querySourceFeatures(PRIMITIVE_SOURCE_ID);
    const featureCount = sourceFeatures.length;
    let parcelCount = 0;
    let textCount = 0;
    for (const feature of sourceFeatures) {
      const type = feature?.properties?.type;
      if (type === "parcel") parcelCount++;
      else if (type === "text") textCount++;
    }
    console.debug(
      `[primitive] source loaded source=${PRIMITIVE_SOURCE_ID} featureCount=${featureCount} parcels=${parcelCount} text=${textCount} url=${geojsonUrl}`
    );
  };

  const onError = (e: any) => {
    const sourceId = e?.sourceId;
    const sourceMatches = sourceId === PRIMITIVE_SOURCE_ID;
    const message = e?.error?.message ?? e?.error ?? e?.message ?? "unknown error";
    if (!sourceMatches && !String(message).includes(PRIMITIVE_SOURCE_ID)) return;
    console.error(`[primitive] source/layer error source=${sourceId ?? "unknown"} msg=${String(message)}`);
  };

  map.on("sourcedataloading", onSourceDataLoading);
  map.on("sourcedata", onSourceData);
  map.on("error", onError);

  primitiveDebugDetachByMap.set(map, () => {
    map.off("sourcedataloading", onSourceDataLoading);
    map.off("sourcedata", onSourceData);
    map.off("error", onError);
  });
}

// ─── Massart photo pins ───────────────────────────────────────────────────────

import type { MassartItem } from "$lib/artemis/types";

const MASSART_SOURCE_ID = "massart-pins-source";
const MASSART_LAYER_INACTIVE = "massart-pins-inactive";
const MASSART_LAYER_ACTIVE   = "massart-pins-active";
const MASSART_ICON_INACTIVE = "massart-photo-icon-inactive";
const MASSART_ICON_ACTIVE = "massart-photo-icon-active";

function makeMassartIcon(size: number, accent: string): ImageData | null {
  if (typeof document === "undefined") return null;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, size, size);

  const radius = 4;
  const x = 1.5;
  const y = 2;
  const w = size - 3;
  const h = size - 4;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(x + 1.4, y + 1.3, w - 2.8, h - 2.8, radius - 1);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + 5.2, y + 4.8, 1.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + 3.2, y + h - 3.2);
  ctx.lineTo(x + 7.1, y + 8.9);
  ctx.lineTo(x + 9.8, y + 11.3);
  ctx.lineTo(x + 12.7, y + 7.9);
  ctx.lineTo(x + w - 2.6, y + h - 3.2);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureMassartIcons(map: maplibregl.Map): void {
  if (!map.hasImage(MASSART_ICON_INACTIVE)) {
    const inactive = makeMassartIcon(18, "#D4A84B");
    if (inactive) map.addImage(MASSART_ICON_INACTIVE, inactive, { pixelRatio: 2 });
  }
  if (!map.hasImage(MASSART_ICON_ACTIVE)) {
    const active = makeMassartIcon(22, "#F59E0B");
    if (active) map.addImage(MASSART_ICON_ACTIVE, active, { pixelRatio: 2 });
  }
}

function massartGeoJSON(items: MassartItem[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items
      .filter((i) => i.lat != null && i.lon != null)
      .map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lon!, i.lat!] },
        properties: {
          year: parseInt(i.year ?? "0", 10),
          title: i.title,
          location: i.location ?? "",
          manifestUrl: i.manifestUrl,
        },
      })),
  };
}

function massartActiveFilter(year: number, leeway: number): maplibregl.FilterSpecification {
  return ["<=", ["abs", ["-", ["get", "year"], year]], leeway] as maplibregl.FilterSpecification;
}

function massartInactiveFilter(year: number, leeway: number): maplibregl.FilterSpecification {
  return [">", ["abs", ["-", ["get", "year"], year]], leeway] as maplibregl.FilterSpecification;
}

export function setMassartPins(
  map: maplibregl.Map,
  items: MassartItem[],
  year: number,
  leeway: number
): void {
  ensureMassartIcons(map);
  const data = massartGeoJSON(items);

  if (map.getSource(MASSART_SOURCE_ID)) {
    (map.getSource(MASSART_SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(MASSART_SOURCE_ID, { type: "geojson", data });
  }

  if (!map.getLayer(MASSART_LAYER_INACTIVE)) {
    map.addLayer({
      id: MASSART_LAYER_INACTIVE,
      type: "symbol",
      source: MASSART_SOURCE_ID,
      filter: massartInactiveFilter(year, leeway),
      layout: {
        "icon-image": MASSART_ICON_INACTIVE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 0.42,
      }
    });
  }

  if (!map.getLayer(MASSART_LAYER_ACTIVE)) {
    map.addLayer({
      id: MASSART_LAYER_ACTIVE,
      type: "symbol",
      source: MASSART_SOURCE_ID,
      filter: massartActiveFilter(year, leeway),
      layout: {
        "icon-image": MASSART_ICON_ACTIVE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 1,
      }
    });
  }

  updateMassartActiveYear(map, year, leeway);
}

export function updateMassartActiveYear(
  map: maplibregl.Map,
  year: number,
  leeway: number
): void {
  if (!map.getSource(MASSART_SOURCE_ID)) return;
  if (map.getLayer(MASSART_LAYER_ACTIVE))
    map.setFilter(MASSART_LAYER_ACTIVE, massartActiveFilter(year, leeway));
  if (map.getLayer(MASSART_LAYER_INACTIVE))
    map.setFilter(MASSART_LAYER_INACTIVE, massartInactiveFilter(year, leeway));
}

export function getMassartClickLayerIds(): string[] {
  // Only the active-year pin layer should be interactive.
  return [MASSART_LAYER_ACTIVE];
}
