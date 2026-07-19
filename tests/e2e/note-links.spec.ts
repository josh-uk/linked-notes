import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const selectAllShortcut =
  process.platform === "darwin" ? "Meta+a" : "Control+a";

async function createNote(request: APIRequestContext, title: string) {
  const response = await request.post("/api/notes", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    id: string;
    optimisticVersion: number;
  };
}

test("links notes, resolves renames, shows backlinks, and preserves broken references", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const targetTitle = `Atlas${suffix}`;
  const renamedTitle = `RenamedAtlas${suffix}`;
  const sourceTitle = `Source${suffix}`;
  const target = await createNote(request, targetTitle);
  const source = await createNote(request, sourceTitle);

  await page.goto("/");
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.click();
  await page.keyboard.type(`See @${targetTitle}`);

  const suggestionList = page.getByRole("listbox", { name: "Link a note" });
  await expect(suggestionList).toBeVisible();
  await expect(
    suggestionList.getByRole("option").filter({ hasText: targetTitle }),
  ).toBeVisible();
  const initialSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${source.id}`) &&
      response.status() === 200,
  );
  await page.keyboard.press("Enter");

  const linkedTarget = page.getByRole("link", {
    name: `Open linked note ${targetTitle}`,
  });
  await expect(linkedTarget).toBeVisible();
  await initialSave;
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  const sourceDetail = await (
    await request.get(`/api/notes/${source.id}`)
  ).json();
  expect(sourceDetail.content.content[0].content[1].attrs).toMatchObject({
    id: target.id,
    label: targetTitle,
  });
  expect(sourceDetail.content.content[0].content[1].attrs.mentionId).toMatch(
    /^[0-9a-f-]{36}$/,
  );

  await linkedTarget.click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    targetTitle,
  );
  await page.getByText("Backlinks", { exact: true }).click();
  const sourceBacklink = page.getByRole("button", { name: sourceTitle });
  await expect(sourceBacklink).toBeVisible();
  await expect(
    page
      .getByLabel(`Contexts from ${sourceTitle}`)
      .getByText(`See @${targetTitle}`, { exact: true }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Note title" }).fill(renamedTitle);
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await sourceBacklink.click();
  await expect(
    page.getByRole("link", { name: `Open linked note ${renamedTitle}` }),
  ).toBeVisible();

  const canonicalAfterRename = await (
    await request.get(`/api/notes/${source.id}`)
  ).json();
  expect(JSON.stringify(canonicalAfterRename.content)).toContain(targetTitle);
  expect(JSON.stringify(canonicalAfterRename.content)).not.toContain(
    renamedTitle,
  );

  await page
    .getByRole("link", { name: `Open linked note ${renamedTitle}` })
    .click();
  await page.getByRole("button", { name: "Move note to trash" }).click();
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  await expect(
    page.getByRole("link", {
      name: `Linked note ${renamedTitle}; target is in trash`,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: `Linked note ${renamedTitle}; target is in trash`,
    })
    .click();
  await page.getByRole("button", { name: "Restore note" }).click();
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  await expect(
    page.getByRole("link", { name: `Open linked note ${renamedTitle}` }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: `Open linked note ${renamedTitle}` })
    .click();
  await page.getByRole("button", { name: "Move note to trash" }).click();
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  const trashedTarget = await (
    await request.get(`/api/notes/${target.id}`)
  ).json();
  const deletion = await request.post(`/api/notes/${target.id}/actions`, {
    data: {
      action: "delete",
      expectedVersion: trashedTarget.optimisticVersion,
    },
  });
  expect(deletion.status()).toBe(200);

  await page.reload();
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  const brokenMention = page.getByRole("link", {
    name: `Linked note ${targetTitle}; target is missing`,
  });
  await expect(brokenMention).toBeVisible();
  await expect(brokenMention).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    sourceTitle,
  );

  const retainedBacklinks = await (
    await request.get(`/api/notes/${target.id}/backlinks`)
  ).json();
  expect(retainedBacklinks).toMatchObject({ totalMentions: 1 });

  const removalSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${source.id}`),
  );
  await editor.click();
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.press("Backspace");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved changes" }),
  ).toBeVisible();
  expect((await removalSave).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const removedBacklinks = await (
    await request.get(`/api/notes/${target.id}/backlinks`)
  ).json();
  expect(removedBacklinks).toMatchObject({ totalMentions: 0, items: [] });
});

test("supports loading, empty, error, escape, pointer, and self-link suggestion states", async ({
  page,
  request,
}) => {
  const title = `Self${Date.now()}`;
  await createNote(request, title);
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  let holdNextSearch = true;
  await page.route("**/api/notes/suggestions?*", async (route) => {
    if (holdNextSearch) {
      holdNextSearch = false;
      await searchGate;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("option", { name: new RegExp(title) }).click();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.click();
  await page.keyboard.type(`@${title}`);
  await expect(
    page.getByText("Searching notes…", { exact: true }),
  ).toBeVisible();
  releaseSearch();

  const suggestionList = page.getByRole("listbox", { name: "Link a note" });
  await expect(suggestionList).toBeVisible();
  const selfOption = suggestionList
    .getByRole("option")
    .filter({ hasText: "Current note" });
  await expect(selfOption).toContainText(title);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(suggestionList).toBeHidden();

  await editor.click();
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.type(`@NoMatch${Date.now()}`);
  await expect(
    page.getByText("No matching notes", { exact: true }),
  ).toBeVisible();

  await page.unroute("**/api/notes/suggestions?*");
  await page.route("**/api/notes/suggestions?*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "TEST_ERROR", message: "Suggestion test failure" },
      }),
    });
  });
  await editor.click();
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.type(`@Error${Date.now()}`);
  await expect(
    page.locator(".mention-suggestions").getByRole("alert"),
  ).toContainText("Suggestion test failure");

  await page.unroute("**/api/notes/suggestions?*");
  await editor.click();
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.type(`@${title}`);
  const pointerOption = page
    .getByRole("listbox", { name: "Link a note" })
    .getByRole("option")
    .filter({ hasText: "Current note" });
  await pointerOption.click();
  await expect(
    page.getByRole("link", { name: `Open linked note ${title}` }),
  ).toBeVisible();
});
