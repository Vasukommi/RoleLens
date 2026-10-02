import type { Assessment, EvidenceStatus } from "./types";
export type Job = { id: string; title: string; requirements: { id: string; text: string }[] };
export type Application = {
  id: string;
  job_id: string;
  name: string;
  filename: string;
  source: string;
  external_id: string | null;
  status: string;
  error: string | null;
  reviewed: boolean;
  version: number;
  text: string | null;
  extraction_method: "native" | "ocr" | "mixed" | null;
  assessment: Assessment | null;
  overrides: Record<string, EvidenceStatus>;
  notes: string;
};
export type ApplicationPage = { items: Application[]; total: number; page: number; limit: number };
export type JobSummary = {
  total: number;
  reviewed: number;
  statuses: Record<string, number>;
  batches: { id: string; received: number; expected: number; duplicates: number }[];
};
