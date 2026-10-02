export type EvidenceStatus = "SUPPORTED" | "PARTIAL" | "NOT_MENTIONED" | "UNCLEAR";
export type Requirement = { id: string; text: string };
export type Passage = { id: string; text: string };
export type Finding = {
  requirement_id: string;
  status: EvidenceStatus;
  evidence: Passage | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
};
export type Assessment = { findings: Finding[]; model: string; is_sample: boolean };
export type Candidate = {
  id: string;
  name: string;
  headline: string;
  filename: string;
  text: string;
  passages: Passage[];
  assessment: Assessment | null;
  reviewed?: boolean;
  notes?: string;
};
export const STATUS_LABELS: Record<EvidenceStatus, string> = {
  SUPPORTED: "Supported",
  PARTIAL: "Partial evidence",
  NOT_MENTIONED: "Not mentioned",
  UNCLEAR: "Needs clarification",
};
