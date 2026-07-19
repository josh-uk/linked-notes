import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function createFolder(request: APIRequestContext, name: string) {
  const response = await request.post("/api/folders", {
    data: { name, parentId: null },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function createTag(request: APIRequestContext, name: string) {
  const response = await request.post("/api/tags", {
    data: { name, color: "#4f46e5" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; displayName: string };
}

async function createNote(
  request: APIRequestContext,
  title: string,
  options: { folderId?: string; tagIds?: string[] } = {},
) {
  const response = await request.post("/api/notes", {
    data: { title, ...options },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; optimisticVersion: number };
}

test("organizes, searches, archives, trashes, and permanently deletes from the desktop workspace", async ({
  page,
}) => {
  const suffix = Date.now();
  const folderName = `Desktop project ${suffix}`;
  const tagName = `Desktop tag ${suffix}`;
  const noteTitle = `Orchid desktop ${suffix}`;
  const bodyTerm = `copperleaf${suffix}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Manage folders" }).click();
  const dialog = page.getByRole("dialog", { name: "Organize notes" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Folder name").fill(folderName);
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Workspace organization updated",
  );
  await dialog.getByRole("tab", { name: "Tags" }).click();
  await dialog.getByLabel("Tag name").fill(tagName);
  await dialog.getByRole("button", { name: "Add tag" }).click();
  await dialog
    .getByRole("button", { name: "Close organization settings" })
    .click();

  await page.getByRole("button", { name: new RegExp(folderName) }).click();
  await expect(page.getByRole("heading", { name: folderName })).toBeVisible();
  const createButton = page
    .getByRole("button", { name: "Create a new note" })
    .first();
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await page.getByRole("textbox", { name: "Note title" }).fill(noteTitle);
  await page.getByRole("textbox", { name: "Note content" }).click();
  await page.keyboard.type(`A desktop-first ${bodyTerm} research note.`);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await expect(page.getByLabel("Move note to folder")).toHaveValue(/.+/);

  await page.getByText("Tags (0)", { exact: true }).click();
  await page.getByRole("checkbox", { name: tagName }).click();
  await expect(page.getByText("Tags (1)", { exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", {
    name: "Search note titles and bodies",
  });
  await search.fill("Orchid");
  await expect(
    page.getByRole("option", { name: new RegExp(noteTitle) }),
  ).toBeVisible();
  await expect(
    page.locator("mark").filter({ hasText: "Orchid" }),
  ).toBeVisible();
  await search.fill(bodyTerm);
  await expect(
    page.getByRole("option", { name: new RegExp(noteTitle) }),
  ).toBeVisible();
  await expect(
    page.locator("mark").filter({ hasText: bodyTerm }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");

  await page.getByRole("button", { name: "Archive note" }).click();
  await page
    .getByRole("navigation", { name: "Notes views" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: new RegExp(noteTitle) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore note from archive" }).click();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(noteTitle) }).click();
  await page.getByRole("button", { name: "Move note to trash" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(noteTitle) }).click();
  await page.getByRole("button", { name: "Delete note permanently" }).click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Delete permanently?",
  });
  await expect(deleteDialog).toContainText("cannot be recovered");
  await deleteDialog
    .getByRole("button", { name: "Delete permanently" })
    .click();
  await expect(
    page.getByRole("option", { name: new RegExp(noteTitle) }),
  ).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("bulk moves, tags, and archives a desktop selection transactionally", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const folder = await createFolder(request, `Bulk folder ${suffix}`);
  const tag = await createTag(request, `Bulk tag ${suffix}`);
  const firstTitle = `Bulk desktop ${suffix} alpha`;
  const secondTitle = `Bulk desktop ${suffix} beta`;
  const first = await createNote(request, firstTitle);
  const second = await createNote(request, secondTitle);

  await page.goto("/");
  const search = page.getByRole("searchbox", {
    name: "Search note titles and bodies",
  });
  await search.fill(`Bulk desktop ${suffix}`);
  await expect(
    page.getByRole("option", { name: new RegExp(firstTitle) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: new RegExp(firstTitle) }).check();
  await page.getByRole("checkbox", { name: new RegExp(secondTitle) }).check();
  await page.getByLabel("Bulk destination folder").selectOption(folder.id);
  const moveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes/bulk") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Move", exact: true }).click();
  expect((await moveResponse).status()).toBe(200);
  await expect(page.getByLabel("Bulk note actions")).toHaveCount(0);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: new RegExp(firstTitle) }).check();
  await page.getByRole("checkbox", { name: new RegExp(secondTitle) }).check();
  await page.getByLabel("Bulk tag", { exact: true }).selectOption(tag.id);
  const tagResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes/bulk") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await tagResponse).status()).toBe(200);
  await expect(page.getByLabel("Bulk note actions")).toHaveCount(0);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: new RegExp(firstTitle) }).check();
  await page.getByRole("checkbox", { name: new RegExp(secondTitle) }).check();
  const archiveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/notes/bulk") &&
      response.request().method() === "POST",
  );
  await page
    .getByLabel("Bulk note actions")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  expect((await archiveResponse).status()).toBe(200);

  const firstDetail = await (
    await request.get(`/api/notes/${first.id}`)
  ).json();
  const secondDetail = await (
    await request.get(`/api/notes/${second.id}`)
  ).json();
  for (const detail of [firstDetail, secondDetail]) {
    expect(detail).toMatchObject({
      folder: { id: folder.id },
      tags: [{ id: tag.id }],
      archivedAt: expect.any(String),
    });
  }
});
