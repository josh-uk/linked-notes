import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("creates, autosaves, reloads, pins, trashes, and restores a note", async ({
  page,
}) => {
  const title = `Phase 1 note ${Date.now()}`;
  await page.goto("/");

  await page.getByRole("button", { name: "Create a new note" }).first().click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible();
  await page.getByRole("textbox", { name: "Note title" }).fill(title);
  await page
    .getByRole("textbox", { name: "Note content" })
    .fill("A calm autosaved thought.");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    title,
  );
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("A calm autosaved thought.");

  await page.getByRole("button", { name: "Pin note" }).click();
  await expect(page.getByRole("button", { name: "Unpin note" })).toBeVisible();
  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(
    page.getByRole("option", { name: new RegExp(title) }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Move note to trash" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    title,
  );
  await page.getByRole("button", { name: "Restore note" }).click();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await expect(
    page.getByRole("option", { name: new RegExp(title) }),
  ).toBeVisible();
});

test("preserves a local draft when optimistic concurrency detects a stale save", async ({
  page,
}) => {
  const originalTitle = `Conflict note ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create a new note" }).first().click();
  await page.getByRole("textbox", { name: "Note title" }).fill(originalTitle);
  await page
    .getByRole("textbox", { name: "Note content" })
    .fill("Original text");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  const pageResponse = await page.request.get("/api/notes?view=all&limit=100");
  const notes = (await pageResponse.json()) as {
    items: Array<{ id: string; title: string; optimisticVersion: number }>;
  };
  const note = notes.items.find(({ title }) => title === originalTitle)!;
  const detailResponse = await page.request.get(`/api/notes/${note.id}`);
  const detail = (await detailResponse.json()) as {
    content: unknown;
    optimisticVersion: number;
  };
  await page.request.patch(`/api/notes/${note.id}`, {
    data: {
      expectedVersion: detail.optimisticVersion,
      title: "Remote title",
      content: detail.content,
    },
  });

  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("My preserved local draft");
  await expect(
    page.getByText("This note changed in another editor", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "My preserved local draft",
  );
  await page.getByRole("button", { name: "Keep my draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  const resolved = await (
    await page.request.get(`/api/notes/${note.id}`)
  ).json();
  expect(resolved.title).toBe("My preserved local draft");
});

test("supports keyboard creation and mobile pane navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Control+n");
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("Mobile keyboard note");
  await page
    .getByRole("textbox", { name: "Note content" })
    .fill("Written without a pointer.");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to note list" }).click();
  await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Notes views" }),
  ).toBeVisible();
  await page.getByLabel("Colour theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
