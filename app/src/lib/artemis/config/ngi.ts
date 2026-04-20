const NGI_WMTS_ORIGIN = "https://wmts.ngi.be";
const NGI_DEV_PROXY_PREFIX = "/ngi-proxy";

function ngiBaseOrigin(): string {
  return import.meta.env.DEV ? NGI_DEV_PROXY_PREFIX : NGI_WMTS_ORIGIN;
}

export function ngiTileUrl(servicePath: string): string {
  return `${ngiBaseOrigin()}${servicePath}/tile/{z}/{y}/{x}`;
}

