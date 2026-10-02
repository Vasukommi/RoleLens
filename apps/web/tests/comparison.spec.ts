import { expect, test } from "@playwright/test";

async function fixtureJob(request: import("@playwright/test").APIRequestContext) {
  const jobs = await (await request.get("http://127.0.0.1:8010/api/v1/jobs")).json();
  return jobs.find((j: { title: string }) => j.title === "Comparison fixture");
}

test("shortlist and downloads are automatic; optional evidence stays inspectable", async ({
  page,
  request,
}) => {
  const job = await fixtureJob(request);
  await page.goto(`/shortlists?job=${job.id}`);
  const alex = page.getByRole("row").filter({ hasText: "Alex Fixture" });
  const sam = page.getByRole("row").filter({ hasText: "Sam Fixture" });
  await expect(alex).toContainText("Shortlisted");
  await expect(sam).toContainText("Below threshold");
  await expect(page.getByRole("button", { name: "Approve shortlist" })).toHaveCount(0);
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Shortlist CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
  const documents = page.waitForEvent("download");
  await page.getByRole("button", { name: "Shortlisted resumes", exact: true }).click();
  expect((await documents).suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole("button", { name: /Alex Fixture/ }).click();
  const dialog = page.getByRole("dialog", { name: "Matching evidence", exact: true });
  await dialog.locator("summary").filter({ hasText: "TypeScript development" }).click();
  await expect(dialog.getByText("Synthetic fixture result.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close evidence review" }).click();
  await page.getByRole("combobox", { name: "Filter by criterion" }).click();
  await page.getByRole("option", { name: "TypeScript development", exact: true }).click();
  await expect(page.getByRole("button", { name: /Sam Fixture/ })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("evidence-comparison.png"),
    fullPage: true,
  });
});

test("screening rules update existing matches without reassessment and persist", async ({
  page,
  request,
}) => {
  const job = await fixtureJob(request);
  await page.goto(`/shortlists?job=${job.id}`);
  await page.getByRole("button", { name: "Adjust screening rules" }).click();
  await page.getByLabel("Minimum match percentage").fill("50");
  await page.getByRole("button", { name: "Save screening rules" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Sam Fixture" })).toContainText(
    "Shortlisted",
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "Screening rules" })).toContainText("50%");
  await page.getByRole("button", { name: "Adjust screening rules" }).click();
  await page.getByLabel("Minimum match percentage").fill("100");
  await page.getByRole("button", { name: "Save screening rules" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Sam Fixture" })).toContainText(
    "Below threshold",
  );
});

test("matching results remain usable on a narrow screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const job = await fixtureJob(request);
  await page.goto(`/shortlists?job=${job.id}`);
  await expect(page.getByRole("button", { name: /Sam Fixture/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Adjust screening rules" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Cancel changes" }).click();
  await page.getByRole("button", { name: /Sam Fixture/ }).click();
  await expect(page.getByRole("dialog", { name: "Matching evidence", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close evidence review" }).click();
});

test("screening rule proxy rejects cross-origin writes", async ({ request }) => {
  const job = await fixtureJob(request);
  const response = await request.patch(`/api/backend/jobs/${job.id}/screening-policy`, {
    headers: { Origin: "https://untrusted.example" },
    data: { threshold: 50, criterion_ids: ["react"], version: 1 },
  });
  expect(response.status()).toBe(403);
});
