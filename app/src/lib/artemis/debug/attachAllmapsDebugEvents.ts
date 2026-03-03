// app/src/lib/artemis/debug/attachAllmapsDebugEvents.ts
import type maplibregl from "maplibre-gl";

function extractMapIds(e: any): string[] {
  const direct = e?.mapIds ?? e?.data?.mapIds;
  if (Array.isArray(direct)) return direct.map(String);
  if (typeof direct === "string") return [direct];
  return [];
}

export function attachAllmapsDebugEvents(
  map: maplibregl.Map,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void
) {
  const logEvt = (name: string) => (e: any) => {
    const ids = extractMapIds(e);
    const tileUrl = e?.tileUrl ?? e?.data?.tileUrl ?? "";
    const extra = tileUrl ? ` tile=${tileUrl}` : "";
    log("INFO", `EVENT ${name} mapIds=${ids.join(",")}${extra}`);
  };

  map.on("georeferenceannotationadded", logEvt("georeferenceannotationadded"));
  map.on("warpedmapadded", logEvt("warpedmapadded"));
  map.on("imageloaded", logEvt("imageloaded"));
  map.on("maptileloaded", logEvt("maptileloaded"));
  map.on("maperror", (e: any) => {
    const ids = extractMapIds(e);
    const msg = e?.error?.message ?? e?.message ?? String(e);
    log("ERROR", `EVENT maperror mapIds=${ids.join(",")} msg=${msg}`);
  });

  map.on("error", (e: any) => {
    const msg = e?.error?.message ?? String(e);
    log("ERROR", `MapLibre error: ${msg}`);
  });

  map.on("webglcontextlost", () => log("ERROR", "MapLibre: WEBGL context lost"));
  map.on("webglcontextrestored", () => log("WARN", "MapLibre: WEBGL context restored"));
}