import { STATUS_LABELS, type Candidate, type Requirement } from "./types";

function csvCell(value: string): string {
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reviewCsv(
  candidate: Candidate,
  requirements: Requirement[],
  roleTitle: string,
): string {
  const rows = [
    [
      "Role",
      "Candidate",
      "Requirement",
      "Finding",
      "Source evidence",
      "Model",
      "Sample",
      "Reviewed",
      "Reviewer notes",
    ],
  ];
  for (const requirement of requirements) {
    const finding = candidate.assessment?.findings.find((f) => f.requirement_id === requirement.id);
    rows.push([
      roleTitle,
      candidate.name,
      requirement.text,
      finding ? STATUS_LABELS[finding.status] : "Not assessed",
      finding?.evidence?.text ?? "",
      candidate.assessment?.model ?? "",
      candidate.assessment?.is_sample ? "Yes — synthetic fixture" : "No",
      candidate.reviewed ? "Yes" : "No",
      candidate.notes ?? "",
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
