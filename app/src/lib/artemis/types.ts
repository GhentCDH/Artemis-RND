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
