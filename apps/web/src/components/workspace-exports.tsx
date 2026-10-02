"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, FileText, LoaderCircle } from "lucide-react";
import { Select } from "@/components/select";
import { api } from "@/lib/api";
import { downloadText } from "@/lib/download";
import { reviewCsv } from "@/lib/export";
import type { Application, ApplicationPage, Job } from "@/lib/inbox-types";

export function WorkspaceExports({ job }: { job: Job }) {
  const [scope, setScope] = useState("REVIEWED");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState<{ filename: string; count: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function exportReviews() {
    const cancellation = new AbortController();
    controller.current = cancellation;
    setBusy(true);
    setError("");
    setProgress("Loading application records…");
    try {
      const query = new URLSearchParams({ status: scope });
      const records: Application[] = [];
      let page = 1;
      let total: number;
      do {
        const result = await api<ApplicationPage>(
          `jobs/${job.id}/applications?${query}&page=${page}`,
          { signal: cancellation.signal },
        );
        total = result.total;
        records.push(...result.items);
        page++;
        if (!result.items.length) break;
      } while (records.length < total);
      if (!records.length) {
        setProgress("No applications match this export scope.");
        return;
      }
      const documents = new Array<string>(records.length);
      let cursor = 0;
      let done = 0;
      async function fetchReview() {
        while (cursor < records.length) {
          const index = cursor++;
          const record = await api<Application>(`applications/${records[index].id}`, {
            signal: cancellation.signal,
          });
          const assessment = record.assessment
            ? {
                ...record.assessment,
                findings: record.assessment.findings.map((finding) =>
                  record.overrides[finding.requirement_id]
                    ? {
                        ...finding,
                        status: record.overrides[finding.requirement_id],
                        confidence: null,
                        probabilities: null,
                      }
                    : finding,
                ),
              }
            : null;
          documents[index] = reviewCsv(
            {
              ...record,
              headline: record.source,
              text: record.text ?? "",
              passages: [],
              assessment,
            },
            job.requirements,
            job.title,
          );
          done++;
          setProgress(`Preparing ${done} / ${records.length} reviews…`);
        }
      }
      await Promise.all([fetchReview(), fetchReview(), fetchReview(), fetchReview()]);
      const headerEnd = documents[0].indexOf("\r\n");
      const csv = [
        documents[0].slice(0, headerEnd),
        ...documents.map((document) => document.slice(document.indexOf("\r\n") + 2)),
      ].join("\r\n");
      const filename = `rolelens-${job.id.slice(0, 8)}-${scope === "REVIEWED" ? "reviewed" : "all"}.csv`;
      downloadText(csv, filename);
      setLastExport({ filename, count: records.length });
      setProgress(`Exported ${records.length} saved application reviews.`);
    } catch (failure) {
      cancellation.abort();
      if (failure instanceof Error && failure.name !== "AbortError") setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article className="job-card export-card">
        <h2>Automatic shortlist exports</h2>
        <p>Download the automatic shortlist CSV and original resumes from matching results.</p>
        <Link className="button button-secondary" href={`/shortlists?job=${job.id}`}>
          Open shortlist exports
        </Link>
      </article>
      <article className="job-card export-card">
        <FileText size={22} />
        <h2>Application review CSV</h2>
        <p>
          Export requirements, evidence, reviewer corrections, notes, and assessment provenance for{" "}
          {job.title}.
        </p>
        <label className="form-label" htmlFor="export-scope">
          Include applications
        </label>
        <Select
          id="export-scope"
          value={scope}
          onValueChange={setScope}
          disabled={busy}
          options={[
            { value: "REVIEWED", label: "Reviewed applications" },
            { value: "", label: "All applications" },
          ]}
        />
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void exportReviews()}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}Export
          reviews
        </button>
        {progress && <p role="status">{progress}</p>}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
      </article>
      <div className="section-heading">
        <h2>Latest download</h2>
        <span>This session</span>
      </div>
      {lastExport ? (
        <div className="export-receipt">
          <FileText size={18} />
          <div>
            <strong>{lastExport.filename}</strong>
            <span>{lastExport.count} application reviews · CSV</span>
          </div>
        </div>
      ) : (
        <div className="compact-empty">Your downloaded review file will appear here.</div>
      )}
      <p className="coverage-explanation">
        Reviewed means the review was marked complete, not that the applicant was shortlisted.
        Original resume files are not included in this export.
      </p>
    </>
  );
}
