export type StepTiming = {
  step: string;
  ms: number;
  ok: boolean;
  detail?: string;
};

export type RunResult = {
  manifestUrl: string;
  annotationUrl?: string;
  startedAtISO: string;
  totalMs: number;
  steps: StepTiming[];
  ok: boolean;
  error?: string;
};

export type UILog = {
  atISO: string;
  level: "INFO" | "WARN" | "ERROR";
  msg: string;
};