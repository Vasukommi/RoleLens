import { expect, test } from "@playwright/test";

test("automatic comparison supports filtering, reviewed approval, and original exports", async ({
  page,
  request,
}) => {
  const jobs = await (await request.get("http://127.0.0.1:8010/api/v1/jobs")).json();
  const job = jobs.find((j: { title: string }) => j.title === "Comparison fixture");
  await page.goto(`/shortlists?job=${job.id}`);
  await expect(page.getByRole("button", { name: /Alex Fixture/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sam Fixture/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by criterion" }).click();
  await page.getByRole("option", { name: "TypeScript development", exact: true }).click();
  await expect(page.getByRole("button", { name: /Sam Fixture/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Alex Fixture", exact: true }).check();
  await page.getByRole("button", { name: /Review selection/ }).click();
  const dialog = page.getByRole("dialog", { name: "Shortlist evidence review" });
  const approve = dialog.getByRole("button", { name: "Approve shortlist", exact: true });
  await expect(approve).toBeDisabled();
  await dialog.locator("summary").filter({ hasText: "TypeScript development" }).click();
  await expect(dialog.getByText("Synthetic fixture result.", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await approve.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Shortlist CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
  const documents = page.waitForEvent("download");
  await page.getByRole("button", { name: "Shortlisted resumes", exact: true }).click();
  expect((await documents).suggestedFilename()).toMatch(/\.zip$/);
  await page.screenshot({ path: "../../docs/images/evidence-comparison.png", fullPage: true });
});

test("matching results remain usable on a narrow screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const jobs = await (await request.get("http://127.0.0.1:8010/api/v1/jobs")).json();
  const job = jobs.find((j: { title: string }) => j.title === "Comparison fixture");
  await page.goto(`/shortlists?job=${job.id}`);
  await expect(page.getByRole("button", { name: /Sam Fixture/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: /Sam Fixture/ }).click();
  await expect(page.getByRole("dialog", { name: "Shortlist evidence review" })).toBeVisible();
  await page.getByRole("button", { name: "Close evidence review" }).click();
});
