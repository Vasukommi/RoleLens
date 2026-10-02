# Recording and sharing a RoleLens demo

The demo follows the actual product: a job receives a 200-PDF bulk import, the worker extracts text and calls hosted Jev, and a reviewer inspects source evidence and saves a correction. A separate careers form sends one fictional application automatically. No network responses or model findings are mocked for this recording.

The local PDF sample contains mixed job categories. It demonstrates document handling and the processing workflow, not applicant suitability, model accuracy, fairness, or a production capacity guarantee. The public video shows applicant aliases and counts; its only close-up resume is the [fictional fixture](../examples/demo/fictional-resume.txt). The processing wait is omitted between clips and explicitly labeled.

The recorded run selected 200 unique PDFs with seed `20261002`: 199 completed local OCR and live assessment; one yielded too little readable text and failed visibly. The fictional review used `jev-1.13.0`, with three supported requirements, a partial pytest mention, and Kafka not mentioned. The reviewer changed the testing finding to “Needs clarification” and saved a follow-up note. These observations are examples, not a quality evaluation.

## Prepare

Install dependencies using the README. Configure `TYPESAFE_API_KEY` in `apps/api/.env` and install Tesseract with English language data for scanned PDFs. Live assessment sends extracted resume passages and role requirements to TypeSafe and can incur charges. The randomly sampled dataset documents are not anonymized internally: aliases only change the displayed names and filenames. Use a source you are permitted to process; do not commit or publicly display its original files or personal details.

Select a reproducible sample from a local folder:

```sh
python3 scripts/prepare_demo.py "/path/to/Resumes PDF" --count 200 --seed 20261002
```

This copies the sample into ignored `data/demo/resumes/` and writes a private source mapping. It does not modify the dataset folder. It refuses to overwrite an existing sample.

Start the demo services in one terminal:

```sh
cd apps/api
uv run python ../../scripts/demo_server.py
```

The launcher uses a separate SQLite database at `data/demo/rolelens.db`, runs migrations, creates the fictional example job, and starts API `8011`, worker, and careers form `9011`. Its random integration token remains in server process environment; it is not stored in the recording metadata. Stop the launcher with Ctrl+C to stop all three services. It uses Tesseract from `PATH`; if a portable local installation exists under `data/demo/ocr-tools/bin`, the launcher checks it first.

Start Next.js in another terminal:

```sh
cd apps/web
API_BASE_URL=http://127.0.0.1:8011 npm run dev -- --port 3011
```

Next.js allows one development server for this app directory. Stop a regular development server before starting the demo server, and stop the demo server before running browser tests.

## Record automatically

From the root:

```sh
npx playwright install chromium
node scripts/record_demo.mjs
```

The recorder operates the real browser UI, uploads all 200 documents once, and waits for processing outside the recorded clips. It then records the paginated inbox, the actual careers-form submission, live fictional findings, a manual correction, a saved note, refresh persistence, and CSV export. Failed documents remain visible. It does not record the dataset's resume contents or source paths.

If interrupted after the first clip, use `node scripts/record_demo.mjs --resume` to reuse the existing job without uploading the 200 documents again. Starting without `--resume` creates another job and can repeat hosted assessment calls. An interrupted recording may leave additional raw clips in the private recording folder; the export script uses only its four named completed clips.

Use `--review-only` to rerecord the careers-form and review clips without repeating the bulk import. It submits another fictional application; existing fixture records remain unless you explicitly clean them up in the isolated demo database.

Export the video:

```sh
cd apps/api
uv run --with imageio-ffmpeg python ../../scripts/export_demo.py
```

Outputs in ignored `data/demo/share/`:

- `rolelens-demo.mp4`: full captioned workflow.
- `rolelens-demo-short.mp4`: shorter overview using cuts from that recording.
- `cover.png`: opening frame suitable as a cover.
- `video-details.json`: actual processing counts, video lengths, model, and editing notes.

The videos have on-screen captions and no audio. The selected files, database, source mapping, and raw recordings stay local. The reviewed short export is also available as a [public documentation asset](demo-assets/rolelens-demo-short.mp4); the full export remains local. Draft copy is in [social posts](social-posts.md).

## Record manually or add your voice

Open [the demo inbox](http://localhost:3011) and [careers form](http://localhost:9011). Record only the browser window using your preferred screen recorder. Avoid terminal windows, credentials, source mappings, and dataset resume details.

Use this speaking outline, adjusting the counts to the actual result:

1. “RoleLens helps hiring teams inspect resume evidence against explicit job requirements.”
2. “I define a job once and import 200 resume PDFs together. A separate worker handles extraction, OCR, and assessment in the background.”
3. “The inbox shows processing status and failures, with search, filters, and pagination. I have cut out the waiting time here.”
4. “Applications can also arrive automatically. This careers form sends a fictional applicant directly into the inbox.”
5. “Jev makes narrow evidence decisions. I can inspect the cited text, record a follow-up, and correct the finding.”
6. “The review persists across refreshes. Original findings remain separate from reviewer changes. Hiring decisions stay with people.”
7. “The project is open source and an active development preview. Reviewer authentication, retention controls, and named ATS connectors are still pending.”

## Share

For LinkedIn, attach the full MP4 and use the LinkedIn draft. For X, use the short MP4 and the short draft. Open each video once before uploading to check the pacing and readability. The source dataset link has not been recorded in this repository; add accurate attribution when you know its original Kaggle page. Do not describe this batch as a model accuracy evaluation or a production benchmark.

For GitHub, the README links to this guide and its public fictional fixture. A reviewed short MP4 can be included as a small documentation asset. To embed a video that plays directly in the README, upload the reviewed MP4 through GitHub's attachment UI, then paste the returned attachment URL into the README in a new PR. Raw recording clips, the full local export, and the dataset are excluded from repository history. No release or social post is published by the recording scripts.

The recording implementation follows [Playwright's video documentation](https://playwright.dev/docs/videos). Local OCR uses [Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) and [PDFium through pypdfium2](https://pypdfium2-team.github.io/pypdfium2/python_api.html).
