import { expect, test } from "@playwright/test";

test("bulk intake processes documents, paginates, deduplicates, and saves a review", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New job", exact: true }).click();
  const title = `Bulk job ${Date.now()}`;
  await page.getByLabel("Job title").fill(title);
  await page
    .getByLabel("Job requirements", { exact: false })
    .fill("Built React applications\nUsed TypeScript");
  await page.getByRole("dialog").getByRole("button", { name: "Create job", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const files = Array.from({ length: 51 }, (_, index) => ({
    name: `Synthetic-${index.toString().padStart(3, "0")}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(
      `Invented applicant ${index}. Built React applications using TypeScript and testing.`,
    ),
  }));
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      ...files,
      { ...files[0], name: "Duplicate.txt" },
      { name: "Broken.txt", mimeType: "text/plain", buffer: Buffer.from("too short") },
    ]);
  await expect(page.getByText("53 / 53 files accepted", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByText("1 duplicates · 0 failed uploads", { exact: true })).toBeVisible();
  await expect(page.getByText("52 applications · page 1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Worker online", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("52 applications · page 2 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await page.getByLabel("Search applications").fill("Synthetic 010");
  await page.getByRole("button", { name: /Synthetic 010/ }).click();
  await expect(page.locator(".persistent-review .resume-text")).toContainText(
    "Invented applicant 10",
  );
  await expect(page.locator(".persistent-review")).toContainText("Awaiting provider");
  await page.getByLabel("Review notes", { exact: true }).fill("Ask for a project example.");
  await page.getByLabel("Review complete", { exact: true }).check();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Search applications").fill("Synthetic 010");
  await page.getByRole("button", { name: /Synthetic 010/ }).click();
  await expect(page.getByLabel("Review notes", { exact: true })).toHaveValue(
    "Ask for a project example.",
  );
  await expect(page.getByLabel("Review complete", { exact: true })).toBeChecked();
});

test("external application arrives automatically and duplicate delivery returns its receipt", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New job", exact: true }).click();
  const title = `Integrated job ${Date.now()}`;
  await page.getByLabel("Job title").fill(title);
  await page.getByLabel("Job requirements", { exact: false }).fill("Built Python APIs");
  await page.getByRole("dialog").getByRole("button", { name: "Create job", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const jobs = await (await request.get("http://127.0.0.1:8010/api/v1/jobs")).json();
  const job = jobs.find((item: { title: string }) => item.title === title);
  const body = {
    job_id: job.id,
    source: "careers_form",
    external_id: "external-193",
    name: "Integrated Applicant",
    resume_text: "Invented applicant. Built Python APIs and maintained PostgreSQL databases.",
  };
  const headers = { Authorization: "Bearer synthetic-browser-token" };
  const first = await request.post("http://127.0.0.1:8010/api/v1/integrations/applications", {
    data: body,
    headers,
  });
  const duplicate = await request.post("http://127.0.0.1:8010/api/v1/integrations/applications", {
    data: body,
    headers,
  });
  expect(first.status()).toBe(202);
  expect((await duplicate.json()).id).toBe((await first.json()).id);
  await page.getByRole("button", { name: /Integrated Applicant/ }).click();
  await expect(page.locator(".persistent-review .resume-text")).toContainText("Built Python APIs");
  await expect(page.getByText("1 applications · page 1 of 1", { exact: true })).toBeVisible();
});

test("inbox navigation fits a mobile viewport", async ({ page, request }) => {
  const response = await request.post("http://127.0.0.1:8010/api/v1/jobs", {
    data: { title: "Mobile Inbox", requirements: [{ id: "r1", text: "Built React applications" }] },
  });
  expect(response.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mobile Inbox" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("careers form submits a real file to authenticated intake and the worker processes it", async ({
  page,
  request,
}) => {
  const form = await request.get("http://127.0.0.1:9010/");
  const html = await form.text();
  const externalId = html.match(/name="application_id" value="([0-9a-f-]+)"/)![1];
  const multipart = {
    name: "Careers Form Applicant",
    application_id: externalId,
    resume: {
      name: "synthetic-careers.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Invented applicant. Built Python APIs and operated PostgreSQL databases.",
      ),
    },
  };
  const first = await request.post("http://127.0.0.1:9010/apply", { multipart });
  const repeated = await request.post("http://127.0.0.1:9010/apply", { multipart });
  expect(first.status()).toBe(200);
  expect((await repeated.json()).receipt).toBe((await first.json()).receipt);
  await page.goto("/");
  await page.getByRole("button", { name: "Careers Form Example", exact: true }).click();
  await page.getByRole("button", { name: /Careers Form Applicant/ }).click();
  await expect(page.locator(".persistent-review .resume-text")).toContainText(
    "operated PostgreSQL",
  );
});
