"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { Select } from "@/components/select";
import type { Application, Job, ScreeningPolicy, SelectionResult } from "@/lib/inbox-types";
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
  selection: SelectionResult;
};
type Listing = {
  items: Row[];
  total: number;
  page: number;
  statuses: Record<string, number>;
  shortlisted: number;
  screening_policy: ScreeningPolicy;
  policy_version: number;
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
  const [preview, setPreview] = useState<Application[]>([]);
  const [policyDraft, setPolicyDraft] = useState<(ScreeningPolicy & { version: number }) | null>(
    null,
  );
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
    dialog.current?.close();
  }
  async function inspect(ids: string[]) {
    setBusy(true);
    setError("");
    try {
      const records: Application[] = [];
      for (const id of ids) records.push(await api<Application>(`applications/${id}`));
      setPreview(records);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePolicy() {
    if (!policyDraft) return;
    setBusy(true);
    setError("");
    try {
      await api(`jobs/${job.id}/screening-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policyDraft),
      });
      setPolicyDraft(null);
      setPage(1);
      setNotice("Screening rules saved. The shortlist now uses these rules.");
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
        `Queued ${result.queued} resumes for refreshed matching. Previous assessments are archived; applicants qualify again after reassessment.`,
      );
      await refresh();
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
          Resumes are shortlisted automatically using your screening rules. Download matching
          resumes directly, or inspect the evidence when needed.
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
          <span>Automatic shortlist</span>
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
      {listing && (
        <section className="screening-policy" aria-label="Screening rules">
          <div className="interpretation-heading">
            <h3>Screening rules</h3>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() =>
                setPolicyDraft({ ...listing.screening_policy, version: listing.policy_version })
              }
            >
              Adjust screening rules
            </button>
          </div>
          <p>
            Match at least {listing.screening_policy.threshold}% of{" "}
            {listing.screening_policy.criterion_ids.length} selected criteria. Partial and unclear
            evidence do not count as supported.
          </p>
          {!listing.screening_policy.criterion_ids.length && (
            <p role="status">No screening criteria selected. No resumes can qualify.</p>
          )}
          <details>
            <summary>View included and excluded criteria</summary>
            {job.requirements.map((r) => (
              <p key={r.id}>
                {listing.screening_policy.criterion_ids.includes(r.id) ? "Included" : "Excluded"}:{" "}
                {r.text}
                {r.assessment_mode === "INTERVIEW"
                  ? " · Interview assessment"
                  : r.assessment_mode === "VERIFY_SEPARATELY"
                    ? " · May need separate verification"
                    : ""}
              </p>
            ))}
          </details>
          {policyDraft && (
            <div className="screening-policy-editor">
              <label className="form-label" htmlFor="match-threshold">
                Minimum match percentage
              </label>
              <input
                id="match-threshold"
                className="form-input"
                type="number"
                min={1}
                max={100}
                step={1}
                value={policyDraft.threshold}
                disabled={busy}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, threshold: Number(e.target.value) })
                }
              />
              <p>
                Only fully supported criteria count. Excluded criteria do not affect the shortlist.
              </p>
              {job.requirements.map((r) => (
                <label className="screening-policy-criterion" key={r.id}>
                  <input
                    type="checkbox"
                    checked={policyDraft.criterion_ids.includes(r.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        criterion_ids: e.target.checked
                          ? [...policyDraft.criterion_ids, r.id]
                          : policyDraft.criterion_ids.filter((id) => id !== r.id),
                      })
                    }
                  />
                  {r.text}
                  {r.assessment_mode === "INTERVIEW" && (
                    <small>Interview evidence remains unresolved.</small>
                  )}
                </label>
              ))}
              <div className="comparison-actions">
                <button
                  className="button button-primary"
                  disabled={
                    busy ||
                    !Number.isInteger(policyDraft.threshold) ||
                    policyDraft.threshold < 1 ||
                    policyDraft.threshold > 100
                  }
                  onClick={() => void savePolicy()}
                >
                  Save screening rules
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setPolicyDraft(null)}
                >
                  Cancel changes
                </button>
                {listing.policy_version !== policyDraft.version && (
                  <p>Rules changed elsewhere. Cancel changes to load the latest version.</p>
                )}
              </div>
            </div>
          )}
        </section>
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
            }}
          />
        </label>
        <Select
          aria-label="Filter matching results"
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPage(1);
          }}
          options={[
            { value: "", label: "All applications" },
            { value: "SHORTLISTED", label: "Automatic shortlist" },
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
            }}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        )}
      </div>
      <div className="comparison-actions">
        <button
          className="button button-secondary"
          disabled={busy || !listing?.shortlisted}
          onClick={() =>
            void download(`jobs/${job.id}/shortlist/csv`, "rolelens-shortlist.csv").catch((e) =>
              setError(e.message),
            )
          }
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
        Refresh calls Jev again using extracted text. Previous findings are archived and the
        shortlist updates as new assessments complete. Changing screening rules does not call the
        models.
      </p>
      <div className="inbox-table-wrap">
        <table className="inbox-table comparison-table">
          <thead>
            <tr>
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
                  <button onClick={() => void inspect([row.id])} disabled={busy}>
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
                  <span className={row.shortlisted ? "review-done" : undefined}>
                    {row.selection.status === "SHORTLISTED"
                      ? "Shortlisted"
                      : row.selection.status === "NOT_MATCHED"
                        ? "Below threshold"
                        : row.selection.status === "INCONCLUSIVE"
                          ? "Inconclusive"
                          : row.selection.status === "FAILED"
                            ? "Processing failed"
                            : "Processing"}
                  </span>
                  <small>
                    {row.selection.percentage === null
                      ? "No criteria selected"
                      : `${row.selection.matched} / ${row.selection.total} · ${row.selection.percentage}% matched`}
                  </small>
                  <small>{row.selection.reason}</small>
                </td>
              </tr>
            ))}
            {listing?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="inbox-empty">
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
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="comparison-review-dialog"
        aria-label="Matching evidence"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else closePreview();
        }}
      >
        <div className="dialog-header">
          <h2>Matching evidence</h2>
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
          Inspect the findings behind this automatic screening result. Reviewing evidence is
          optional.
        </p>
        {preview.map((record) => (
          <article className="comparison-review-record" key={record.id}>
            <h3>{record.name}</h3>
            {record.selection && (
              <p>
                {record.selection.matched} / {record.selection.total} screening criteria supported.{" "}
                {record.selection.reason}
              </p>
            )}
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
              const effectiveStatus =
                record.screening?.findings[requirement.id] ??
                record.overrides[requirement.id] ??
                finding?.status;
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
        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <button className="button button-secondary" disabled={busy} onClick={closePreview}>
            Close
          </button>
        </div>
      </dialog>
    </section>
  );
}
