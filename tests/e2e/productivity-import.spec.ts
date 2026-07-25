import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("uses the desktop command centre for capture, history, daily notes, and templates", async ({
  page,
}) => {
  const suffix = Date.now();
  const captureTitle = `Command capture ${suffix}`;
  await page.goto("/");

  await page.getByRole("button", { name: /Command centre/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Command centre" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Quick capture/ }).click();
  const quickCapture = page.getByRole("dialog", { name: "Quick capture" });
  await quickCapture
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(captureTitle);
  await quickCapture
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Captured from a desktop shortcut.\nSecond paragraph.");
  await quickCapture.getByRole("button", { name: "Save quick note" }).click();

  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    captureTitle,
  );
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("Second paragraph.");
  await page.getByRole("button", { name: "Open note history" }).click();
  await expect(
    page.getByRole("dialog", { name: "Restore an earlier note" }),
  ).toContainText("Version 1");
  await page.getByRole("button", { name: "Close note history" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: /Today's note/ }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    /Daily note/,
  );

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: /Templates/ }).click();
  await page
    .getByRole("textbox", { name: "Save current note as a template" })
    .fill(`Daily template ${suffix}`);
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText(`Daily template ${suffix}`)).toBeVisible();
});

test("previews and imports Markdown files before creating normal editable notes", async ({
  page,
}) => {
  const suffix = Date.now();
  const importedTitle = `Browser import proof ${suffix}`;
  const markdown = (
    await readFile("tests/fixtures/import/Projects/browser-import.md", "utf8")
  )
    .replace("browser-import-fixture", `browser-import-fixture-${suffix}`)
    .replace("# Browser import proof", `# ${importedTitle}`);
  const upload = {
    name: "browser-import.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown),
  };
  await page.goto("/");
  await page.getByRole("button", { name: /Command centre/ }).click();
  await page.getByRole("button", { name: /Import notes/ }).click();
  await page.getByLabel("Choose Markdown files").setInputFiles(upload);

  await expect(page.getByText("1 notes ready")).toBeVisible();
  await expect(page.getByText("1 new · 0 already imported")).toBeVisible();
  await page.getByRole("button", { name: "Import new notes" }).click();

  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    importedTitle,
  );
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText("review-before-import desktop flow");
  const selectedNote = page.getByRole("option", {
    name: new RegExp(`^${importedTitle}`),
  });
  await expect(
    selectedNote.getByText("#Desktop", { exact: true }),
  ).toBeVisible();
  await expect(
    selectedNote.getByText("#Imported", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Command centre/ }).click();
  await page.getByRole("button", { name: /Import notes/ }).click();
  await page.getByLabel("Choose Markdown files").setInputFiles(upload);
  await expect(page.getByText("0 new · 1 already imported")).toBeVisible();
});

test("runs workspace cleanup only after a click and applies a reviewed suggestion", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const title = `Untitled cleanup ${suffix}`;
  const createdResponse = await request.post("/api/notes", {
    data: { title },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    optimisticVersion: number;
  };
  let cleanupRequests = 0;
  await page.route("**/api/ai/cleanup", async (route) => {
    cleanupRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scannedNotes: 1,
        scanLimitReached: false,
        suggestions: [
          {
            id: "reviewed-title",
            type: "clearer-title",
            noteId: created.id,
            noteTitle: title,
            expectedVersion: created.optimisticVersion,
            targetNoteId: null,
            targetNoteTitle: null,
            confidence: 0.96,
            reason: "The current title does not describe the note.",
            suggestedTitle: `Reviewed cleanup ${suffix}`,
            suggestedTags: [],
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: /AI cleanup/ }).click();
  expect(cleanupRequests).toBe(0);
  await page.getByRole("button", { name: "Scan workspace" }).click();
  await expect(page.getByText("1 suggestions")).toBeVisible();
  expect(cleanupRequests).toBe(1);

  const save = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${created.id}`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Apply" }).click();
  await save;
  await expect(page.getByText("0 suggestions")).toBeVisible();
  expect(
    await (await request.get(`/api/notes/${created.id}`)).json(),
  ).toMatchObject({ title: `Reviewed cleanup ${suffix}` });
});
