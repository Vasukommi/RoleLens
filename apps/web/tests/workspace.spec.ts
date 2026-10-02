import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("demo has 200 fictional resumes, folders, and jobs without backend requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/backend/**", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  await expect(page.locator(".demo-banner")).toContainText("200 fictional resumes");
  await expect(page.locator(".demo-banner")).toContainText("no Jev calls or integrations");
  await expect(
    page.getByRole("heading", { name: "Full-stack Developer", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cloud Engineer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume library", exact: true }).click();
  await expect(page.getByText("200 resumes · page 1 of 10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Cloud engineering 70 resumes/ }).click();
  await expect(page.getByText("70 resumes · page 1 of 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Applicant 081/ }).click();
  await expect(page.getByRole("dialog")).toContainText("FICTIONAL DEMO RESUME");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  expect(requests).toEqual([]);
});

test("demo matches selected folders, exposes all results, and labels exported fixtures", async ({
  page,
}) => {
  await page.goto("/demo");
  const cloud = page
    .locator(".job-card")
    .filter({ has: page.getByRole("heading", { name: "Cloud Engineer", exact: true }) });
  await cloud.getByRole("button", { name: "Shortlist", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full-stack development", { exact: false }).uncheck();
  await dialog.getByLabel("Early careers", { exact: false }).check();
  await expect(dialog.getByText("120 sample resumes selected.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Generate demo shortlist", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Proposed shortlist" })).toBeVisible();
  await expect(
    page.getByText("Preset comparisons loaded. No Jev assessment was performed."),
  ).toBeVisible();
  await page.getByRole("button", { name: "All assessed", exact: false }).click();
  await expect(page.getByText("120 results · page 1 of 6", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter source folder" }).click();
  await page.getByRole("option", { name: "Early careers", exact: true }).click();
  await expect(page.getByText("50 results · page 1 of 3", { exact: true })).toBeVisible();
  await page.getByLabel("Select current page").check();
  const selectedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected", exact: true }).click();
  const selected = await selectedDownload;
  const csv = await readFile((await selected.path())!, "utf8");
  expect(csv).toContain("FICTIONAL DEMO — preset findings; no Jev assessment");
  expect(csv).toContain('"Early careers"');
  expect(csv).not.toContain('"Full-stack development"');
  expect(csv.split("\r\n")).toHaveLength(21);
  const allDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered results", exact: true }).click();
  const allCsv = await readFile((await (await allDownload).path())!, "utf8");
  expect(allCsv.split("\r\n")).toHaveLength(51);
  await page.getByRole("combobox", { name: "Minimum evidence coverage" }).click();
  await page.getByRole("option", { name: "Coverage 100%", exact: true }).click();
  await expect(page.getByText("No results match these filters.", { exact: false })).toBeVisible();
});

test("demo selections can be reviewed and exported, and reset without changing real records", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "View example results" }).first().click();
  await page.getByRole("button", { name: "All assessed", exact: false }).click();
  await page.getByLabel("Search shortlist").fill("Applicant 002");
  await page.getByRole("button", { name: /Applicant 002/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Preset findings for a fictional resume");
  await page.getByRole("button", { name: "Add to saved shortlist", exact: true }).click();
  await page.getByRole("button", { name: "Saved shortlist", exact: false }).click();
  await expect(page.getByRole("button", { name: /Applicant 002/ })).toBeVisible();
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export entire saved shortlist" }).click();
  const csv = await readFile((await (await downloading).path())!, "utf8");
  expect(csv).toContain('"Applicant 002"');
  expect(csv).toContain('"Example reviewer selection"');
  await page.reload();
  await page.getByRole("button", { name: "View example results" }).first().click();
  await page.getByRole("button", { name: "Saved shortlist", exact: false }).click();
  await expect(page.getByRole("button", { name: /Applicant 002/ })).toHaveCount(0);
});

test("demo returns to the workspace route and rejects external return destinations", async ({
  page,
}) => {
  await page.goto("/demo?returnTo=%2Fexports");
  await expect(page.getByRole("link", { name: "Back to workspace", exact: true })).toHaveAttribute(
    "href",
    "/exports",
  );
  await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exports", exact: true })).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  await page.goto("/demo?returnTo=https%3A%2F%2Fexample.com");
  await expect(page.getByRole("link", { name: "Back to workspace", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
});

test("demo navigation and filters are usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Workspace profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View example results" }).first().click();
  await page.getByRole("combobox", { name: "Filter experience" }).click();
  await page.getByRole("option", { name: "Entry-level", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Proposed shortlist", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Workspace profile" }).click();
  await expect(page.getByRole("menuitem", { name: "Back to workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Workspace profile" })).toBeFocused();
});
