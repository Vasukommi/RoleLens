import type { Assessment, EvidenceStatus } from "./types";
export type JobRequirement = {
  id: string;
  text: string;
  priority?: "REQUIRED" | "PREFERRED" | "UNSPECIFIED";
  assessment_mode?: "RESUME_EVIDENCE" | "VERIFY_SEPARATELY" | "INTERVIEW";
  components?: string[];
  component_operator?: "ALL" | "ANY";
  source_validation?: "GROUNDED" | "REVIEW" | "EMPLOYER_AUTHORED";
  source_quote?: string | null;
  review_note?: string | null;
};
export type JobInterpretation = {
  id: string;
  requirements: JobRequirement[];
  validation: Record<string, "GROUNDED" | "REVIEW">;
  review_notes: string[];
  model: string;
  verifier_model: string | null;
  prompt_version: string;
  cached: boolean;
};
export type ScreeningPolicy = { threshold: number; criterion_ids: string[] };
export type SelectionResult = {
  status: "SHORTLISTED" | "NOT_MATCHED" | "INCONCLUSIVE" | "PENDING" | "FAILED";
  reason: string;
  matched: number;
  total: number;
  unresolved: number;
  percentage: number | null;
  threshold: number;
};
export type Job = {
  id: string;
  title: string;
  requirements: JobRequirement[];
  screening_policy: ScreeningPolicy;
  policy_version: number;
  description?: string | null;
  interpretation?: JobInterpretation | null;
};
export type Application = {
  document_available?: boolean;
  shortlisted?: boolean;
  selection?: SelectionResult;
  screening?: { findings: Record<string, EvidenceStatus> } | null;
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
