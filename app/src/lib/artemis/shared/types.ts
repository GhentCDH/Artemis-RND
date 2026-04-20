export type StepTiming = {
  step: string;
  ms: number;
  ok: boolean;
  detail?: string;
};

export type RunResult = {
  manifestUrl: string;
  manifestLabel?: string;
  sourceManifestUrl?: string;
  allmapsManifestUrl?: string;
  annotationUrl?: string;
  startedAtISO: string;
  totalMs: number;
  steps: StepTiming[];
  ok: boolean;
  annotationErrorCount?: number;
  annotationErrors?: string[];
  error?: string;
};

export type UILog = {
  atISO: string;
  level: "INFO" | "WARN" | "ERROR";
  msg: string;
};

// --- Toponym & search types ---

export type ToponymIndexItem = {
  id: string;
  text: string;
  textNormalized?: string;
  sourceGroup: string;
  sourceFile: string;
  mapId: string;
  mapName: string;
  featureIndex: number;
  lon: number;
  lat: number;
};

export type RawToponymIndexItem = {
  id?: string;
  text?: string;
  textNormalized?: string;
  sourceGroup?: string;
  sourceFile?: string;
  mapId?: string;
  mapName?: string;
  featureIndex?: number;
  lon?: number;
  lat?: number;
  centroid?: [number, number];
  bounds?: [number, number, number, number];
  geometry?: unknown;
};

export type ManifestSearchItem = {
  id: string;
  label: string;
  text: string;
  textNormalized: string;
  mapName: string;
  sourceManifestUrl: string;
  compiledManifestPath: string;
  centerLon?: number;
  centerLat?: number;
};

// --- UI panel types ---

export type IiifMapInfo = {
  title: string;
  sourceManifestUrl: string;
  imageServiceUrl?: string;
  manifestAllmapsUrl?: string;
  layerLabel?: string;
  layerColor?: string;
  centerLon?: number;
  centerLat?: number;
  mainId?: string;
};

export type SpriteRef = {
  sheetUrl: string;
  sheetWidth: number;
  sheetHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PreviewBubbleItem = {
  title: string;
  manifestUrl: string;
  imageServiceUrl?: string;
  alternatives?: PreviewBubbleItem[];
  year?: string;
  location?: string;
  kicker?: string;
  lat?: number;
  lon?: number;
  spriteRef?: SpriteRef;
};

export type ParcelClickInfo = {
  parcelLabel: string;
  leafId: string;
  properties: Record<string, any>;
  lon: number;
  lat: number;
};

export type IiifPanelGroup = {
  layerLabel: string;
  layerColor: string;
  items: IiifMapInfo[];
};

export type PinnedCard =
  | { type: 'iiif'; group: IiifPanelGroup }
  | { type: 'parcel'; info: ParcelClickInfo };

export type MassartItem = {
  title: string;
  year?: string;
  location?: string;
  lat?: number;
  lon?: number;
  manifestUrl: string;
  mmsId: string;
  repId: string;
};
