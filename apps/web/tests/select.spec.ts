import { expect, test } from "@playwright/test";

test("inbox filter supports keyboard navigation, typeahead, cancellation, and empty-value reset", async ({
  page,
  request,
}) => {
  const title = `Dropdown filters ${Date.now()}`;
  const response = await request.post("http://127.0.0.1:8010/api/v1/jobs", {
    data: { title, requirements: [{ id: "python", text: "Built Python APIs" }] },
  });
  expect(response.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: title, exact: true }).click();
  const trigger = page.getByRole("combobox", { name: "Filter processing status" });
  await expect(trigger).toHaveText("All applications");
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: "All applications", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Reviewed", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("Reviewed");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(page.getByRole("option", { name: "Reviewed", exact: true })).toBeFocused();
  await page.keyboard.type("All");
  await expect(page.getByRole("option", { name: "All applications", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("All applications");
  await trigger.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toHaveText("All applications");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator("h1").click({ force: true });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toHaveText("All applications");
  await trigger.click();
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/applications") && url.searchParams.get("status") === "FAILED";
  });
  await page.getByRole("option", { name: "Failed", exact: true }).click();
  expect((await filtered).status()).toBe(200);
  await expect(trigger).toHaveText("Failed");
  await expect(page.getByText("No applications match these filters.")).toBeVisible();
});

test("sample workspace correction uses the same dropdown and changes the finding", async ({
  page,
}) => {
  await page.goto("/demo");
  const trigger = page.getByRole("combobox", { name: "Reviewer correction" });
  await expect(trigger).toHaveText("Supported");
  await trigger.click();
  await expect(page.getByRole("option", { name: "Supported", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("option", { name: "Needs clarification", exact: true }).click();
  await expect(trigger).toHaveText("Needs clarification");
  await expect(
    page.getByRole("button", { name: /Built and maintained React applications/ }),
  ).toContainText("Needs clarification");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("dropdown in the modal drawer stays visible, cancels independently, and saves a correction", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dropdown review fixture", exact: true }).click();
  await page.getByRole("button", { name: /Dropdown Test Applicant/ }).click();
  const drawer = page.getByRole("dialog", { name: "Application review", exact: true });
  const trigger = page.getByRole("combobox", { name: "Reviewer correction" });
  await trigger.click();
  await expect(drawer.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("option", { name: "Partial evidence", exact: true }).click();
  await expect(trigger).toHaveText("Partial evidence");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Dropdown review fixture", exact: true }).click();
  await page.getByRole("button", { name: /Dropdown Test Applicant/ }).click();
  await expect(page.getByRole("combobox", { name: "Reviewer correction" })).toHaveText(
    "Partial evidence",
  );
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

test.describe("touch screens", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("custom menus fit on mobile and can be selected by touch", async ({ page, request }) => {
    const title = `Mobile dropdown ${Date.now()}`;
    await request.post("http://127.0.0.1:8010/api/v1/jobs", {
      data: { title, requirements: [{ id: "python", text: "Built Python APIs" }] },
    });
    await page.goto("/");
    await page.getByRole("button", { name: title, exact: true }).click();
    const trigger = page.getByRole("combobox", { name: "Filter processing status" });
    await trigger.tap();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.getByRole("option", { name: "Ready for review", exact: true }).tap();
    await expect(trigger).toHaveText("Ready for review");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
