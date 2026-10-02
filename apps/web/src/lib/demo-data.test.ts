import { describe, expect, it } from "vitest";
import { DEMO_FOLDERS, DEMO_JOBS, DEMO_RESUMES, demoCandidates, demoCsv } from "./demo-data";
import { safeWorkspaceReturn } from "./workspace-links";

describe("isolated demo data", () => {
  it("has 200 unique fictional profiles with accurate folder counts", () => {
    expect(DEMO_RESUMES).toHaveLength(200);
    expect(new Set(DEMO_RESUMES.map((resume) => resume.id)).size).toBe(200);
    for (const folder of DEMO_FOLDERS)
      expect(DEMO_RESUMES.filter((resume) => resume.folderId === folder.id)).toHaveLength(
        folder.count,
      );
    expect(DEMO_RESUMES.every((resume) => resume.text.includes("FICTIONAL DEMO RESUME"))).toBe(
      true,
    );
  });
  it("limits comparisons to selected folders and keeps unsupported criteria out of suggestions", () => {
    const job = DEMO_JOBS[1];
    const results = demoCandidates(job, ["cloud", "early-career"]);
    expect(results).toHaveLength(120);
    expect(results.every((result) => result.resume.folderId !== "full-stack")).toBe(true);
    expect(results.some((result) => result.suggested)).toBe(true);
    expect(
      results
        .filter((result) => result.suggested)
        .every((result) =>
          result.findings
            .filter((finding) => finding.required)
            .every((finding) => finding.status === "SUPPORTED"),
        ),
    ).toBe(true);
    expect(results.find((result) => result.resume.folderId === "early-career")!.suggested).toBe(
      false,
    );
  });
  it("distinguishes example reviewer selections from unreviewed suggestions in exports", () => {
    const resume = DEMO_RESUMES[0];
    expect(demoCsv(DEMO_JOBS[0], [resume], [])).toContain('"Unreviewed suggestion"');
    expect(demoCsv(DEMO_JOBS[0], [resume], [resume.id])).toContain('"Example reviewer selection"');
    expect(demoCsv(DEMO_JOBS[0], [resume], [])).toContain(
      "FICTIONAL DEMO — preset findings; no Jev assessment",
    );
  });
  it("allows only workspace routes as demo return destinations", () => {
    expect(safeWorkspaceReturn("/exports?job=12345678-1234-1234-1234-123456789abc")).toBe(
      "/exports?job=12345678-1234-1234-1234-123456789abc",
    );
    for (const value of [
      "https://example.com",
      "//example.com",
      "/demo",
      "/exports?job=invalid",
      ["/jobs"],
    ])
      expect(safeWorkspaceReturn(value)).toBe("/");
  });
});
