import type { SubLayerKind } from '$lib/artemis/config/layers';

export type PaneId = 'left' | 'right';

export type LayerMetadata = {
  title: string;
  info: string[];
};

export type SliderSublayer = {
  id: string;
  subId: string;
  label: string;
  defaultOn: boolean;
};

export type SliderSource = {
  key: string;
  mainId: string;
  label: string;
  start: number;
  end: number;
  repr: number;
  color: string;
  lane: number;
  sublayers: SliderSublayer[];
};

export type CollectionInfo = {
  key: string;
  mainId: string;
  name: string;
  color: string;
  dateRange: string;
  info?: string;
  sublayers: Array<{ id: string; subId: string; label: string; kind?: SubLayerKind; url?: string }>;
};
