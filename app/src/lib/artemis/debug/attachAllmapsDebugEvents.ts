import type maplibregl from "maplibre-gl";

export function attachAllmapsDebugEvents(
  map: maplibregl.Map,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void
) {
  map.on("maperror", (e: any) => {
    const msg = e?.error?.message ?? e?.message ?? String(e);
    log("ERROR", `maperror: ${msg}`);
  });

  map.on("error", (e: any) => {
    log("ERROR", `MapLibre: ${e?.error?.message ?? String(e)}`);
  });

  map.on("webglcontextlost", () => log("ERROR", "WebGL context lost"));
}
