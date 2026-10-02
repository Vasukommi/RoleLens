"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Github,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import logo from "../../assets/logo - 1.png";
import { api } from "@/lib/api";
import { reviewCsv } from "@/lib/export";
import {
  STATUS_LABELS,
  type Assessment,
  type Candidate,
  type EvidenceStatus,
  type Requirement,
} from "@/lib/types";

type Job = { id: string; title: string; requirements: Requirement[] };
type Application = {
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
type Page = { items: Application[]; total: number; page: number; limit: number };
type Summary = {
  total: number;
  reviewed: number;
  statuses: Record<string, number>;
  batches: { id: string; received: number; expected: number; duplicates: number }[];
};
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

export function JobInbox() {
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
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [batchId, setBatchId] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
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
    if (!jobId) return;
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
          setJobId(data[0]?.id ?? "");
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (creating) dialog.current?.showModal();
    else dialog.current?.close();
  }, [creating]);

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
  }

  async function createJob() {
    const requirements = criteria
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text, index) => ({ id: `r${index + 1}`, text }));
    if (
      !title.trim() ||
      requirements.length < 1 ||
      requirements.length > 12 ||
      requirements.some((r) => r.text.length < 3 || r.text.length > 300)
    ) {
      setError("Enter a title and 1–12 explicit requirements, 3–300 characters each.");
      return;
    }
    setSaving(true);
    try {
      const job = await api<Job>("jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), requirements }),
      });
      setJobs((current) => [job, ...current]);
      chooseJob(job.id);
      setCreating(false);
      setTitle("");
      setCriteria("");
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
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
    <div className="inbox-shell">
      <aside className="inbox-sidebar">
        <Link href="/" className="brand" aria-label="RoleLens home">
          <Image src={logo} alt="RoleLens" sizes="176px" loading="eager" />
        </Link>
        <div className="nav-caption">Hiring workspace</div>
        <div className="inbox-nav">
          <Users size={16} />
          Application inbox
        </div>
        <div className="nav-caption">Jobs</div>
        <div className="job-navigation">
          {jobs.map((job) => (
            <button
              key={job.id}
              disabled={importing}
              aria-pressed={job.id === jobId}
              onClick={() => chooseJob(job.id)}
            >
              {job.title}
            </button>
          ))}
        </div>
        <button
          className="nav-item"
          disabled={importing}
          onClick={() => {
            setError("");
            setCreating(true);
          }}
        >
          <Plus size={16} />
          New job
        </button>
        <div className="sidebar-spacer" />
        <Link className="nav-item" href="/demo">
          Synthetic demo
          <ArrowRight size={14} />
        </Link>
        <a
          className="nav-item"
          href="https://github.com/Vasukommi/RoleLens/blob/feat/application-intake/docs/integrations.md"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={16} />
          Integration guide
        </a>
        <div className="sidebar-footer">
          Development preview<span>v0.2</span>
        </div>
      </aside>
      <div className="inbox-main">
        <header className="topbar">
          <div className="breadcrumb">
            Hiring
            <ChevronRight size={12} />
            <span>Application inbox</span>
          </div>
          <span className={`connection ${health?.worker_active ? "connected" : ""}`}>
            <span />
            {health?.worker_active ? "Worker online" : "Worker offline"}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>{currentJob?.title ?? "Application inbox"}</h1>
              <p>Applications arrive here. Processing runs in the background.</p>
            </div>
            <button
              className="button button-primary"
              disabled={!jobId || importing}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} />
              {importing ? "Uploading…" : "Import resumes"}
            </button>
          </div>
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
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
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
          {!currentJob ? (
            <section className="empty-review">
              <FileText size={30} />
              <h2>Create a job to start receiving applications</h2>
              <p>
                Define the role once. Import many resumes together or connect your application
                source to the intake API.
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
                  Worker is offline. Accepted applications are saved and will process when the
                  worker starts.
                </div>
              )}
              {!health?.assessment_available && health && (
                <div className="pipeline-message">
                  Automatic assessment is awaiting Jev configuration. Documents still parse and can
                  be inspected.
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
                <select
                  aria-label="Filter processing status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All applications</option>
                  {Object.entries(PIPELINE).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="REVIEWED">Reviewed</option>
                </select>
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
                                <span
                                  className={`status-badge status-${resultStatus.toLowerCase()}`}
                                >
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
                            <select
                              id="inbox-correction"
                              value={findingStatus}
                              onChange={(event) => {
                                setOverrides((current) => ({
                                  ...current,
                                  [criterion]: event.target.value as EvidenceStatus,
                                }));
                                setDirty(true);
                              }}
                            >
                              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
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
                          {saving ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Check size={14} />
                          )}
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
                  Applications can be submitted automatically using the authenticated intake API.
                  See the integration guide for file/text requests, delivery IDs, and a runnable
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
        </main>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="new-job-title"
        onCancel={() => {
          setCreating(false);
          setError("");
        }}
      >
        <div className="dialog-header">
          <h2 id="new-job-title">Create a job</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setCreating(false)}
          >
            <X size={18} />
          </button>
        </div>
        <p className="dialog-description">
          All incoming applications use these requirements. Criteria are fixed for this job so
          results remain comparable. Processing starts automatically and sends resume passages to
          TypeSafe when Jev is configured.
        </p>
        <label className="form-label" htmlFor="job-name">
          Job title
        </label>
        <input
          id="job-name"
          className="form-input"
          maxLength={100}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        <label className="form-label" htmlFor="job-requirements">
          Job requirements<span>One per line · up to 12</span>
        </label>
        <textarea
          id="job-requirements"
          className="form-input criteria-input"
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <button
            className="button button-secondary"
            disabled={saving}
            onClick={() => {
              setCreating(false);
              setError("");
            }}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void createJob()}
          >
            Create job
          </button>
        </div>
      </dialog>
    </div>
  );
}
