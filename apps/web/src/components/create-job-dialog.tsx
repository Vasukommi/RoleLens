"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Job, JobInterpretation, JobRequirement } from "@/lib/inbox-types";
import { Select } from "@/components/select";

const PRIORITIES = [
  { value: "REQUIRED", label: "Required" },
  { value: "PREFERRED", label: "Preferred" },
  { value: "UNSPECIFIED", label: "Not specified" },
];
const MODES = {
  RESUME_EVIDENCE: "Resume evidence",
  VERIFY_SEPARATELY: "Verify separately",
  INTERVIEW: "Interview assessment",
};

export function CreateJobDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (job: Job) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [manual, setManual] = useState(false);
  const [manualCriteria, setManualCriteria] = useState("");
  const [draft, setDraft] = useState<JobInterpretation | null>(null);
  const [requirements, setRequirements] = useState<JobRequirement[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);

  function invalidate() {
    setDraft(null);
    setError("");
  }

  async function analyze(createAutomatically = false) {
    if (!title.trim() || description.trim().length < 30) {
      setError("Enter a title and a job description of at least 30 characters.");
      return;
    }
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const result = await api<JobInterpretation>("job-interpretations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
        signal: controller.current.signal,
      });
      setDraft(result);
      const proposed = result.requirements.map((item) => ({
        ...item,
        assessment_mode:
          item.assessment_mode === "RESUME_EVIDENCE" && result.validation[item.id] !== "GROUNDED"
            ? ("VERIFY_SEPARATELY" as const)
            : item.assessment_mode,
      }));
      setRequirements(proposed);
      setExcluded([]);
      if (createAutomatically) await create(result, proposed);
    } catch (failure) {
      if ((failure as Error).name !== "AbortError") setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateRequirement(id: string, changes: Partial<JobRequirement>) {
    setRequirements((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  async function create(source = draft, proposed = requirements) {
    const selected = manual
      ? manualCriteria
          .split("\n")
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text, index) => ({ id: `r${index + 1}`, text, priority: "REQUIRED" as const }))
      : source !== draft
        ? proposed
        : proposed.filter((item) => !excluded.includes(item.id));
    if (
      !title.trim() ||
      selected.length < 1 ||
      selected.length > 32 ||
      selected.some((item) => item.text.trim().length < 3 || item.text.length > 300)
    ) {
      setError("Enter a title and 1–32 criteria, 3–300 characters each.");
      return;
    }
    if (!manual && !source) {
      setError("Analyze the description before creating the job.");
      return;
    }
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const job = await api<Job>("jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          requirements: selected,
          ...(!manual && source ? { interpretation_id: source.id } : {}),
        }),
        signal: controller.current.signal,
      });
      onCreated(job);
    } catch (failure) {
      if ((failure as Error).name !== "AbortError") setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="job-description-dialog"
      aria-labelledby="new-job-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="new-job-title">Create a job</h2>
        <button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="dialog-description">
        {manual
          ? "Enter your own assessment criteria. These are saved as employer-authored requirements."
          : draft
            ? "Adjust these criteria if needed. Matching and shortlisting run automatically."
            : "Paste your job description. We will prepare screening criteria automatically; resumes qualify when all selected criteria are supported."}
      </p>
      <label className="form-label" htmlFor="job-name">
        Job title
      </label>
      <input
        id="job-name"
        className="form-input"
        maxLength={100}
        value={title}
        disabled={busy}
        onChange={(event) => {
          setTitle(event.target.value);
          invalidate();
        }}
        autoFocus
      />

      {manual ? (
        <>
          <label className="form-label" htmlFor="job-requirements">
            Job requirements<span>One per line · up to 32</span>
          </label>
          <textarea
            id="job-requirements"
            className="form-input criteria-input"
            value={manualCriteria}
            disabled={busy}
            onChange={(event) => setManualCriteria(event.target.value)}
          />
        </>
      ) : (
        <>
          <label className="form-label" htmlFor="job-description">
            Job description<span>{description.length.toLocaleString()} / 24,000</span>
          </label>
          <textarea
            id="job-description"
            className="form-input criteria-input"
            maxLength={24000}
            value={description}
            disabled={busy}
            placeholder="Paste responsibilities, skills, experience, and any other role requirements."
            onChange={(event) => {
              setDescription(event.target.value);
              invalidate();
            }}
          />
          {!draft && (
            <p className="description-data-note">
              Analysis sends this description to OpenAI and, when configured, TypeSafe. Candidate
              resumes are not sent to OpenAI.
            </p>
          )}
          {draft && (
            <section className="interpretation-review" aria-label="Extracted criteria">
              <div className="interpretation-heading">
                <h3>Assessment criteria</h3>
                <span>{requirements.length} extracted</span>
              </div>
              <p>
                Priority stays “Not specified” when the description does not say required or
                preferred. Unspecified criteria count toward the default screening rules; change
                priorities if needed.
              </p>
              {draft.review_notes.length > 0 && (
                <div className="interpretation-notes">
                  <strong>Details to review</strong>
                  <ul>
                    {draft.review_notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              {requirements.map((item, index) => (
                <article className="interpreted-criterion" key={item.id}>
                  <div className="criterion-controls">
                    <label className="criterion-include">
                      <input
                        type="checkbox"
                        checked={!excluded.includes(item.id)}
                        disabled={busy}
                        aria-label={`Include criterion ${index + 1}`}
                        onChange={(event) => {
                          setExcluded((current) =>
                            event.target.checked
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          );
                        }}
                      />
                      Criterion {index + 1}
                    </label>
                    <Select
                      aria-label={`Priority for criterion ${index + 1}`}
                      value={item.priority ?? "UNSPECIFIED"}
                      disabled={busy || excluded.includes(item.id)}
                      options={PRIORITIES}
                      onValueChange={(priority) =>
                        updateRequirement(item.id, {
                          priority: priority as JobRequirement["priority"],
                        })
                      }
                    />
                  </div>
                  <textarea
                    className="form-input criterion-text"
                    aria-label={`Criterion ${index + 1}`}
                    maxLength={300}
                    value={item.text}
                    disabled={busy || excluded.includes(item.id)}
                    onChange={(event) => updateRequirement(item.id, { text: event.target.value })}
                  />
                  <div className="criterion-assessment-mode">
                    {MODES[item.assessment_mode ?? "RESUME_EVIDENCE"]}
                  </div>
                  {!!item.components?.length && (
                    <p className="criterion-review-note">
                      Match {item.component_operator === "ANY" ? "any" : "all"}:{" "}
                      {item.components.join(" · ")}
                    </p>
                  )}
                  {item.review_note && <p className="criterion-review-note">{item.review_note}</p>}
                  {draft.validation[item.id] !== "GROUNDED" && (
                    <p className="criterion-review-note">
                      Source interpretation needs verification. This criterion will remain
                      unassessed automatically.
                    </p>
                  )}
                  <details>
                    <summary>View original wording</summary>
                    <blockquote>{item.source_quote}</blockquote>
                  </details>
                </article>
              ))}
              <p className="description-data-note">
                The default threshold is 100% of required and unspecified criteria. Preferred and
                interview-only criteria are excluded from selection by default. Unverified source
                interpretations remain unresolved. You can adjust screening rules in Shortlists.
              </p>
            </section>
          )}
        </>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-footer job-description-actions">
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => {
            setManual(!manual);
            invalidate();
          }}
        >
          {manual ? "Use a job description" : "Enter criteria manually"}
        </button>
        {!manual && !draft && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void analyze()}
          >
            Preview criteria
          </button>
        )}
        <button className="button button-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void (manual || draft ? create() : analyze(true))}
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          Create job
        </button>
      </div>
    </dialog>
  );
}
