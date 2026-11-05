import type { ResearchCandidate } from './research';
import type { ColumnMapping, FileProvenance } from './discovery-csv';
import type { DiscoveryFilters, DiscoveryResult } from './discovery';
export type DiscoveryRequest =
  | { type: 'inspect'; file: File; encoding: string }
  | {
      type: 'import';
      file: File;
      encoding: string;
      mapping: ColumnMapping;
      source: FileProvenance;
    }
  | {
      type: 'discover';
      filters: DiscoveryFilters;
      exclude: { numbers: string[]; names: string[] };
    }
  | { type: 'enrichment-targets' }
  | { type: 'merge-api'; candidate: ResearchCandidate };
export type ImportStats = {
  rows: number;
  invalidRows: number;
  invalidFields: number;
  duplicates: number;
  total: number;
};
export type DiscoveryResponse =
  | { type: 'headers'; headers: string[] }
  | { type: 'imported'; stats: ImportStats }
  | { type: 'progress'; message: string }
  | { type: 'result'; result: DiscoveryResult }
  | { type: 'targets'; numbers: string[] }
  | { type: 'merged'; total: number }
  | { type: 'error'; message: string };
