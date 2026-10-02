import { expect, test } from "@playwright/test";

test("sample review links evidence, retains notes, and exports provenance", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("API connected")).toBeVisible();
  await expect(
    page.getByText("Invented resumes and preset findings.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Deployed applications on AWS/ }).click();
  await expect(page.locator(".resume-text mark")).toContainText("Skills:");
  await page.getByLabel("Your review notes").fill("Ask for a deployment example.");
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await page.getByRole("button", { name: /Noah Williams/ }).click();
  await page.getByRole("button", { name: /Maya Chen/ }).click();
  await expect(page.getByLabel("Your review notes")).toHaveValue("Ask for a deployment example.");
  await expect(page.getByRole("button", { name: "Reviewed", exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("rolelens-review.csv");
});

test("edited criteria invalidate prior assessments", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Maya Chen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit criteria", exact: true }).click();
  await page.getByLabel("Role title").fill("Backend Engineer");
  await page
    .getByLabel("Requirements", { exact: false })
    .fill("Built Python APIs\nUsed PostgreSQL");
  await page.getByRole("button", { name: "Save criteria" }).click();
  await expect(page.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();
  await expect(page.getByText("Awaiting assessment", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Built Python APIs/ })).toContainText(
    "Not assessed",
  );
});

test("real document upload previews text without a fake assessment", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("API connected")).toBeVisible();
  await page.getByRole("button", { name: "Add resume", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Synthetic applicant\n\nBuilt Python APIs and maintained PostgreSQL databases.",
    ),
  });
  await expect(page.getByLabel("Resume text", { exact: false })).toHaveValue(/Built Python APIs/);
  await page.getByLabel("Display name").fill("Synthetic Applicant");
  await page.getByRole("dialog").getByRole("button", { name: "Add resume" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Applicant" })).toBeVisible();
  await expect(page.getByText("Awaiting assessment", { exact: true })).toBeVisible();
  await expect(page.locator(".resume-text")).toContainText("PostgreSQL");
});

test("mobile workspace has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Maya Chen", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
