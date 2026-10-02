"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Select } from "@/components/select";
import { downloadText } from "@/lib/download";
import type { Application, Job } from "@/lib/inbox-types";
import { STATUS_LABELS } from "@/lib/types";

type Counts = {
  total: number;
  supported: number;
  partial: number;
  not_mentioned: number;
  unclear: number;
  verification: number;
};
type Summary = {
  REQUIRED: Counts;
  PREFERRED: Counts;
  UNSPECIFIED: Counts;
  needs_refresh: boolean;
  unresolved: number;
};
type Row = {
  id: string;
  name: string;
  filename: string;
  status: string;
  version: number;
  shortlisted: boolean;
  screening: Summary;
};
type Listing = {
  items: Row[];
  total: number;
  page: number;
  statuses: Record<string, number>;
  shortlisted: number;
};

async function download(route: string, filename: string) {
  const response = await fetch(`/api/backend/${route}`);
  if (!response.ok) throw new Error((await response.json()).detail ?? "Download failed.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function countText(group: Counts) {
  return `${group.supported} / ${group.total} supported · ${group.partial} partial`;
}

export function CandidateComparison({ job }: { job: Job }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("");
  const [criterion, setCriterion] = useState("");
  const [findingStatus, setFindingStatus] = useState("SUPPORTED");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [preview, setPreview] = useState<Application[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [approving, setApproving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    const query = new URLSearchParams({
      page: String(page),
      search,
      scope,
      criterion_id: criterion,
      finding_status: findingStatus,
    });
    const result = await api<Listing>(`jobs/${job.id}/comparison?${query}`);
    if (current === sequence.current) setListing(result);
  }, [job.id, page, search, scope, criterion, findingStatus]);
  useEffect(() => {
    let cancelled = false;
    const requestSequence = sequence;
    const load = () =>
      void refresh().catch((e) => {
        if (!cancelled) setError(e.message);
      });
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      requestSequence.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (preview.length) dialog.current?.showModal();
  }, [preview]);
  function closePreview() {
    setPreview([]);
    setConfirmed(false);
    setApproving(false);
    dialog.current?.close();
  }
  async function inspect(ids: string[], approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const records: Application[] = [];
      for (const id of ids) records.push(await api<Application>(`applications/${id}`));
      setPreview(records);
      setConfirmed(false);
      setApproving(approve);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!confirmed || !approving) return;
    setBusy(true);
    setError("");
    try {
      await api(`jobs/${job.id}/shortlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: preview.map((r) => ({ id: r.id, version: r.version })),
          evidence_reviewed: true,
        }),
      });
      setNotice(`Approved ${preview.length} applications for your shortlist.`);
      closePreview();
      setChecked([]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reassess() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ queued: number }>(`jobs/${job.id}/reassess`, { method: "POST" });
      setNotice(
        `Queued ${result.queued} resumes for refreshed matching. Previous assessments are archived; previous shortlist approvals are cleared.`,
      );
      setChecked([]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    setBusy(true);
    setError("");
    try {
      const rows: Row[] = [];
      let n = 1;
      while (true) {
        const next = await api<Listing>(`jobs/${job.id}/comparison?scope=SHORTLISTED&page=${n}`);
        rows.push(...next.items);
        if (rows.length >= next.total || !next.items.length) break;
        n++;
      }
      if (!rows.length) throw new Error("Approve a shortlist before exporting it.");
      const cell = (value: string | number) =>
        `"${String(value)
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""')}"`;
      const lines = [
        [
          "Applicant",
          "File",
          "Required supported",
          "Required total",
          "Required partial",
          "Preferred supported",
          "Preferred total",
          "Unresolved",
          "Human approved",
        ],
        ...rows.map((r) => [
          r.name,
          r.filename,
          r.screening.REQUIRED.supported,
          r.screening.REQUIRED.total,
          r.screening.REQUIRED.partial,
          r.screening.PREFERRED.supported,
          r.screening.PREFERRED.total,
          r.screening.unresolved,
          "Yes",
        ]),
      ];
      downloadText(
        lines.map((r) => r.map(cell).join(",")).join("\r\n"),
        `rolelens-${job.id.slice(0, 8)}-shortlist.csv`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const statuses = listing?.statuses ?? {};
  const inProgress = Object.entries(statuses)
    .filter(([s]) => !["READY", "FAILED"].includes(s))
    .reduce((n, [, v]) => n + v, 0);
  return (
    <section className="candidate-comparison" aria-label="Candidate comparison">
      <div className="comparison-intro">
        <h2>Matching results</h2>
        <p>
          Evidence is matched automatically. Compare required and preferred criteria, inspect
          unresolved items, then approve a shortlist. Counts describe resume evidence, not verified
          ability.
        </p>
      </div>
      <div className="inbox-metrics">
        <div>
          <span>Assessed</span>
          <strong>{statuses.READY ?? 0}</strong>
        </div>
        <div>
          <span>In progress</span>
          <strong>{inProgress}</strong>
        </div>
        <div>
          <span>Approved shortlist</span>
          <strong>{listing?.shortlisted ?? 0}</strong>
        </div>
        <div>
          <span>Failed</span>
          <strong>{statuses.FAILED ?? 0}</strong>
        </div>
      </div>
      {error && (
        <div role="alert" className="alert alert-error">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="alert alert-notice">
          {notice}
        </p>
      )}
      <div className="inbox-toolbar comparison-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search matching results"
            placeholder="Search candidates"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setChecked([]);
            }}
          />
        </label>
        <Select
          aria-label="Filter matching results"
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPage(1);
            setChecked([]);
          }}
          options={[
            { value: "", label: "All applications" },
            { value: "SHORTLISTED", label: "Approved shortlist" },
            { value: "COMPLETE", label: "All required evidence supported" },
            { value: "UNRESOLVED", label: "Unresolved criteria" },
          ]}
        />
        <Select
          aria-label="Filter by criterion"
          value={criterion}
          onValueChange={(v) => {
            setCriterion(v);
            setPage(1);
            setChecked([]);
          }}
          options={[
            { value: "", label: "Any criterion" },
            ...job.requirements.map((r) => ({ value: r.id, label: r.text })),
          ]}
        />
        {criterion && (
          <Select
            aria-label="Filter criterion finding"
            value={findingStatus}
            onValueChange={(v) => {
              setFindingStatus(v);
              setPage(1);
              setChecked([]);
            }}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        )}
      </div>
      <div className="comparison-actions">
        <button
          className="button button-primary"
          disabled={busy || !checked.length}
          onClick={() => void inspect(checked, true)}
        >
          Review selection ({checked.length})
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void exportCsv()}
        >
          <ArrowDownToLine size={14} />
          Shortlist CSV
        </button>
        <button
          className="button button-secondary"
          disabled={busy || !listing?.shortlisted}
          onClick={() =>
            void download(`jobs/${job.id}/shortlist/documents`, "rolelens-shortlist.zip").catch(
              (e) => setError(e.message),
            )
          }
        >
          <ArrowDownToLine size={14} />
          Shortlisted resumes
        </button>
        <button
          className="button button-quiet"
          disabled={busy || inProgress > 0}
          onClick={() => void reassess()}
        >
          <RefreshCw size={14} />
          Refresh matching
        </button>
      </div>
      <p className="comparison-explanation">
        Refresh reuses extracted text and calls Jev, archives previous assessments, and clears
        shortlist approvals. No application is automatically advanced or rejected.
      </p>
      <div className="inbox-table-wrap">
        <table className="inbox-table comparison-table">
          <thead>
            <tr>
              <th>Select</th>
              <th>Applicant</th>
              <th>Required evidence</th>
              <th>Preferred evidence</th>
              <th>Unresolved</th>
              <th>Shortlist</th>
            </tr>
          </thead>
          <tbody>
            {listing?.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={checked.includes(row.id)}
                    disabled={
                      row.status !== "READY" || row.screening.needs_refresh || row.shortlisted
                    }
                    onChange={(e) =>
                      setChecked((c) =>
                        e.target.checked ? [...c, row.id] : c.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                <td>
                  <button onClick={() => void inspect([row.id], false)} disabled={busy}>
                    {row.name}
                    <span>{row.filename}</span>
                  </button>
                  <small>
                    {row.status !== "READY"
                      ? row.status.replaceAll("_", " ")
                      : row.screening.needs_refresh
                        ? "Refresh needed: older matcher"
                        : "Assessed automatically"}
                  </small>
                </td>
                <td>
                  {countText(row.screening.REQUIRED)}
                  {row.screening.UNSPECIFIED.total > 0 && (
                    <small>Unspecified: {countText(row.screening.UNSPECIFIED)}</small>
                  )}
                  <small>
                    {row.screening.REQUIRED.not_mentioned} not found ·{" "}
                    {row.screening.REQUIRED.unclear} unresolved
                  </small>
                </td>
                <td>
                  {countText(row.screening.PREFERRED)}
                  <small>
                    {row.screening.PREFERRED.not_mentioned} not found ·{" "}
                    {row.screening.PREFERRED.unclear} unresolved
                  </small>
                </td>
                <td>
                  {row.screening.unresolved}
                  <small>
                    {row.screening.REQUIRED.verification +
                      row.screening.PREFERRED.verification +
                      row.screening.UNSPECIFIED.verification}{" "}
                    separate checks
                  </small>
                </td>
                <td>
                  {row.shortlisted ? <span className="review-done">Approved</span> : "Not selected"}
                </td>
              </tr>
            ))}
            {listing?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="inbox-empty">
                  No applications match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="inbox-pagination">
        <span>
          {listing?.total ?? 0} applications · page {page} of{" "}
          {Math.max(1, Math.ceil((listing?.total ?? 0) / 50))}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous matching page"
            disabled={page === 1}
            onClick={() => {
              setPage((p) => p - 1);
              setChecked([]);
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Next matching page"
            disabled={page * 50 >= (listing?.total ?? 0)}
            onClick={() => {
              setPage((p) => p + 1);
              setChecked([]);
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="comparison-review-dialog"
        aria-label="Shortlist evidence review"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else closePreview();
        }}
      >
        <div className="dialog-header">
          <h2>{approving ? "Review shortlist selection" : "Matching evidence"}</h2>
          <button
            className="icon-button"
            aria-label="Close evidence review"
            disabled={busy}
            onClick={closePreview}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Inspect the evidence and unresolved requirements for each application. Approval is your
          decision to include the application in a shortlist; it is not an automated hiring
          decision.
        </p>
        {preview.map((record) => (
          <article className="comparison-review-record" key={record.id}>
            <h3>{record.name}</h3>
            <p>
              {record.filename} · {record.extraction_method ?? "text"} extraction
            </p>
            {record.assessment && (
              <p>
                Matcher: {record.assessment.model}
                {record.assessment.assessed_at ? ` · ${record.assessment.assessed_at}` : ""}
              </p>
            )}
            {record.extraction_method !== "native" && record.extraction_method && (
              <p>
                OCR-derived text may contain transcription errors. Check the original where evidence
                is unclear.
              </p>
            )}
            {record.document_available && (
              <button
                className="button button-secondary"
                onClick={() =>
                  void download(`applications/${record.id}/document`, record.filename).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                Download original resume
              </button>
            )}
            {job.requirements.map((requirement) => {
              const finding = record.assessment?.findings.find(
                (f) => f.requirement_id === requirement.id,
              );
              const effectiveStatus = record.overrides[requirement.id] ?? finding?.status;
              return (
                <details className="comparison-finding" key={requirement.id}>
                  <summary>
                    <span>
                      {requirement.text}
                      <small>{requirement.priority ?? "UNSPECIFIED"}</small>
                    </span>
                    <span>{effectiveStatus ? STATUS_LABELS[effectiveStatus] : "Not assessed"}</span>
                  </summary>
                  {record.overrides[requirement.id] && <p>Finding corrected by a reviewer.</p>}
                  <p>
                    {finding?.reason ??
                      requirement.review_note ??
                      "Inspect the source before deciding."}
                  </p>
                  {finding?.components?.map((part, i) => (
                    <p key={i}>
                      {part.label}: {STATUS_LABELS[part.status]}
                    </p>
                  ))}
                  {(finding?.evidence_passages?.length
                    ? finding.evidence_passages
                    : finding?.evidence
                      ? [finding.evidence]
                      : []
                  ).map((p) => (
                    <blockquote key={p.id}>{p.text}</blockquote>
                  ))}
                </details>
              );
            })}
          </article>
        ))}
        {approving && (
          <label className="interpretation-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the relevant evidence and unresolved criteria for these applicants and
            approve this shortlist selection.
          </label>
        )}
        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <button className="button button-secondary" disabled={busy} onClick={closePreview}>
            Close
          </button>
          {approving && (
            <button
              className="button button-primary"
              disabled={!confirmed || busy}
              onClick={() => void approve()}
            >
              {busy && <LoaderCircle size={14} />}Approve shortlist
            </button>
          )}
        </div>
      </dialog>
    </section>
  );
}
