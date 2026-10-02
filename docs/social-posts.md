# Draft posts for the recorded demo

Review the video and the generated `data/demo/share/video-details.json` before publishing. These are drafts; nothing has been posted. The mixed-role 200-PDF sample demonstrates a workflow, not hiring quality or a validated throughput claim.

## LinkedIn

200 resume PDFs. One review inbox.

I’m building RoleLens, an open-source project that helps hiring teams inspect resume evidence against explicit job requirements.

Applications arrive through bulk import or a careers-form integration. A background worker extracts text, runs local OCR for scanned PDFs, and uses Jev for narrow evidence decisions. Reviewers inspect the source passages, correct findings, save notes, and export their review.

This demo uses 200 randomly sampled scanned PDFs: 199 completed processing, and one yielded too little readable text. Applicant names in the inbox are aliases; the close-up review uses a fictional profile with live Jev findings. The processing wait is cut from the video and labeled.

Finding something “not mentioned” means the resume lacks evidence. It does not establish that a person lacks the skill. RoleLens does not rank applicants or automate hiring decisions.

Built with Next.js, FastAPI, Jev, and PostgreSQL for the Compose deployment.

This is an active development preview. Reviewer authentication, retention controls, and dedicated ATS connectors are next areas to address.

Feedback and contributions are welcome, especially around real hiring workflows and integrations.

https://github.com/Vasukommi/RoleLens

#OpenSource #AIEngineering #DeveloperTools

## X

Building RoleLens: open-source resume evidence review.

200 PDFs → background OCR + Jev → reviewer inbox.

Source passages, human corrections, saved reviews. No candidate ranking.

Development preview. Close-up profile is fictional.

github.com/Vasukommi/RoleLens
