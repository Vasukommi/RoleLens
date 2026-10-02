import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "data/demo");
const output = path.join(directory, "recording");
await fs.mkdir(output, { recursive: true });
const state = JSON.parse(await fs.readFile(path.join(directory, "state.json"), "utf8"));
const files = (await fs.readdir(path.join(directory, "resumes")))
  .filter((name) => name.endsWith(".pdf"))
  .sort()
  .map((name) => path.join(directory, "resumes", name));
if (files.length !== 200) throw new Error("Prepare exactly 200 PDFs before recording.");

const browser = await chromium.launch({ headless: true, slowMo: 100 });
const size = { width: 1440, height: 900 };
const resumeRun = process.argv.includes("--resume");
const report = resumeRun
  ? JSON.parse(await fs.readFile(path.join(directory, "recording-report.json"), "utf8"))
  : { source: "local PDF sample", selected: files.length, clips: [] };
const clips = report.clips;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(endpoint) {
  const response = await fetch(`${state.api_url}/api/v1/${endpoint}`);
  if (!response.ok) throw new Error(`Demo API returned ${response.status}.`);
  return response.json();
}

async function caption(page, text) {
  await page.evaluate((label) => {
    let element = document.querySelector("#recording-caption");
    if (!element) {
      element = document.createElement("div");
      element.id = "recording-caption";
      element.style.cssText =
        "position:fixed;z-index:2147483647;top:8px;left:50%;transform:translateX(-50%);" +
        "background:#24292e;color:white;padding:9px 18px;border-radius:6px;" +
        "font:500 14px/1.4 system-ui;pointer-events:none;box-shadow:0 2px 8px #0001;";
      document.body.append(element);
    }
    element.textContent = label;
  }, text);
}

async function openRecording() {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    recordVideo: { dir: output, size },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  return { context, page };
}

async function finish(context, page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const video = page.video();
  await context.close();
  const destination = path.join(output, `${name}.webm`);
  await video.saveAs(destination);
  if (!clips.includes(destination)) clips.push(destination);
  await fs.writeFile(
    path.join(directory, "recording-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`Recorded ${name}.`);
}

async function showInbox(page, title) {
  await page.goto(state.web_url);
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Worker online", { exact: true })).toBeVisible();
}

try {
  if (!resumeRun) {
    const first = await openRecording();
    const logo = await fs.readFile(path.join(root, "apps/web/assets/logo - 1.png"));
    await first.page.setContent(`<html><body style="margin:0;background:#f8f9fb;color:#24292e;
    font-family:system-ui;height:100vh;display:grid;place-items:center">
    <div style="text-align:center"><img width="260" src="data:image/png;base64,${logo.toString("base64")}">
    <p style="font-size:13px;letter-spacing:3px;color:#647080;margin-top:32px">OPEN SOURCE · SELF HOSTABLE</p>
    <h1 style="font-size:62px;line-height:1.15;letter-spacing:-3px;margin:20px 0">200 resumes.<br>One review inbox.</h1>
    <p style="font-size:20px;color:#647080">Automated intake. Source-linked evidence. Human review.</p>
    <p style="font-size:13px;color:#88919d;margin-top:44px">Local development preview · Actual application workflow</p>
    </div></body></html>`);
    await pause(4500);
    await first.page.goto(state.web_url);
    await first.page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
    await caption(first.page, "01 / Create a job once. Define explicit evidence requirements.");
    await first.page.getByRole("button", { name: "New job", exact: true }).click();
    const title = "Resume intake — 200 PDFs";
    await first.page.getByLabel("Job title").pressSequentially(title, { delay: 45 });
    await first.page
      .getByLabel("Job requirements", { exact: false })
      .fill("Built Python APIs\nWorked with PostgreSQL databases\nDeployed services on AWS");
    await pause(2500);
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Create job", exact: true })
      .click();
    await expect(first.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const jobs = await api("jobs");
    report.bulk_job_id = jobs.find((job) => job.title === title).id;
    report.bulk_job_title = title;
    await caption(first.page, "02 / Import 200 real PDFs together. Applicant labels are aliases.");
    await pause(1800);
    await first.page.locator('input[type="file"]').setInputFiles(files);
    await expect(first.page.getByText("200 / 200 files accepted", { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await pause(2000);
    await caption(
      first.page,
      "The worker parses and assesses in the background. Failures stay visible.",
    );
    await pause(4500);
    await finish(first.context, first.page, "01-bulk-intake");
  }

  const started = Date.now();
  const deadline = started + 30 * 60 * 1000;
  let summary;
  while (Date.now() < deadline) {
    summary = await api(`jobs/${report.bulk_job_id}/summary`);
    const active = ["QUEUED", "PROCESSING", "RETRY_WAIT"].reduce(
      (total, key) => total + (summary.statuses[key] ?? 0),
      0,
    );
    console.log(`Bulk processing: ${JSON.stringify(summary.statuses)}`);
    if (active === 0 && summary.total === 200) break;
    await pause(20000);
  }
  if (
    !summary ||
    Object.keys(summary.statuses).some((key) =>
      ["QUEUED", "PROCESSING", "RETRY_WAIT", "AWAITING_PROVIDER"].includes(key),
    )
  )
    throw new Error("The sample did not finish processing. Check worker status before recording.");
  report.bulk_summary = summary;
  report.processing_wait_seconds = Math.round((Date.now() - started) / 1000);
  const second = await openRecording();
  await showInbox(second.page, report.bulk_job_title);
  await caption(second.page, "03 / Processing complete. This cut skips the waiting time.");
  await expect(
    second.page.getByText("200 applications · page 1 of 4", { exact: true }),
  ).toBeVisible();
  await pause(5000);
  await second.page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    second.page.getByText("200 applications · page 2 of 4", { exact: true }),
  ).toBeVisible();
  await pause(2500);
  await second.page.getByRole("button", { name: "Next page", exact: true }).click();
  await second.page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    second.page.getByText("200 applications · page 4 of 4", { exact: true }),
  ).toBeVisible();
  await pause(2500);
  if (summary.statuses.FAILED) {
    await caption(
      second.page,
      "Unsupported documents are isolated. Other applications keep processing.",
    );
    await second.page.getByLabel("Filter processing status").selectOption("FAILED");
    await pause(3500);
    await second.page.getByLabel("Filter processing status").selectOption("");
  }
  await finish(second.context, second.page, "02-processed-inbox");

  const third = await openRecording();
  const page = third.page;
  await page.goto(state.careers_url);
  await caption(page, "04 / New applications can arrive automatically from a careers form.");
  await pause(3000);
  await page
    .getByLabel("Name", { exact: true })
    .pressSequentially("Maya Shah — fictional", { delay: 65 });
  const resume = await fs.readFile(path.join(root, "examples/demo/fictional-resume.txt"));
  await page.getByLabel("Resume", { exact: true }).setInputFiles({
    name: "Maya-Shah-fictional.txt",
    mimeType: "text/plain",
    buffer: resume,
  });
  await pause(1500);
  await page.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(
    page.getByText("Application received. The team can now review your resume."),
  ).toBeVisible();
  await pause(2500);
  await showInbox(page, state.example_job_title);
  await caption(
    page,
    "05 / The application arrives in the inbox. This profile is fictional; Jev is live.",
  );
  await page
    .getByRole("button", { name: /Maya Shah — fictional/ })
    .first()
    .click();
  await expect(page.locator(".persistent-review .status-badge").first()).toBeVisible({
    timeout: 120000,
  });
  const example = await api(`jobs/${state.example_job_id}/applications?search=Maya`);
  report.fictional_application_id = example.items[0].id;
  const detail = await api(`applications/${example.items[0].id}`);
  report.fictional_assessment = detail.assessment;
  await caption(
    page,
    "Check each requirement against the original passage. A resume claim is not verified ability.",
  );
  await pause(4000);
  await page.getByRole("button", { name: /Worked with PostgreSQL databases/ }).click();
  await pause(3500);
  await page.getByRole("button", { name: /Wrote automated tests using pytest/ }).click();
  await pause(3500);
  await page.getByRole("button", { name: /Operated Kafka pipelines/ }).click();
  await caption(page, "Not mentioned means missing resume evidence—not missing ability.");
  await pause(4000);
  await page.getByRole("button", { name: /Wrote automated tests using pytest/ }).click();
  await page.getByLabel("Reviewer correction", { exact: true }).selectOption("UNCLEAR");
  await caption(page, "06 / A reviewer can correct a finding and record the follow-up needed.");
  await page
    .getByLabel("Review notes", { exact: true })
    .pressSequentially(
      "Ask for an automated testing example. Pytest is listed, but project evidence is missing.",
      { delay: 32 },
    );
  await page.getByLabel("Review complete", { exact: true }).check();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  await pause(2500);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "fictional-review.csv"));
  await page.reload();
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  await page.getByRole("button", { name: state.example_job_title, exact: true }).click();
  await page
    .getByRole("button", { name: /Maya Shah — fictional/ })
    .first()
    .click();
  await expect(page.getByLabel("Review notes", { exact: true })).toHaveValue(
    "Ask for an automated testing example. Pytest is listed, but project evidence is missing.",
  );
  await caption(
    page,
    "Saved review survives refresh. Original model findings remain separate from corrections.",
  );
  await pause(4500);
  await finish(third.context, third.page, "03-careers-and-review");

  const last = await openRecording();
  await last.page.setContent(`<html><body style="margin:0;background:#f8f9fb;color:#24292e;
    font-family:system-ui;height:100vh;display:grid;place-items:center">
    <div style="text-align:center"><h1 style="font-size:54px;letter-spacing:-2px">Evidence for reviewers.<br>Hiring decisions stay with people.</h1>
    <p style="font-size:24px;color:#08756a;margin-top:40px">github.com/Vasukommi/RoleLens</p>
    <p style="font-size:15px;color:#647080;margin-top:32px">Next.js · FastAPI · Jev · PostgreSQL</p>
    <p style="font-size:13px;color:#88919d">Local development preview · Reviewer authentication and ATS connectors pending</p>
    </div></body></html>`);
  await pause(5000);
  await finish(last.context, last.page, "04-end-card");
  console.log(`Demo recording complete. Assets: ${output}`);
} finally {
  await browser.close();
}
