"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  ListChecks,
  Search,
  X,
} from "lucide-react";
import { Select } from "@/components/select";
import { WorkspaceShell, type WorkspaceSection } from "@/components/workspace-shell";
import {
  DEMO_FOLDERS,
  DEMO_JOBS,
  DEMO_RESUMES,
  DEMO_SKILLS,
  demoAssessment,
  demoCandidates,
  demoCsv,
  type DemoJob,
  type DemoResume,
} from "@/lib/demo-data";
import { downloadText } from "@/lib/download";
import { STATUS_LABELS } from "@/lib/types";

const PAGE_SIZE = 20;
const initialRuns = Object.fromEntries(DEMO_JOBS.map((job) => [job.id, job.folderIds]));
const initialSaved = Object.fromEntries(
  DEMO_JOBS.map((job) => [
    job.id,
    demoCandidates(job, job.folderIds)
      .filter((candidate) => candidate.suggested)
      .slice(0, 3)
      .map((candidate) => candidate.resume.id),
  ]),
);

export function DemoWorkspace({ returnTo }: { returnTo: string }) {
  const [section, setSection] = useState<WorkspaceSection>("jobs");
  const [jobId, setJobId] = useState(DEMO_JOBS[0].id);
  const [runs, setRuns] = useState<Record<string, string[]>>(initialRuns);
  const [saved, setSaved] = useState<Record<string, string[]>>(initialSaved);
  const [matching, setMatching] = useState<DemoJob | null>(null);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [libraryFolder, setLibraryFolder] = useState("");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [minimumScore, setMinimumScore] = useState("0");
  const [experience, setExperience] = useState("");
  const [resultView, setResultView] = useState("suggested");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewing, setViewing] = useState<DemoResume | null>(null);
  const [activeSkill, setActiveSkill] = useState("");
  const [notice, setNotice] = useState("");
  const [exports, setExports] = useState<
    { id: string; filename: string; count: number; job: string }[]
  >([]);
  const matchingDialog = useRef<HTMLDialogElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const job = DEMO_JOBS.find((item) => item.id === jobId)!;
  const allResults = demoCandidates(job, runs[job.id]);
  const suggestions = allResults.filter((result) => result.suggested);
  const confirmed = saved[job.id];
  const filtered = allResults.filter(
    (result) =>
      (resultView === "all" ||
        (resultView === "saved" ? confirmed.includes(result.resume.id) : result.suggested)) &&
      (!folderFilter || result.resume.folderId === folderFilter) &&
      result.score >= Number(minimumScore) &&
      (!experience || result.resume.experience === experience) &&
      result.resume.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const library = DEMO_RESUMES.filter(
    (resume) =>
      (!libraryFolder || resume.folderId === libraryFolder) &&
      resume.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const currentRows = (section === "library" ? library : filtered).slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const total = section === "library" ? library.length : filtered.length;

  useEffect(() => {
    if (matching) matchingDialog.current?.showModal();
    else matchingDialog.current?.close();
  }, [matching]);
  useEffect(() => {
    if (viewing) reviewDialog.current?.showModal();
    else reviewDialog.current?.close();
  }, [viewing]);

  function navigate(next: WorkspaceSection) {
    setSection(next);
    setSearch("");
    setPage(1);
    setSelected([]);
    setNotice("");
  }
  function changeJob(value: string) {
    setJobId(value);
    setPage(1);
    setSelected([]);
    setSearch("");
    setFolderFilter("");
    setNotice("");
  }
  function openMatch(item: DemoJob) {
    setMatching(item);
    setFolderIds([...runs[item.id]]);
  }
  function showResults(item: DemoJob) {
    changeJob(item.id);
    navigate("shortlists");
    setResultView("suggested");
  }
  function showResume(resume: DemoResume) {
    setActiveSkill(job.required[0]);
    setViewing(resume);
  }
  function exportResults(resumes: DemoResume[], suffix: string) {
    if (!resumes.length) return;
    const filename = `rolelens-demo-${job.id}-${suffix}.csv`;
    downloadText(demoCsv(job, resumes, confirmed), filename);
    setExports((current) => [
      { id: crypto.randomUUID(), filename, count: resumes.length, job: job.title },
      ...current,
    ]);
    setNotice(
      `Exported ${resumes.length} fictional applicants. The CSV labels every row as demo data.`,
    );
  }
  function toggleSaved() {
    if (!viewing) return;
    setSaved((current) => ({
      ...current,
      [job.id]: current[job.id].includes(viewing.id)
        ? current[job.id].filter((id) => id !== viewing.id)
        : [...current[job.id], viewing.id],
    }));
    setViewing(null);
    setNotice("Example shortlist updated for this session.");
  }
  const pagination = (
    <div className="inbox-pagination">
      <span>
        {total} {section === "library" ? "resumes" : "results"} · page {page} of{" "}
        {Math.max(1, Math.ceil(total / PAGE_SIZE))}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page * PAGE_SIZE >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <WorkspaceShell section={section} demo returnTo={returnTo} onNavigate={navigate}>
      {notice && (
        <div className="alert alert-notice" role="status">
          {notice}
          <button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {section === "jobs" && (
        <>
          <div className="page-heading">
            <div>
              <h1>Jobs</h1>
              <p>Explore example roles, choose resume folders, and preview a proposed shortlist.</p>
            </div>
            <Link href="/jobs" className="button button-secondary">
              Create a real job
            </Link>
          </div>
          <div className="workspace-summary">
            <div>
              <span>Sample resumes</span>
              <strong>200</strong>
            </div>
            <div>
              <span>Resume folders</span>
              <strong>3</strong>
            </div>
            <div>
              <span>Example jobs</span>
              <strong>2</strong>
            </div>
          </div>
          <div className="section-heading">
            <h2>Example jobs</h2>
            <span>Prepared results are ready to explore</span>
          </div>
          <div className="job-card-grid">
            {DEMO_JOBS.map((item) => (
              <article className="job-card" key={item.id}>
                <div className="card-icon">
                  <BriefcaseBusiness size={18} />
                </div>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
                <div className="job-card-meta">
                  <span>{item.required.length} required criteria</span>
                  <span>{item.preferred.length} preferred</span>
                </div>
                <div className="job-card-meta">
                  <span>
                    {demoCandidates(item, runs[item.id]).length} resumes in selected folders
                  </span>
                </div>
                <div className="card-actions">
                  <button className="button button-primary" onClick={() => openMatch(item)}>
                    <ListChecks size={15} />
                    Shortlist
                  </button>
                  <button className="button button-secondary" onClick={() => showResults(item)}>
                    View example results
                    <ChevronRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="workflow-note">
            <FolderOpen size={19} />
            <div>
              <strong>One library, multiple jobs</strong>
              <p>
                Folders organize your resumes. Each job can search several folders without uploading
                the same document again. This demo illustrates that planned workflow.
              </p>
            </div>
          </div>
        </>
      )}
      {section === "library" && (
        <>
          <div className="page-heading">
            <div>
              <h1>Resume library</h1>
              <p>
                200 fictional profiles organized into folders. No real candidate documents are
                included.
              </p>
            </div>
            <Link href="/" className="button button-secondary">
              Import in workspace
            </Link>
          </div>
          <div className="folder-grid">
            {DEMO_FOLDERS.map((folder) => (
              <button
                className={`folder-card ${libraryFolder === folder.id ? "active" : ""}`}
                key={folder.id}
                aria-pressed={libraryFolder === folder.id}
                onClick={() => {
                  setLibraryFolder(libraryFolder === folder.id ? "" : folder.id);
                  setPage(1);
                  setSearch("");
                }}
              >
                <FolderOpen size={22} />
                <strong>{folder.name}</strong>
                <span>{folder.count} resumes</span>
              </button>
            ))}
          </div>
          <div className="inbox-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search demo resumes"
                placeholder="Search applicants"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <Select
              aria-label="Filter library folder"
              value={libraryFolder}
              onValueChange={(value) => {
                setLibraryFolder(value);
                setPage(1);
              }}
              options={[
                { value: "", label: "All folders" },
                ...DEMO_FOLDERS.map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
            />
          </div>
          <div className="inbox-table-wrap">
            <table className="inbox-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Folder</th>
                  <th>Experience</th>
                  <th>Document example</th>
                </tr>
              </thead>
              <tbody>
                {(currentRows as DemoResume[]).map((resume) => (
                  <tr key={resume.id}>
                    <td>
                      <button onClick={() => showResume(resume)}>
                        {resume.name}
                        <span>Fictional profile</span>
                      </button>
                    </td>
                    <td>{DEMO_FOLDERS.find((folder) => folder.id === resume.folderId)!.name}</td>
                    <td>{resume.experience}</td>
                    <td>{resume.filename.split(".").at(-1)?.toUpperCase()} · text preview</td>
                  </tr>
                ))}
                {!currentRows.length && (
                  <tr>
                    <td colSpan={4} className="inbox-empty">
                      No sample resumes match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pagination}
        </>
      )}
      {section === "shortlists" && (
        <>
          <div className="page-heading">
            <div>
              <h1>Proposed shortlist</h1>
              <p>
                Preset evidence comparisons for {job.title}. Inspect a profile before saving an
                example selection.
              </p>
            </div>
            <button className="button button-secondary" onClick={() => openMatch(job)}>
              <FolderOpen size={15} />
              Change folders
            </button>
          </div>
          <div className="results-context">
            <Select
              aria-label="Shortlist job"
              value={jobId}
              onValueChange={changeJob}
              options={DEMO_JOBS.map((item) => ({ value: item.id, label: item.title }))}
            />
            <span>
              {runs[job.id]
                .map((id) => DEMO_FOLDERS.find((folder) => folder.id === id)!.name)
                .join(" + ")}
            </span>
          </div>
          <div className="workspace-summary">
            <div>
              <span>Assessed examples</span>
              <strong>{allResults.length}</strong>
            </div>
            <div>
              <span>Suggested matches</span>
              <strong>{suggestions.length}</strong>
            </div>
            <div>
              <span>Example saved shortlist</span>
              <strong>{confirmed.length}</strong>
            </div>
          </div>
          <div className="result-tabs" aria-label="Result views">
            {[
              { value: "suggested", label: "Suggested", count: suggestions.length },
              { value: "all", label: "All assessed", count: allResults.length },
              { value: "saved", label: "Saved shortlist", count: confirmed.length },
            ].map((item) => (
              <button
                key={item.value}
                className={resultView === item.value ? "active" : ""}
                aria-pressed={resultView === item.value}
                onClick={() => {
                  setResultView(item.value);
                  setPage(1);
                  setSelected([]);
                }}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>
          <div className="shortlist-filters">
            <label className="search-field">
              <Search size={15} />
              <input
                aria-label="Search shortlist"
                placeholder="Search applicants"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <Select
              aria-label="Filter source folder"
              value={folderFilter}
              onValueChange={(value) => {
                setFolderFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: "All selected folders" },
                ...DEMO_FOLDERS.filter((folder) => runs[job.id].includes(folder.id)).map(
                  (folder) => ({ value: folder.id, label: folder.name }),
                ),
              ]}
            />
            <Select
              aria-label="Minimum evidence coverage"
              value={minimumScore}
              onValueChange={(value) => {
                setMinimumScore(value);
                setPage(1);
              }}
              options={[
                { value: "0", label: "Any evidence coverage" },
                { value: "60", label: "Coverage ≥ 60%" },
                { value: "80", label: "Coverage ≥ 80%" },
                { value: "100", label: "Coverage 100%" },
              ]}
            />
            <Select
              aria-label="Filter experience"
              value={experience}
              onValueChange={(value) => {
                setExperience(value);
                setPage(1);
              }}
              options={[
                { value: "", label: "All experience levels" },
                { value: "Entry-level", label: "Entry-level" },
                { value: "Experienced", label: "Experienced" },
              ]}
            />
            <button
              className="text-button"
              onClick={() => {
                setSearch("");
                setFolderFilter("");
                setMinimumScore("0");
                setExperience("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
          <div className="selection-toolbar">
            <span>
              {filtered.length} results · {selected.length} selected
            </span>
            <div>
              <button
                className="button button-secondary"
                disabled={!selected.length}
                onClick={() =>
                  exportResults(
                    allResults
                      .filter((result) => selected.includes(result.resume.id))
                      .map((result) => result.resume),
                    "selected",
                  )
                }
              >
                <ArrowDownToLine size={14} />
                Export selected
              </button>
              <button
                className="button button-secondary"
                disabled={!filtered.length}
                onClick={() =>
                  exportResults(
                    filtered.map((result) => result.resume),
                    "filtered",
                  )
                }
              >
                Export filtered results
              </button>
            </div>
          </div>
          <div className="inbox-table-wrap">
            <table className="inbox-table shortlist-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select current page"
                      checked={
                        currentRows.length > 0 &&
                        currentRows.every((row) =>
                          selected.includes("resume" in row ? row.resume.id : row.id),
                        )
                      }
                      onChange={(event) => {
                        const ids = filtered
                          .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                          .map((result) => result.resume.id);
                        setSelected(
                          event.target.checked
                            ? [...new Set([...selected, ...ids])]
                            : selected.filter((id) => !ids.includes(id)),
                        );
                      }}
                    />
                  </th>
                  <th>Applicant</th>
                  <th>Evidence coverage</th>
                  <th>Required</th>
                  <th>Preferred</th>
                  <th>Evidence gaps</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((result) => (
                  <tr key={result.resume.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${result.resume.name}`}
                        checked={selected.includes(result.resume.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, result.resume.id]
                              : selected.filter((id) => id !== result.resume.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button onClick={() => showResume(result.resume)}>
                        {result.resume.name}
                        <span>
                          {
                            DEMO_FOLDERS.find((folder) => folder.id === result.resume.folderId)!
                              .name
                          }
                        </span>
                      </button>
                    </td>
                    <td>
                      <div className="coverage-score">
                        <strong>{result.score}%</strong>
                        <meter
                          min={0}
                          max={100}
                          value={result.score}
                          aria-label={`${result.resume.name} evidence coverage`}
                        />
                      </div>
                    </td>
                    <td>
                      {result.requiredSupported} / {job.required.length}
                    </td>
                    <td>
                      {result.preferredSupported} / {job.preferred.length}
                    </td>
                    <td>
                      {result.unclear
                        ? `${result.unclear} unclear`
                        : result.findings.some((finding) => finding.status !== "SUPPORTED")
                          ? "Partial or missing"
                          : "None in fixture"}
                    </td>
                    <td>
                      {confirmed.includes(result.resume.id) ? (
                        <span className="review-done">
                          <Check size={12} />
                          Example saved
                        </span>
                      ) : (
                        "Unreviewed"
                      )}
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="inbox-empty">
                      No results match these filters. Try All assessed or clear your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pagination}
          <p className="coverage-explanation">
            Evidence coverage counts supported criteria as 1 and partial evidence as 0.5 across all
            criteria. Missing or unclear evidence contributes 0. It is not model confidence or
            predicted job performance. Suggestions have support for every required criterion; all
            assessed examples remain accessible.
          </p>
        </>
      )}
      {section === "exports" && (
        <>
          <div className="page-heading">
            <div>
              <h1>Exports</h1>
              <p>
                Download example comparisons or your saved demo shortlist. Every CSV identifies its
                fictional provenance.
              </p>
            </div>
          </div>
          <div className="results-context">
            <Select
              aria-label="Export job"
              value={jobId}
              onValueChange={changeJob}
              options={DEMO_JOBS.map((item) => ({ value: item.id, label: item.title }))}
            />
          </div>
          <div className="job-card-grid">
            <article className="job-card">
              <ListChecks size={21} />
              <h2>Saved shortlist</h2>
              <p>
                {confirmed.length} example reviewer selections for {job.title}. Add or remove
                selections by opening a profile in Shortlists.
              </p>
              <button
                className="button button-primary"
                disabled={!confirmed.length}
                onClick={() =>
                  exportResults(
                    allResults
                      .filter((result) => confirmed.includes(result.resume.id))
                      .map((result) => result.resume),
                    "saved-shortlist",
                  )
                }
              >
                <ArrowDownToLine size={15} />
                Export entire saved shortlist
              </button>
            </article>
            <article className="job-card">
              <FileText size={21} />
              <h2>All assessment results</h2>
              <p>
                {allResults.length} fictional applicants from the selected folders, including
                partial and unclear evidence.
              </p>
              <button
                className="button button-secondary"
                onClick={() =>
                  exportResults(
                    allResults.map((result) => result.resume),
                    "all-results",
                  )
                }
              >
                Export all results
              </button>
            </article>
          </div>
          <div className="section-heading">
            <h2>Downloads this session</h2>
            <span>Files are downloaded to your browser</span>
          </div>
          {!exports.length ? (
            <div className="compact-empty">Your example downloads will appear here.</div>
          ) : (
            <div className="inbox-table-wrap">
              <table className="inbox-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Job</th>
                    <th>Applicants</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((item) => (
                    <tr key={item.id}>
                      <td>{item.filename}</td>
                      <td>{item.job}</td>
                      <td>{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="coverage-explanation">
            This demo includes text previews, not original PDF or DOCX files. You can download an
            invented text resume from its profile.
          </p>
        </>
      )}
      <dialog
        ref={matchingDialog}
        aria-labelledby="demo-matching-title"
        className="matching-dialog"
        onCancel={() => setMatching(null)}
      >
        {matching && (
          <>
            <div className="dialog-header">
              <h2 id="demo-matching-title">{matching.title}</h2>
              <button
                className="icon-button"
                aria-label="Close folder selection"
                onClick={() => setMatching(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="dialog-description">{matching.description}</p>
            <div className="job-spec">
              <span>Experience</span>
              <p>{matching.experience}</p>
              <span>Required criteria</span>
              <ul>
                {matching.required.map((skill) => (
                  <li key={skill}>{DEMO_SKILLS[skill]}</li>
                ))}
              </ul>
              <span>Preferred criteria</span>
              <ul>
                {matching.preferred.map((skill) => (
                  <li key={skill}>{DEMO_SKILLS[skill]}</li>
                ))}
              </ul>
            </div>
            <fieldset className="folder-picker">
              <legend>Select resume folders</legend>
              {DEMO_FOLDERS.map((folder) => (
                <label key={folder.id}>
                  <input
                    type="checkbox"
                    checked={folderIds.includes(folder.id)}
                    onChange={(event) =>
                      setFolderIds(
                        event.target.checked
                          ? [...folderIds, folder.id]
                          : folderIds.filter((id) => id !== folder.id),
                      )
                    }
                  />
                  <FolderOpen size={17} />
                  <span>
                    {folder.name}
                    <small>{folder.count} fictional resumes</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="dialog-description">
              {DEMO_RESUMES.filter((resume) => folderIds.includes(resume.folderId)).length} sample
              resumes selected. This loads preset comparisons; it does not call Jev.
            </p>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={() => setMatching(null)}>
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={!folderIds.length}
                onClick={() => {
                  setRuns((current) => ({ ...current, [matching.id]: [...folderIds] }));
                  setSaved((current) => ({
                    ...current,
                    [matching.id]: current[matching.id].filter((id) =>
                      DEMO_RESUMES.some(
                        (resume) => resume.id === id && folderIds.includes(resume.folderId),
                      ),
                    ),
                  }));
                  showResults(matching);
                  setMatching(null);
                  setNotice("Preset comparisons loaded. No Jev assessment was performed.");
                }}
              >
                Generate demo shortlist
              </button>
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={reviewDialog}
        className="application-drawer"
        aria-label="Demo applicant review"
        onCancel={() => setViewing(null)}
      >
        {viewing && (
          <section className="persistent-review">
            <div className="review-header">
              <div>
                <h2>{viewing.name}</h2>
                <p>Fictional profile · {job.title}</p>
              </div>
              <div className="review-actions">
                <button
                  className="button button-secondary"
                  onClick={() =>
                    downloadText(
                      viewing.text,
                      `${viewing.id}-fictional.txt`,
                      "text/plain;charset=utf-8",
                    )
                  }
                >
                  <ArrowDownToLine size={14} />
                  Sample text
                </button>
                <button
                  className="icon-button"
                  aria-label="Close demo applicant"
                  onClick={() => setViewing(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="demo-review-note">
              Preset findings for a fictional resume. This is not a Jev assessment.
            </div>
            <div className="evidence-layout">
              <div className="findings-panel">
                <div className="table-label">
                  <span>Requirement</span>
                  <span>Preset finding</span>
                </div>
                {demoAssessment(viewing, job).findings.map((finding, index) => (
                  <button
                    key={finding.skill}
                    className={`finding-row ${activeSkill === finding.skill ? "finding-selected" : ""}`}
                    aria-pressed={activeSkill === finding.skill}
                    onClick={() => setActiveSkill(finding.skill)}
                  >
                    <span className="requirement-index">{index + 1}</span>
                    <span className="requirement-text">
                      {finding.label}
                      <small>{finding.required ? "Required" : "Preferred"}</small>
                    </span>
                    <span className={`status-badge status-${finding.status.toLowerCase()}`}>
                      {STATUS_LABELS[finding.status]}
                    </span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
              <aside className="source-panel">
                <div className="source-heading">
                  <FileText size={16} />
                  <h3>Fictional resume evidence</h3>
                </div>
                <pre className="resume-text">
                  {viewing.text.split("\n\n").map((paragraph, index) => (
                    <span key={index}>
                      {paragraph.toLowerCase().includes(activeSkill) ? (
                        <mark>{paragraph}</mark>
                      ) : (
                        paragraph
                      )}
                      {"\n\n"}
                    </span>
                  ))}
                </pre>
              </aside>
            </div>
            <div className="reviewer-notes">
              <p>
                Inspect the example evidence before saving a selection. Real hiring advancement
                requires a recruiter’s decision.
              </p>
              <div>
                <span>
                  {confirmed.includes(viewing.id)
                    ? "Included in the example saved shortlist"
                    : "Not yet selected by a reviewer"}
                </span>
                <button
                  className={`button ${confirmed.includes(viewing.id) ? "button-secondary" : "button-primary"}`}
                  onClick={toggleSaved}
                >
                  {confirmed.includes(viewing.id)
                    ? "Remove from saved shortlist"
                    : "Add to saved shortlist"}
                </button>
              </div>
            </div>
          </section>
        )}
      </dialog>
    </WorkspaceShell>
  );
}
