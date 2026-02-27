import maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { MapContext } from "./mapContext";
import { attachAllmapsDebugEvents } from "./mapEvents";

let ctx: MapContext | null = null;

export async function ensureMapContext(
  container: HTMLElement,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void
): Promise<MapContext> {
  if (ctx) return ctx;

  log("INFO", "Map: init");

  const map = new maplibregl.Map({
    container,
    style: "https://demotiles.maplibre.org/style.json",
    center: [4.35, 50.85],
    zoom: 10,
    maxPitch: 0
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  attachAllmapsDebugEvents(map, log);

  await new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      map.off("error", onErr);
      resolve();
    };
    const onErr = (e: any) => {
      map.off("load", onLoad);
      reject(e);
    };
    map.once("load", onLoad);
    map.once("error", onErr);
  });

  const warped = new WarpedMapLayer({ layerId: "warped-map-layer" });
  map.addLayer(warped as any);

  log("INFO", "Allmaps: WarpedMapLayer added");
  ctx = { map, warped };
  return ctx;
}

export function destroyMapContext() {
  try {
    ctx?.map.remove();
  } catch {
    // ignore
  } finally {
    ctx = null;
  }
}