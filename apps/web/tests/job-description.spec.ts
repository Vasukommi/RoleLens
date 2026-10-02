import { expect, test } from "@playwright/test";

const description =
  "Must have Node.js experience. React or Angular preferred. Minimum 3 years in Node.js.";

test("JD interpretation goes through the real proxy, requires confirmation, and persists provenance", async ({
  page,
  request,
}) => {
  await page.goto("/jobs");
  await page.getByRole("button", { name: "New job", exact: true }).click();
  await page.getByLabel("Job title").fill("JD browser fixture");
  await page.getByLabel("Job description", { exact: false }).fill(description);
  const analysis = page.waitForResponse("**/api/backend/job-interpretations");
  await page.getByRole("button", { name: "Analyze description" }).click();
  const data = await (await analysis).json();
  expect(data.cached).toBe(true);
  await expect(page.getByRole("region", { name: "Extracted criteria" })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Create job", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Criterion 2", { exact: true })).toHaveValue("React or Angular");
  await expect(page.getByText("Verify separately", { exact: true })).toBeVisible();
  await page.getByText("View original wording", { exact: true }).first().click();
  await expect(dialog.locator("blockquote").first()).toHaveText("Must have Node.js experience.");
  const confirmation = page.getByLabel(
    "I have reviewed the criteria, priorities, and verification notes.",
  );
  await confirmation.check();
  await page.getByLabel("Criterion 1", { exact: true }).fill("Node.js project experience");
  await expect(confirmation).not.toBeChecked();
  await page.getByRole("combobox", { name: "Priority for criterion 2" }).click();
  await page.getByRole("option", { name: "Not specified", exact: true }).click();
  await confirmation.check();
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backend/jobs") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create job", exact: true }).click();
  const job = await (await creation).json();
  await expect(
    page.getByRole("heading", { name: "JD browser fixture", exact: true }),
  ).toBeVisible();
  const stored = await (await request.get("http://127.0.0.1:8010/api/v1/jobs")).json();
  const saved = stored.find((item: { id: string }) => item.id === job.id);
  expect(saved.description).toBe(description);
  expect(saved.requirements[1].priority).toBe("UNSPECIFIED");
  expect(saved.requirements[2].assessment_mode).toBe("VERIFY_SEPARATELY");
  expect(saved.interpretation.edited_criteria).toEqual(["node", "frontend"]);
  await page.goto("/jobs");
  await page.reload();
  await page.getByText("View job definition", { exact: true }).first().click();
  await expect(page.locator(".saved-description-text").first()).toHaveText(description);
});

test("editing the source invalidates interpretation and failure preserves the pasted JD", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jobs");
  await page.getByRole("button", { name: "New job", exact: true }).click();
  await page.getByLabel("Job title").fill("JD browser fixture");
  const input = page.getByLabel("Job description", { exact: false });
  await input.fill(description);
  await page.getByRole("button", { name: "Analyze description" }).click();
  await expect(page.getByRole("region", { name: "Extracted criteria" })).toBeVisible();
  await input.fill(description + " Additional role context.");
  await expect(page.getByRole("region", { name: "Extracted criteria" })).not.toBeVisible();
  await page.getByRole("button", { name: "Analyze description" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("OPENAI_API_KEY");
  await expect(input).toHaveValue(description + " Additional role context.");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("paid proxy rejects cross-origin requests", async ({ request }) => {
  const response = await request.post("/api/backend/job-interpretations", {
    headers: { Origin: "https://untrusted.example" },
    data: { title: "JD browser fixture", description },
  });
  expect(response.status()).toBe(403);
});
