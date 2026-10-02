"use client";

import { Select } from "@/components/select";

import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  FileText,
  Github,
  LoaderCircle,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import wordmark from "../../assets/logo - 1.png";
import { api } from "@/lib/api";
import { reviewCsv } from "@/lib/export";
import {
  STATUS_LABELS,
  type Assessment,
  type Candidate,
  type EvidenceStatus,
  type Health,
  type Passage,
  type Requirement,
  type Workspace,
} from "@/lib/types";

const DEFAULT_REQUIREMENTS: Requirement[] = [
  { id: "react", text: "Built and maintained React applications" },
  { id: "typescript", text: "Used TypeScript in application development" },
  { id: "testing", text: "Written automated tests for web applications" },
  { id: "accessibility", text: "Implemented accessible user interfaces" },
  { id: "aws", text: "Deployed applications on AWS" },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function StatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span />
      {STATUS_LABELS[status]}
    </span>
  );
}

function ResumeSource({ text, evidence }: { text: string; evidence: Passage | null }) {
  const index = evidence ? text.indexOf(evidence.text) : -1;
  return (
    <pre className="resume-text">
      {index < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, index)}
          <mark>{evidence!.text}</mark>
          {text.slice(index + evidence!.text.length)}
        </>
      )}
    </pre>
  );
}

export function ReviewWorkspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [roleTitle, setRoleTitle] = useState("Frontend Engineer");
  const [requirements, setRequirements] = useState<Requirement[]>(DEFAULT_REQUIREMENTS);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRequirement, setSelectedRequirement] = useState("react");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCriteria, setDraftCriteria] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [parsedFile, setParsedFile] = useState<{ filename: string; passages: Passage[] } | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const loadSample = useCallback(async () => {
    const sample = await api<Workspace>("sample");
    setRoleTitle(sample.role_title);
    setRequirements(sample.requirements);
    setCandidates(sample.candidates);
    setSelectedId(sample.candidates[0]?.id ?? "");
    setSelectedRequirement(sample.requirements[0]?.id ?? "");
    setFilter("");
    setError("");
  }, []);

  useEffect(() => {
    async function initialize() {
      try {
        const state = await api<Health>("health");
        setHealth(state);
        await loadSample();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not load the workspace.");
      } finally {
        setHydrating(false);
      }
    }
    void initialize();
  }, [loadSample]);

  useEffect(() => {
    if (editing || uploading) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [editing, uploading]);

  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const finding = selected?.assessment?.findings.find(
    (item) => item.requirement_id === selectedRequirement,
  );
  const visibleCandidates = candidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const reviewedCount = candidates.filter((candidate) => candidate.reviewed).length;
  const assessedCount = candidates.filter((candidate) => candidate.assessment).length;
  const sampleMode = candidates.some((candidate) => candidate.assessment?.is_sample);

  function updateCandidate(update: Partial<Candidate>) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === selectedId ? { ...candidate, ...update } : candidate,
      ),
    );
  }

  function editCriteria() {
    setDraftTitle(roleTitle);
    setDraftCriteria(requirements.map((requirement) => requirement.text).join("\n"));
    setEditing(true);
    setError("");
  }

  function saveCriteria() {
    const lines = draftCriteria
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      !draftTitle.trim() ||
      lines.length < 1 ||
      lines.length > 12 ||
      lines.some((line) => line.length < 3 || line.length > 300)
    ) {
      setError("Add a role title and 1–12 requirements, each between 3 and 300 characters.");
      return;
    }
    if (
      draftTitle.trim() !== roleTitle ||
      JSON.stringify(lines) !== JSON.stringify(requirements.map((r) => r.text))
    ) {
      const next = lines.map((text, index) => ({ id: `r${index + 1}`, text }));
      setRoleTitle(draftTitle.trim());
      setRequirements(next);
      setCandidates((current) =>
        current.map((candidate) => ({ ...candidate, assessment: null, reviewed: false })),
      );
      setSelectedRequirement(next[0].id);
      setNotice(
        "Criteria updated. Previous assessments were cleared to keep results tied to the current role.",
      );
    }
    setEditing(false);
    setError("");
  }

  async function parseFile(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
      const form = new FormData();
      form.append("file", file);
      const parsed = await api<{ filename: string; text: string; passages: Passage[] }>("resumes", {
        method: "POST",
        body: form,
      });
      setUploadText(parsed.text);
      setParsedFile({ filename: parsed.filename, passages: parsed.passages });
      if (!candidateName)
        setCandidateName(file.name.replace(/\.[^.]+$/, "").replaceAll(/[_-]/g, " "));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not parse the resume.");
    } finally {
      setBusy(false);
    }
  }

  function addResume() {
    if (!candidateName.trim() || uploadText.trim().length < 30 || uploadText.length > 24_000) {
      setError("Add a name and resume text between 30 and 24,000 characters.");
      return;
    }
    const candidate: Candidate = {
      id: crypto.randomUUID(),
      name: candidateName.trim(),
      headline: "Uploaded resume",
      filename: parsedFile?.filename ?? "pasted-resume.txt",
      text: uploadText.trim(),
      passages: parsedFile?.passages ?? [],
      assessment: null,
    };
    setCandidates((current) => [...current, candidate]);
    setSelectedId(candidate.id);
    setUploading(false);
    setCandidateName("");
    setUploadText("");
    setParsedFile(null);
    setError("");
    setNotice("Resume added to this session. Review the text, then run the assessment.");
  }

  async function assessSelected() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const candidateId = selected.id;
    try {
      const assessment = await api<Assessment>("assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_text: selected.text, requirements }),
      });
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id === candidateId ? { ...candidate, assessment, reviewed: false } : candidate,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Assessment failed.");
    } finally {
      setBusy(false);
    }
  }

  function exportReview() {
    if (!selected) return;
    const blob = new Blob([reviewCsv(selected, requirements, roleTitle)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rolelens-review.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function correctFinding(status: EvidenceStatus) {
    if (!selected?.assessment || !finding) return;
    updateCandidate({
      reviewed: false,
      assessment: {
        ...selected.assessment,
        findings: selected.assessment.findings.map((item) =>
          item.requirement_id === selectedRequirement
            ? { ...item, status, confidence: null, probabilities: null }
            : item,
        ),
      },
    });
    setNotice("Finding corrected for this session. Export your review to keep a copy.");
  }

  return (
    <div className="app-shell">
      <aside id="workspace-navigation" className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" href="/" aria-label="RoleLens home">
          <Image src={wordmark} alt="RoleLens" sizes="176px" loading="eager" />
        </Link>
        <div className="workspace-context">
          <span className="workspace-icon">
            <Users size={16} />
          </span>
          <div>
            Hiring workspace<small>Local session</small>
          </div>
        </div>
        <div className="nav-caption">Workspace</div>
        <button
          className="nav-item active"
          aria-current="page"
          onClick={() => setSidebarOpen(false)}
        >
          <Users size={18} />
          Resume review<span className="nav-count">{candidates.length}</span>
        </button>
        <button className="nav-item" onClick={editCriteria} disabled={busy}>
          <Settings2 size={18} />
          Role criteria
        </button>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <ShieldCheck size={16} />
          <div>
            <strong>Session storage</strong>
            <p>Export reviews to keep your work before refreshing.</p>
          </div>
        </div>
        <a
          className="nav-item github-link"
          href="https://github.com/Vasukommi/RoleLens"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={18} />
          GitHub repository
          <ArrowRight size={15} />
        </a>
        <div className="sidebar-footer">
          Development preview<span>v0.1</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation"
              aria-expanded={sidebarOpen}
              aria-controls="workspace-navigation"
            >
              <PanelLeft size={20} />
            </button>
            Hiring
            <ChevronRight size={14} />
            <span>Resume review</span>
          </div>
          <div className="topbar-right">
            <span className={`connection ${health ? "connected" : ""}`}>
              <span />
              {health ? "API connected" : "API offline"}
            </span>
            <span className="session-label">Local session</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>Resume review</h1>
              <p>Compare role requirements with evidence from each resume.</p>
            </div>
            <button
              className="button button-primary"
              disabled={busy || hydrating}
              onClick={() => {
                setUploading(true);
                setError("");
              }}
            >
              <Plus size={17} />
              Add resume
            </button>
          </div>

          <section className="role-card" aria-label="Current role">
            <div className="role-description">
              <div className="eyebrow">Current role</div>
              <h2>{roleTitle}</h2>
              <span>{requirements.length} requirements</span>
            </div>
            <button className="button button-secondary" onClick={editCriteria} disabled={busy}>
              <Settings2 size={15} />
              Edit criteria
            </button>
          </section>

          <div className="overview">
            <div>
              <Users size={15} />
              <strong>{candidates.length}</strong>
              <span className="stat-label">resumes</span>
            </div>
            <div>
              <FileText size={15} />
              <strong>{assessedCount}</strong>
              <span className="stat-label">assessed</span>
            </div>
            <div>
              <CircleCheck size={15} />
              <strong>{reviewedCount}</strong>
              <span className="stat-label">reviewed</span>
            </div>
          </div>

          {sampleMode && (
            <div className="sample-banner">
              <span className="sample-tag">Demo data</span>
              <span>Invented resumes and preset findings. Samples make no AI calls.</span>
              <button
                onClick={() => {
                  setCandidates((current) =>
                    current.filter((candidate) => !candidate.id.startsWith("sample-")),
                  );
                  setSelectedId(
                    candidates.find((candidate) => !candidate.id.startsWith("sample-"))?.id ?? "",
                  );
                }}
                disabled={busy}
              >
                Clear samples
                <X size={14} />
              </button>
            </div>
          )}
          {!health?.assessment_available && health && (
            <div className="setup-note">
              Jev is not configured. You can explore samples and preview uploads; live assessment
              needs a backend API key.{" "}
              <a
                href="https://github.com/Vasukommi/RoleLens#configuration"
                target="_blank"
                rel="noreferrer"
              >
                Setup guide
                <ArrowRight size={13} />
              </a>
            </div>
          )}
          {error && !editing && !uploading && (
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

          <div className="section-heading">
            <h2>Review workspace</h2>
            <button
              className="text-button"
              onClick={() => {
                if (
                  candidates.length &&
                  !window.confirm(
                    "Replace the current session with samples? Export any reviews you want to keep first.",
                  )
                )
                  return;
                void loadSample().catch((failure: Error) => setError(failure.message));
              }}
              disabled={busy}
            >
              Reset sample workspace
            </button>
          </div>
          <div className="review-grid">
            <section className="candidate-panel" aria-label="Resumes">
              <div className="candidate-panel-heading">
                <h3>Resumes</h3>
                <span>{candidates.length}</span>
              </div>
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search resumes"
                  placeholder="Search resumes"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
              <div className="candidate-list">
                {hydrating ? (
                  <div className="loading-state">
                    <LoaderCircle className="spin" size={22} />
                    Loading workspace…
                  </div>
                ) : (
                  visibleCandidates.map((candidate, index) => (
                    <button
                      key={candidate.id}
                      className={`candidate-item ${candidate.id === selectedId ? "selected" : ""}`}
                      aria-pressed={candidate.id === selectedId}
                      onClick={() => {
                        setSelectedId(candidate.id);
                        setNotice("");
                      }}
                    >
                      <span className={`candidate-avatar avatar-${index % 3}`}>
                        {initials(candidate.name)}
                      </span>
                      <span className="candidate-meta">
                        <strong>{candidate.name}</strong>
                        <span>{candidate.headline}</span>
                        <small>
                          {candidate.reviewed ? (
                            <>
                              <Check size={12} />
                              Reviewed
                            </>
                          ) : candidate.assessment ? (
                            "Ready for your review"
                          ) : (
                            "Not assessed"
                          )}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))
                )}
                {!hydrating && visibleCandidates.length === 0 && (
                  <div className="empty-list">
                    {filter ? "No matching resumes." : "Add a resume to start reviewing."}
                  </div>
                )}
              </div>
              <div className="session-note">
                <ShieldCheck size={14} />
                <span>Session only. Export before refreshing.</span>
              </div>
            </section>

            <section className="review-panel" aria-label="Selected resume review">
              {selected ? (
                <>
                  <div className="review-header">
                    <div className="candidate-avatar avatar-large">{initials(selected.name)}</div>
                    <div>
                      <h2>{selected.name}</h2>
                      <p>{selected.filename}</p>
                    </div>
                    <div className="review-actions">
                      <button
                        className="icon-button"
                        aria-label="Remove selected resume"
                        disabled={busy}
                        onClick={() => {
                          const next = candidates.filter(
                            (candidate) => candidate.id !== selectedId,
                          );
                          setCandidates(next);
                          setSelectedId(next[0]?.id ?? "");
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button className="button button-secondary" onClick={exportReview}>
                        <ArrowDownToLine size={15} />
                        Export
                      </button>
                    </div>
                  </div>
                  <div className="review-tabs">
                    <span className="tab-active">
                      Requirements
                      <span className="tab-count">{requirements.length}</span>
                    </span>
                    <span className="assessment-label">
                      {selected.assessment?.is_sample
                        ? "Preset sample"
                        : selected.assessment
                          ? selected.assessment.model
                          : "Awaiting assessment"}
                    </span>
                  </div>
                  <div className="evidence-layout">
                    <div className="findings-panel">
                      <div className="table-label">
                        <span>Requirement</span>
                        <span>Finding</span>
                      </div>
                      {requirements.map((requirement, index) => {
                        const result = selected.assessment?.findings.find(
                          (item) => item.requirement_id === requirement.id,
                        );
                        return (
                          <button
                            key={requirement.id}
                            className={`finding-row ${selectedRequirement === requirement.id ? "finding-selected" : ""}`}
                            aria-pressed={selectedRequirement === requirement.id}
                            onClick={() => setSelectedRequirement(requirement.id)}
                          >
                            <span className="requirement-index">
                              {(index + 1).toString().padStart(2, "0")}
                            </span>
                            <span className="requirement-text">{requirement.text}</span>
                            {result ? (
                              <StatusBadge status={result.status} />
                            ) : (
                              <span className="not-assessed">Not assessed</span>
                            )}
                            <ChevronRight size={13} />
                          </button>
                        );
                      })}
                      <div className="findings-footnote">
                        “Not mentioned” means the resume has no located evidence. It does not
                        establish a lack of ability.
                      </div>
                      <button
                        className="button button-primary assess-button"
                        disabled={busy || !health?.assessment_available}
                        onClick={() => void assessSelected()}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                        {busy
                          ? "Assessing evidence…"
                          : selected.assessment
                            ? "Reassess evidence"
                            : "Assess evidence"}
                      </button>
                    </div>
                    <aside className="source-panel">
                      <div className="source-heading">
                        <FileText size={16} />
                        <h3>Source evidence</h3>
                        <span>{finding?.evidence ? "Linked" : "Preview"}</span>
                      </div>
                      <div className="source-requirement">
                        <span>Selected requirement</span>
                        <p>{requirements.find((item) => item.id === selectedRequirement)?.text}</p>
                      </div>
                      <p className="source-caption">
                        {finding?.evidence
                          ? "Highlighted text is copied from the resume."
                          : "Inspect the extracted text before relying on an assessment."}
                      </p>
                      <ResumeSource text={selected.text} evidence={finding?.evidence ?? null} />
                      {finding && (
                        <div className="correction">
                          <label htmlFor="finding-status">Reviewer correction</label>
                          <Select
                            id="finding-status"
                            disabled={busy}
                            value={finding.status}
                            onValueChange={(value) => correctFinding(value as EvidenceStatus)}
                            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                          />
                          {finding.confidence !== null && (
                            <small>
                              Model certainty: {Math.round(finding.confidence * 100)}%. This
                              describes the finding, not hiring suitability.
                            </small>
                          )}
                        </div>
                      )}
                    </aside>
                  </div>
                  <div className="reviewer-notes">
                    <label htmlFor="review-notes">Your review notes</label>
                    <textarea
                      id="review-notes"
                      placeholder="Add a clarification or question to follow up on…"
                      value={selected.notes ?? ""}
                      maxLength={2000}
                      onChange={(event) =>
                        updateCandidate({ notes: event.target.value, reviewed: false })
                      }
                    />
                    <div>
                      <span>Notes and corrections are included in your export.</span>
                      <button
                        className={`button ${selected.reviewed ? "button-reviewed" : "button-secondary"}`}
                        disabled={!selected.assessment || busy}
                        onClick={() => updateCandidate({ reviewed: !selected.reviewed })}
                      >
                        <Check size={15} />
                        {selected.reviewed ? "Reviewed" : "Mark reviewed"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-review">
                  <div className="empty-icon">
                    <FileText size={30} />
                  </div>
                  <h2>No resume selected</h2>
                  <p>
                    Add a resume and check the extracted text, or explore the sample workspace to
                    see how evidence review works.
                  </p>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => {
                      setUploading(true);
                      setError("");
                    }}
                  >
                    <Plus size={16} />
                    Add your first resume
                  </button>
                </div>
              )}
            </section>
          </div>
          <footer className="page-footer">
            <span>RoleLens / Development preview</span>
            <span>Evidence supports review. Hiring decisions remain with you.</span>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else {
            setEditing(false);
            setUploading(false);
            setError("");
          }
        }}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-header">
          <div>
            <div className="eyebrow">{editing ? "DEFINE THE ROLE" : "ADD TO THIS SESSION"}</div>
            <h2 id="dialog-title">{editing ? "Edit your review criteria" : "Add a resume"}</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Close dialog"
            onClick={() => {
              setEditing(false);
              setUploading(false);
              setError("");
            }}
          >
            <X size={20} />
          </button>
        </div>
        {editing ? (
          <>
            <p className="dialog-description">
              Use explicit, job-related requirements. Changing criteria clears existing assessments.
            </p>
            <label className="form-label" htmlFor="role-title">
              Role title
            </label>
            <input
              id="role-title"
              className="form-input"
              value={draftTitle}
              maxLength={100}
              onChange={(event) => setDraftTitle(event.target.value)}
              autoFocus
            />
            <label className="form-label" htmlFor="role-criteria">
              Requirements <span>One per line · up to 12</span>
            </label>
            <textarea
              id="role-criteria"
              className="form-input criteria-input"
              value={draftCriteria}
              onChange={(event) => setDraftCriteria(event.target.value)}
            />
            <div className="dialog-footer">
              <button
                className="button button-secondary"
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button className="button button-primary" onClick={saveCriteria}>
                Save criteria
                <Check size={15} />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-description">
              Upload a document or paste text. Check the extracted content before assessment.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void parseFile(file);
                event.target.value = "";
              }}
            />
            <button
              className="upload-zone"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
              <strong>
                {busy ? "Reading document…" : (parsedFile?.filename ?? "Choose a resume file")}
              </strong>
              <span>PDF, DOCX, or TXT · 5 MB maximum · Text documents only</span>
            </button>
            <label className="form-label" htmlFor="candidate-name">
              Display name
            </label>
            <input
              id="candidate-name"
              className="form-input"
              value={candidateName}
              maxLength={100}
              onChange={(event) => setCandidateName(event.target.value)}
              autoFocus
            />
            <label className="form-label" htmlFor="resume-text">
              Resume text <span>Review or paste here</span>
            </label>
            <textarea
              id="resume-text"
              className="form-input resume-input"
              value={uploadText}
              maxLength={24_000}
              placeholder="Paste resume text, or upload a file above…"
              onChange={(event) => {
                setUploadText(event.target.value);
                setParsedFile((current) => (current ? { ...current, passages: [] } : null));
              }}
            />
            <p className="data-note">
              Files are parsed and discarded. With Jev configured, assessment sends resume passages
              and role criteria to TypeSafe. Nothing is saved across refreshes.
            </p>
            <div className="dialog-footer">
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setUploading(false);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={addResume}>
                Add resume
                <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="alert alert-error dialog-error" role="alert">
            {error}
          </div>
        )}
      </dialog>
    </div>
  );
}
