import { describe, expect, it } from "vitest";
import { reviewCsv } from "./export";
import type { Candidate } from "./types";

const candidate: Candidate = {
  id: "sample",
  name: '=HYPERLINK("https://example.com")',
  headline: "Synthetic",
  filename: "sample.txt",
  text: "Synthetic resume text",
  passages: [],
  notes: "A note, with commas",
  assessment: {
    model: "synthetic-fixture",
    is_sample: true,
    findings: [
      {
        requirement_id: "r1",
        status: "PARTIAL",
        evidence: { id: "p1", text: "Skills: React" },
        confidence: null,
        probabilities: null,
      },
    ],
  },
};

describe("review CSV", () => {
  it("includes source evidence, sample provenance, and reviewer notes", () => {
    const csv = reviewCsv(candidate, [{ id: "r1", text: "Built React applications" }], "Frontend");
    expect(csv).toContain('"Skills: React"');
    expect(csv).toContain('"Yes — synthetic fixture"');
    expect(csv).toContain('"A note, with commas"');
  });
  it("escapes quotes and prevents spreadsheet formula execution", () => {
    const csv = reviewCsv(candidate, [{ id: "r1", text: "Built React applications" }], "Frontend");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(
      reviewCsv({ ...candidate, notes: "  @SUM(1,2)" }, [{ id: "r1", text: "React" }], "Frontend"),
    ).toContain('"\'  @SUM(1,2)"');
  });
});
