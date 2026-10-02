"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Upload,
  BriefcaseBusiness,
  X,
} from "lucide-react";
import { WorkspaceShell, type WorkspaceSection } from "@/components/workspace-shell";
import { CandidateComparison } from "@/components/candidate-comparison";
import { WorkspaceExports } from "@/components/workspace-exports";
import type {
  Job,
  Application,
  ApplicationPage as Page,
  JobSummary as Summary,
} from "@/lib/inbox-types";
import { Select } from "@/components/select";
import { CreateJobDialog } from "@/components/create-job-dialog";
import { api } from "@/lib/api";
import { reviewCsv } from "@/lib/export";
import { STATUS_LABELS, type Candidate, type EvidenceStatus } from "@/lib/types";

type UploadItem = {
  file: File;
  receipt: string;
  state: "pending" | "uploading" | "accepted" | "duplicate" | "failed";
  error?: string;
};
const PIPELINE: Record<string, string> = {
  QUEUED: "Queued",
  PROCESSING: "Processing",
  AWAITING_PROVIDER: "Awaiting provider",
  RETRY_WAIT: "Retry scheduled",
  READY: "Ready for review",
  FAILED: "Failed",
};

export function JobInbox({ section = "library" }: { section?: WorkspaceSection }) {
  const router = useRouter();
  const params = useSearchParams();
  const requestedJob = params.get("job");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [health, setHealth] = useState<{
    worker_active: boolean;
    assessment_available: boolean;
  } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [listing, setListing] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);
  const [criterion, setCriterion] = useState("");
  const [notes, setNotes] = useState("");
  const [overrides, setOverrides] = useState<Record<string, EvidenceStatus>>({});
  const [reviewed, setReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [batchId, setBatchId] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const reviewOpen = selected !== null;
  const currentJob = jobs.find((j) => j.id === jobId);
  const jobRef = useRef(jobId);
  const detailRef = useRef(selectedId);
  const refreshSequence = useRef(0);
  useEffect(() => {
    jobRef.current = jobId;
    detailRef.current = selectedId;
  }, [jobId, selectedId]);

  const refresh = useCallback(async () => {
    if (!jobId) {
      const nextHealth = await api<{ worker_active: boolean; assessment_available: boolean }>(
        "health",
      );
      if (!jobRef.current) setHealth(nextHealth);
      return;
    }
    const sequence = ++refreshSequence.current;
    const query = new URLSearchParams({ page: String(page), search, status });
    const [nextSummary, nextPage, nextHealth] = await Promise.all([
      api<Summary>(`jobs/${jobId}/summary`),
      api<Page>(`jobs/${jobId}/applications?${query}`),
      api<{ worker_active: boolean; assessment_available: boolean }>("health"),
    ]);
    if (jobRef.current !== jobId || refreshSequence.current !== sequence) return;
    setSummary(nextSummary);
    setListing(nextPage);
    setHealth(nextHealth);
  }, [jobId, page, search, status]);

  useEffect(() => {
    let cancelled = false;
    void api<Job[]>("jobs")
      .then((data) => {
        if (!cancelled) {
          setJobs(data);
          setJobId(data.find((job) => job.id === requestedJob)?.id ?? data[0]?.id ?? "");
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedJob]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        await refresh();
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (reviewOpen) reviewDialog.current?.showModal();
    else reviewDialog.current?.close();
  }, [reviewOpen]);

  useEffect(() => {
    if (!selectedId || dirty) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Application>(`applications/${selectedId}`);
        if (cancelled || detailRef.current !== selectedId) return;
        setSelected(data);
        setNotes(data.notes);
        setOverrides(data.overrides);
        setReviewed(data.reviewed);
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      }
    }
    void load();
    const timer =
      !dirty && selected?.status !== "READY" ? setInterval(() => void load(), 4000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selectedId, dirty, selected?.status]);

  function chooseApplication(id: string) {
    if (dirty && !window.confirm("Discard your unsaved review changes?")) return;
    setDirty(false);
    setSelected(null);
    setSelectedId(id);
    setNotice("");
    setCriterion(currentJob?.requirements[0]?.id ?? "");
  }

  function chooseJob(id: string) {
    if (dirty && !window.confirm("Discard your unsaved review changes?")) return;
    setDirty(false);
    setSelected(null);
    setSelectedId("");
    setJobId(id);
    setListing(null);
    setSummary(null);
    setItems([]);
    setBatchId("");
    setPage(1);
    setSearch("");
    setStatus("");
    router.push(
      `${section === "shortlists" ? "/shortlists" : section === "exports" ? "/exports" : "/"}?job=${id}`,
    );
  }

  async function uploadPending(selection: UploadItem[], existingBatch = "") {
    if (!jobId || importing) return;
    setImporting(true);
    setError("");
    const target = jobId;
    let workingBatch = existingBatch;
    try {
      if (!workingBatch) {
        const batch = await api<{ id: string }>(`jobs/${target}/batches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected: selection.length }),
        });
        workingBatch = batch.id;
        setBatchId(batch.id);
      }
      const pending = selection.filter((i) => i.state === "pending" || i.state === "failed");
      let cursor = 0;
      const change = (receipt: string, state: UploadItem["state"], message?: string) =>
        setItems((current) =>
          current.map((item) =>
            item.receipt === receipt ? { ...item, state, error: message } : item,
          ),
        );
      async function send() {
        while (cursor < pending.length) {
          const item = pending[cursor++];
          change(item.receipt, "uploading");
          try {
            if (item.file.size > 5 * 1024 * 1024) throw new Error("File exceeds 5 MB.");
            const body = new FormData();
            body.append("file", item.file);
            body.append(
              "name",
              item.file.name
                .replace(/\.[^.]+$/, "")
                .replaceAll(/[_-]/g, " ")
                .slice(0, 100) || "Applicant",
            );
            body.append("batch_id", workingBatch);
            body.append("receipt_id", item.receipt);
            const receipt = await api<{ id: string; duplicate: boolean }>(
              `jobs/${target}/applications`,
              { method: "POST", body },
            );
            change(item.receipt, receipt.duplicate ? "duplicate" : "accepted");
          } catch (failure) {
            change(item.receipt, "failed", (failure as Error).message);
          }
        }
      }
      await Promise.all([send(), send(), send()]);
      await refresh();
      setNotice(
        "Accepted applications are processed automatically. Failed uploads can be retried below.",
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function saveReview() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const data = await api<Application>(`applications/${selected.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: selected.version, notes, reviewed, overrides }),
      });
      setSelected(data);
      setDirty(false);
      setNotice("Review saved.");
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function retry(path: string) {
    try {
      const result = await api<{ queued: number }>(path, { method: "POST" });
      setNotice(`${result.queued} applications queued for retry.`);
      await refresh();
      if (selected) setSelected(await api<Application>(`applications/${selected.id}`));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const originalFinding = selected?.assessment?.findings.find(
    (f) => f.requirement_id === criterion,
  );
  const findingStatus = originalFinding ? (overrides[criterion] ?? originalFinding.status) : null;
  const evidence = originalFinding?.evidence;
  const sourceText = selected?.text ?? "";
  const start = evidence ? sourceText.indexOf(evidence.text) : -1;
  const uploadedCount = items.filter(
    (i) => i.state === "accepted" || i.state === "duplicate",
  ).length;
  const failedUploads = items.filter((i) => i.state === "failed");
  const pendingCount = summary
    ? Object.entries(summary.statuses)
        .filter(([key]) => ["QUEUED", "PROCESSING", "RETRY_WAIT"].includes(key))
        .reduce((n, [, count]) => n + count, 0)
    : 0;

  function exportSelected() {
    if (!selected || !currentJob) return;
    const candidate: Candidate = {
      id: selected.id,
      name: selected.name,
      filename: selected.filename,
      headline: selected.source,
      text: sourceText,
      passages: [],
      reviewed,
      notes,
      assessment: selected.assessment
        ? {
            ...selected.assessment,
            findings: selected.assessment.findings.map((f) =>
              overrides[f.requirement_id]
                ? {
                    ...f,
                    status: overrides[f.requirement_id],
                    confidence: null,
                    probabilities: null,
                  }
                : f,
            ),
          }
        : null,
    };
    const url = URL.createObjectURL(
      new Blob([reviewCsv(candidate, currentJob.requirements, currentJob.title)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "rolelens-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <WorkspaceShell
        section={section}
        jobId={jobId}
        beforeNavigate={() =>
          !importing && (!dirty || window.confirm("Discard your unsaved review changes?"))
        }
        status={
          <span className={`connection ${health?.worker_active ? "connected" : ""}`}>
            <span />
            {health?.worker_active ? "Worker online" : "Worker offline"}
          </span>
        }
      >
        <div className="page-heading">
          <div>
            <h1>
              {section === "jobs"
                ? "Jobs"
                : section === "shortlists"
                  ? "Shortlists"
                  : section === "exports"
                    ? "Exports"
                    : (currentJob?.title ?? "Resume library")}
            </h1>
            <p>
              {section === "jobs"
                ? "Create roles and define the criteria used to assess incoming resumes."
                : section === "shortlists"
                  ? "Automatic screening and shortlist downloads. Adjust the matching rules at any time."
                  : section === "exports"
                    ? "Download saved application reviews and their supporting evidence."
                    : "Import and inspect resumes for this job. PDF, DOCX, and TXT are supported."}
            </p>
          </div>
          <div className="heading-actions">
            {section !== "exports" && (
              <button
                className={`button ${section === "jobs" ? "button-primary" : "button-secondary"}`}
                disabled={importing}
                onClick={() => {
                  setError("");
                  setCreating(true);
                }}
              >
                <Plus size={16} />
                New job
              </button>
            )}
            {section === "library" && jobId && (
              <button
                className="button button-secondary"
                onClick={() => router.push(`/shortlists?job=${jobId}`)}
              >
                View matching results
              </button>
            )}
            {section === "library" && (
              <button
                className="button button-primary"
                disabled={!jobId || importing}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} />
                {importing ? "Uploading…" : "Import resumes"}
              </button>
            )}
          </div>
        </div>
        {section !== "jobs" && jobs.length > 0 && (
          <div className="results-context">
            <label htmlFor="workspace-job">Job</label>
            <Select
              id="workspace-job"
              disabled={importing}
              value={jobId}
              onValueChange={(value) => {
                if (section === "exports") router.push(`/exports?job=${value}`);
                else chooseJob(value);
              }}
              options={jobs.map((job) => ({ value: job.id, label: job.title }))}
            />
            <span>
              Resumes are currently stored per job. Reusable folders are shown in the demo.
            </span>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.docx,.txt"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length) return;
            if (files.length > 10000) {
              setError("Choose up to 10,000 files per import.");
              return;
            }
            const next: UploadItem[] = files.map((file) => ({
              file,
              receipt: crypto.randomUUID(),
              state: "pending",
            }));
            setItems(next);
            setBatchId("");
            void uploadPending(next);
          }}
        />
        {error && !creating && (
          <div className="alert alert-error" role="alert">
            {error}
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert alert-notice" role="status">
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {section === "jobs" ? (
          jobs.length ? (
            <div className="job-card-grid">
              {jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="card-icon">
                    <BriefcaseBusiness size={18} />
                  </div>
                  <h2>{job.title}</h2>
                  <p>{job.requirements.length} assessment criteria</p>
                  <ul className="job-criteria-preview">
                    {job.requirements.slice(0, 3).map((requirement) => (
                      <li key={requirement.id}>{requirement.text}</li>
                    ))}
                  </ul>
                  {job.description && (
                    <details className="saved-job-description">
                      <summary>View job definition</summary>
                      <p className="saved-description-text">{job.description}</p>
                      <ul>
                        {job.requirements.map((item) => (
                          <li key={item.id}>
                            <strong>{item.text}</strong>
                            <span>
                              {item.priority ?? "UNSPECIFIED"} ·{" "}
                              {item.assessment_mode?.replaceAll("_", " ")}
                            </span>
                            {item.review_note && <span>{item.review_note}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    className="button button-secondary"
                    aria-label={`Open resumes for ${job.title}`}
                    onClick={() => chooseJob(job.id)}
                  >
                    Open resumes
                    <ChevronRight size={14} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <section className="empty-review">
              <BriefcaseBusiness size={30} />
              <h2>Create your first job</h2>
              <p>Define role requirements, then import resumes into its library.</p>
              <button className="button button-primary" onClick={() => setCreating(true)}>
                Create job
              </button>
            </section>
          )
        ) : section === "shortlists" ? (
          currentJob ? (
            <CandidateComparison key={currentJob.id} job={currentJob} />
          ) : (
            <section className="empty-review">
              <h2>Create a job to compare resumes</h2>
              <p>Create a job and import resumes. Matching runs automatically.</p>
            </section>
          )
        ) : section === "exports" ? (
          currentJob ? (
            <WorkspaceExports key={currentJob.id} job={currentJob} />
          ) : (
            <section className="empty-review">
              <ArrowDownToLine size={30} />
              <h2>No reviews to export yet</h2>
              <p>Create a job and import resumes to start collecting application reviews.</p>
              <button className="button button-primary" onClick={() => setCreating(true)}>
                Create job
              </button>
            </section>
          )
        ) : !currentJob ? (
          <section className="empty-review">
            <FileText size={30} />
            <h2>Create a job to start receiving applications</h2>
            <p>
              Define the role once. Import many resumes together or connect your application source
              to the intake API.
            </p>
            <button className="button button-primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create job
            </button>
          </section>
        ) : (
          <>
            <div className="inbox-stats" aria-label="Job processing totals">
              <div>
                <span>Applications</span>
                <strong>{summary?.total ?? 0}</strong>
              </div>
              <div>
                <span>In progress</span>
                <strong>{pendingCount}</strong>
              </div>
              <div>
                <span>Ready for review</span>
                <strong>{summary?.statuses.READY ?? 0}</strong>
              </div>
              <div>
                <span>Reviewed</span>
                <strong>{summary?.reviewed ?? 0}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{summary?.statuses.FAILED ?? 0}</strong>
              </div>
            </div>
            {!health?.worker_active && health && (
              <div className="pipeline-message">
                Worker is offline. Accepted applications are saved and will process when the worker
                starts.
              </div>
            )}
            {!health?.assessment_available && health && (
              <div className="pipeline-message">
                Automatic assessment is awaiting Jev configuration. Documents still parse and can be
                inspected.
              </div>
            )}
            {items.length > 0 && (
              <section className="import-progress" aria-label="Bulk import progress">
                <div>
                  <strong>
                    {uploadedCount} / {items.length} files accepted
                  </strong>
                  <span>
                    {items.filter((i) => i.state === "duplicate").length} duplicates ·{" "}
                    {failedUploads.length} failed uploads
                  </span>
                </div>
                <progress value={uploadedCount + failedUploads.length} max={items.length} />
                {importing && (
                  <p>
                    Keep this tab open until uploads finish. Accepted work continues after you
                    leave.
                  </p>
                )}
                {failedUploads.length > 0 && (
                  <>
                    <button
                      className="button button-secondary"
                      disabled={importing}
                      onClick={() => void uploadPending(items, batchId)}
                    >
                      Retry failed uploads
                    </button>
                    <details>
                      <summary>Upload errors</summary>
                      {failedUploads.slice(0, 50).map((item) => (
                        <p key={item.receipt}>
                          {item.file.name}: {item.error}
                        </p>
                      ))}
                      {failedUploads.length > 50 && (
                        <p>Showing the first 50 errors. Retry applies to all failed files.</p>
                      )}
                    </details>
                  </>
                )}
              </section>
            )}
            <div className="inbox-toolbar">
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search applications"
                  placeholder="Search applications"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <Select
                aria-label="Filter processing status"
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "All applications" },
                  ...Object.entries(PIPELINE).map(([value, label]) => ({ value, label })),
                  { value: "REVIEWED", label: "Reviewed" },
                ]}
              />
              <button
                className="button button-secondary"
                onClick={() => void retry(`jobs/${jobId}/retry`)}
              >
                <RefreshCw size={14} />
                Retry failed / waiting
              </button>
            </div>
            <div className="inbox-table-wrap">
              <table className="inbox-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Source</th>
                    <th>Processing</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {listing?.items.map((application) => (
                    <tr
                      key={application.id}
                      className={application.id === selectedId ? "selected" : ""}
                    >
                      <td>
                        <button
                          onClick={() => chooseApplication(application.id)}
                          aria-pressed={application.id === selectedId}
                        >
                          {application.name}
                          <span>{application.filename}</span>
                        </button>
                      </td>
                      <td>{application.source.replaceAll("_", " ")}</td>
                      <td>
                        <span
                          className={`pipeline-status pipeline-${application.status.toLowerCase()}`}
                        >
                          {PIPELINE[application.status]}
                        </span>
                      </td>
                      <td>
                        {application.reviewed ? (
                          <span className="review-done">
                            <Check size={12} />
                            Reviewed
                          </span>
                        ) : (
                          "Pending"
                        )}
                      </td>
                    </tr>
                  ))}
                  {listing?.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="inbox-empty">
                        {search || status
                          ? "No applications match these filters."
                          : "No applications yet. Import resumes or connect a source."}
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
                  aria-label="Previous page"
                  disabled={page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={page * 50 >= (listing?.total ?? 0)}
                  onClick={() => setPage((n) => n + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            {selected && (
              <dialog
                className="application-drawer"
                ref={reviewDialog}
                aria-label="Application review"
                onCancel={(event) => {
                  event.preventDefault();
                  chooseApplication("");
                }}
              >
                <section className="persistent-review" aria-label="Application review">
                  <div className="review-header">
                    <div>
                      <h2>{selected.name}</h2>
                      <p>
                        {selected.source} · {selected.external_id ?? selected.filename}
                      </p>
                    </div>
                    <div className="review-actions">
                      <button className="button button-secondary" onClick={exportSelected}>
                        <ArrowDownToLine size={14} />
                        Export
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Close application review"
                        onClick={() => chooseApplication("")}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  {selected.error && (
                    <div className="application-error">
                      <span>{selected.error}</span>
                      <button
                        className="text-button"
                        onClick={() => void retry(`applications/${selected.id}/retry`)}
                      >
                        Retry application
                      </button>
                    </div>
                  )}
                  <div className="evidence-layout">
                    <div className="findings-panel">
                      <div className="table-label">
                        <span>Requirement</span>
                        <span>Finding</span>
                      </div>
                      {currentJob.requirements.map((requirement, index) => {
                        const result = selected.assessment?.findings.find(
                          (f) => f.requirement_id === requirement.id,
                        );
                        const resultStatus = overrides[requirement.id] ?? result?.status;
                        return (
                          <button
                            key={requirement.id}
                            className={`finding-row ${criterion === requirement.id ? "finding-selected" : ""}`}
                            aria-pressed={criterion === requirement.id}
                            onClick={() => setCriterion(requirement.id)}
                          >
                            <span className="requirement-index">{index + 1}</span>
                            <span className="requirement-text">{requirement.text}</span>
                            {resultStatus ? (
                              <span className={`status-badge status-${resultStatus.toLowerCase()}`}>
                                {STATUS_LABELS[resultStatus]}
                              </span>
                            ) : (
                              <span className="not-assessed">{PIPELINE[selected.status]}</span>
                            )}
                            <ChevronRight size={12} />
                          </button>
                        );
                      })}
                      <p className="findings-footnote">
                        Missing evidence is not proof of missing ability. Original findings are
                        retained separately from corrections.
                      </p>
                    </div>
                    <aside className="source-panel">
                      <div className="source-heading">
                        <FileText size={16} />
                        <h3>Resume evidence</h3>
                      </div>
                      <div className="source-requirement">
                        <span>Selected requirement</span>
                        <p>{currentJob.requirements.find((r) => r.id === criterion)?.text}</p>
                      </div>
                      {["ocr", "mixed"].includes(selected.extraction_method ?? "") && (
                        <p className="findings-footnote">
                          OCR-derived text. Check transcription against the original document.
                        </p>
                      )}
                      <pre className="resume-text">
                        {sourceText ? (
                          start < 0 ? (
                            sourceText
                          ) : (
                            <>
                              {sourceText.slice(0, start)}
                              <mark>{evidence!.text}</mark>
                              {sourceText.slice(start + evidence!.text.length)}
                            </>
                          )
                        ) : (
                          "The worker has not extracted text yet."
                        )}
                      </pre>
                      {findingStatus && (
                        <div className="correction">
                          <label htmlFor="inbox-correction">Reviewer correction</label>
                          <Select
                            id="inbox-correction"
                            value={findingStatus}
                            onValueChange={(value) => {
                              setOverrides((current) => ({
                                ...current,
                                [criterion]: value as EvidenceStatus,
                              }));
                              setDirty(true);
                            }}
                            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                          />
                        </div>
                      )}
                    </aside>
                  </div>
                  <div className="reviewer-notes">
                    <label htmlFor="persistent-notes">Review notes</label>
                    <textarea
                      id="persistent-notes"
                      value={notes}
                      maxLength={2000}
                      onChange={(event) => {
                        setNotes(event.target.value);
                        setDirty(true);
                      }}
                      placeholder="Record evidence gaps and follow-up questions…"
                    />
                    <div>
                      <label className="review-checkbox">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          onChange={(event) => {
                            setReviewed(event.target.checked);
                            setDirty(true);
                          }}
                        />
                        Review complete
                      </label>
                      <button
                        className="button button-primary"
                        disabled={saving || !dirty}
                        onClick={() => void saveReview()}
                      >
                        {saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                        Save review
                      </button>
                    </div>
                    <p className="review-save-state">
                      {dirty ? "Unsaved changes" : "Review stored in the database"}
                    </p>
                  </div>
                </section>
              </dialog>
            )}
            <details className="intake-details">
              <summary>Integration and import details</summary>
              <p>
                Job ID: <code>{jobId}</code>
              </p>
              <p>
                Applications can be submitted automatically using the authenticated intake API. See
                the integration guide for file/text requests, delivery IDs, and a runnable
                careers-form example.
              </p>
              {summary?.batches.map((batch) => (
                <p key={batch.id}>
                  Import {batch.id.slice(0, 8)}: {batch.received} / {batch.expected} received ·{" "}
                  {batch.duplicates} duplicates
                  {batch.received < batch.expected
                    ? " · submission incomplete; accepted documents still process"
                    : ""}
                </p>
              ))}
            </details>
          </>
        )}
      </WorkspaceShell>
      {creating && (
        <CreateJobDialog
          onClose={() => {
            setCreating(false);
            setError("");
          }}
          onCreated={(job) => {
            setJobs((current) => [job, ...current]);
            chooseJob(job.id);
            setCreating(false);
            setError("");
          }}
        />
      )}
    </>
  );
}
