import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function createNote(request: APIRequestContext, title: string) {
  const response = await request.post("/api/notes", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    id: string;
    optimisticVersion: number;
  };
}

test("runs AI only on demand and inserts reviewed bullets and durable links", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const sourceTitle = `AI source ${suffix}`;
  const targetTitle = `AI target ${suffix}`;
  const source = await createNote(request, sourceTitle);
  const target = await createNote(request, targetTitle);
  let analysisRequests = 0;

  await page.route("**/api/ai/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        available: true,
        modelsReady: true,
        chatModel: "qwen3.5:4b",
        embeddingModel: "qwen3-embedding:0.6b",
        missingModels: [],
        message: null,
      }),
    });
  });
  await page.route(`**/api/notes/${source.id}/ai`, async (route) => {
    analysisRequests += 1;
    const body = route.request().postDataJSON() as {
      action: "summarize" | "find-connections" | "rewrite-selection";
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        body.action === "summarize"
          ? {
              action: "summarize",
              noteVersion: source.optimisticVersion + 1,
              bullets: [
                "The launch is planned for Friday.",
                "The release checklist still needs review.",
                "The deployment remains local-only.",
              ],
              truncated: false,
            }
          : {
              action: "find-connections",
              noteVersion: source.optimisticVersion + 2,
              suggestions: [
                {
                  noteId: target.id,
                  title: targetTitle,
                  state: "active",
                  relationship: "related",
                  confidence: 0.91,
                  similarity: 0.88,
                  reason: "Both notes describe the same local launch.",
                  alreadyLinked: false,
                },
              ],
              scannedNotes: 1,
              scanLimitReached: false,
              truncated: false,
            },
      ),
    });
  });

  await page.goto("/");
  await page.getByRole("option", { name: new RegExp(sourceTitle) }).click();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.fill("The launch is planned for Friday.");

  expect(analysisRequests).toBe(0);
  await page.locator(".ai-assistant-panel > summary").click();
  await expect(page.getByText("Ready · qwen3.5:4b")).toBeVisible();
  expect(analysisRequests).toBe(0);

  await page.getByRole("button", { name: /Summarise/ }).click();
  await expect(
    page.getByRole("heading", { name: "Suggested summary" }),
  ).toBeVisible();
  expect(analysisRequests).toBe(1);

  await editor.fill("The launch is planned for Friday. Details changed.");
  await expect(
    page.getByText(
      "This result is from an earlier note version or text selection. Run the analysis again before inserting it.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert bullets" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /Summarise/ }).click();
  await expect(
    page.getByRole("button", { name: "Insert bullets" }),
  ).toBeEnabled();
  expect(analysisRequests).toBe(2);

  const summarySave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${source.id}`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Insert bullets" }).click();
  await summarySave;
  await expect(editor.getByText("Summary")).toBeVisible();
  await expect(
    editor.getByText("The deployment remains local-only."),
  ).toBeVisible();

  await page.getByRole("button", { name: /Find connections/ }).click();
  await expect(
    page.getByRole("heading", { name: "Suggested connections" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Suggested connections" })
      .getByText(targetTitle, { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".ai-assistant-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(analysisRequests).toBe(3);

  const linkSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${source.id}`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Insert @link" }).click();
  await linkSave;
  await expect(
    page.getByRole("link", { name: `Open linked note ${targetTitle}` }),
  ).toBeVisible();

  const saved = await (await request.get(`/api/notes/${source.id}`)).json();
  expect(JSON.stringify(saved.content)).toContain('"type":"bulletList"');
  expect(JSON.stringify(saved.content)).toContain(`"id":"${target.id}"`);
  expect(JSON.stringify(saved.content)).toMatch(/"mentionId":"[0-9a-f-]{36}"/);
});

test("searches by meaning and answers from linked source notes only on demand", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const sourceTitle = `Semantic recovery plan ${suffix}`;
  const source = await createNote(request, sourceTitle);
  let semanticRequests = 0;
  let askRequests = 0;

  await page.route("**/api/ai/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        available: true,
        modelsReady: true,
        chatModel: "qwen3.5:4b",
        embeddingModel: "qwen3-embedding:0.6b",
        missingModels: [],
        message: null,
      }),
    });
  });
  await page.route("**/api/ai/search", async (route) => {
    semanticRequests += 1;
    expect(route.request().postDataJSON()).toMatchObject({
      q: "recover the server",
      view: "all",
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: source.id,
            title: sourceTitle,
            excerpt: "Restore the database from the portable backup.",
            highlight: "Restore the database from the portable backup.",
            rank: 0.93,
            semanticScore: 0.93,
            optimisticVersion: source.optimisticVersion,
            folder: null,
            tags: [],
            attachmentCount: 0,
            pinnedAt: null,
            archivedAt: null,
            trashedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        nextOffset: null,
      }),
    });
  });
  await page.route("**/api/ai/ask", async (route) => {
    askRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        answer: "Restore the database from the portable backup.",
        citations: [
          {
            noteId: source.id,
            title: sourceTitle,
            state: "active",
            excerpt: "Restore the database from the portable backup.",
            reason: "The note records the recovery procedure.",
          },
        ],
        scannedNotes: 1,
        scanLimitReached: false,
        truncated: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Meaning" }).click();
  const search = page.getByRole("searchbox", {
    name: "Search note titles and bodies",
  });
  await search.fill("recover the server");
  await page.waitForTimeout(300);
  expect(semanticRequests).toBe(0);

  await page.getByRole("button", { name: "Run meaning search" }).click();
  await expect(
    page.getByRole("option", { name: new RegExp(sourceTitle) }),
  ).toBeVisible();
  await expect(page.getByText("93% match")).toBeVisible();
  expect(semanticRequests).toBe(1);

  await page.getByRole("button", { name: "Ask notes" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask your notes" }),
  ).toBeVisible();
  expect(askRequests).toBe(0);
  await page.getByLabel("Question").fill("How should I recover the database?");
  expect(askRequests).toBe(0);
  await page
    .getByRole("dialog", { name: "Ask your notes" })
    .getByRole("button", { name: "Ask notes" })
    .click();
  await expect(page.getByText("Answer from your notes")).toBeVisible();
  await expect(
    page.getByText("The note records the recovery procedure."),
  ).toBeVisible();
  expect(askRequests).toBe(1);

  expect(
    (
      await new AxeBuilder({ page })
        .include(".workspace-ai-dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  await page.getByRole("button", { name: "Open source note" }).click();
  await expect(page.locator("#note-title")).toHaveValue(sourceTitle);
});

test("previews and saves a reviewed rewrite of the current selection", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const noteTitle = `Writing tools ${suffix}`;
  const note = await createNote(request, noteTitle);
  let rewriteRequests = 0;

  await page.route("**/api/ai/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        available: true,
        modelsReady: true,
        chatModel: "qwen3.5:4b",
        embeddingModel: "qwen3-embedding:0.6b",
        missingModels: [],
        message: null,
      }),
    });
  });
  await page.route(`**/api/notes/${note.id}/ai`, async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      mode: string;
      selectedText: string;
    };
    expect(body).toMatchObject({
      action: "rewrite-selection",
      mode: "clarify",
      selectedText:
        rewriteRequests === 0
          ? "This sentence are unclear and very wordy."
          : "This sentence is clear and concise.",
    });
    const rewrittenText =
      rewriteRequests === 0
        ? "This sentence is clear and concise."
        : "A second reviewed sentence follows.";
    rewriteRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        action: "rewrite-selection",
        mode: "clarify",
        noteVersion: note.optimisticVersion + rewriteRequests,
        text: rewrittenText,
        truncated: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("option", { name: new RegExp(noteTitle) }).click();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.fill("This sentence are unclear and very wordy.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.locator(".ai-assistant-panel > summary").click();
  await editor.press("ControlOrMeta+A");
  await expect(page.getByText("41 characters selected")).toBeVisible();

  const writingTask = page.getByLabel("Selection writing task");
  await expect(writingTask.locator("option")).toHaveCount(7);
  await writingTask.selectOption("clarify");
  expect(rewriteRequests).toBe(0);
  await page.getByRole("button", { name: "Preview rewrite" }).click();
  await expect(page.getByText("Writing preview")).toBeVisible();
  await expect(page.locator(".ai-writing-preview")).toHaveText(
    "This sentence is clear and concise.",
  );
  expect(rewriteRequests).toBe(1);

  const rewriteSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${note.id}`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Replace selection" }).click();
  await rewriteSave;
  await expect(editor).toContainText("This sentence is clear and concise.");

  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Preview rewrite" }).click();
  await expect(page.locator(".ai-writing-preview")).toHaveText(
    "A second reviewed sentence follows.",
  );
  expect(rewriteRequests).toBe(2);

  const insertAfterSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/notes/${note.id}`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Insert after" }).click();
  await insertAfterSave;
  await expect(editor).toContainText("A second reviewed sentence follows.");

  const saved = await (await request.get(`/api/notes/${note.id}`)).json();
  expect(JSON.stringify(saved.content)).toContain(
    "This sentence is clear and concise.",
  );
  expect(JSON.stringify(saved.content)).toContain(
    "A second reviewed sentence follows.",
  );
});

test("suggests folders for every unfiled note and applies only reviewed moves", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const noteTitle = `Unfiled project ${suffix}`;
  const note = await createNote(request, noteTitle);
  const folderResponse = await request.post("/api/folders", {
    data: { name: `Projects ${suffix}`, parentId: null },
  });
  expect(folderResponse.status()).toBe(201);
  const folder = (await folderResponse.json()) as { id: string; name: string };
  let suggestionRequests = 0;

  await page.route("**/api/ai/folders/suggestions", async (route) => {
    suggestionRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [
          {
            noteId: note.id,
            noteTitle,
            expectedVersion: note.optimisticVersion,
            folderId: folder.id,
            folderName: folder.name,
            confidence: 0.91,
            reason: `Closest semantic match to “${folder.name}”.`,
          },
        ],
        unfiledNotes: 1,
        scannedNotes: 1,
        scannedFolders: 1,
        scanLimitReached: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Manage folders" }).click();
  expect(suggestionRequests).toBe(0);
  await page.getByRole("button", { name: "Suggest folders" }).click();
  await expect(page.getByText(noteTitle, { exact: true })).toBeVisible();
  expect(suggestionRequests).toBe(1);
  await expect(
    page.getByRole("checkbox", { name: `Move ${noteTitle}` }),
  ).toBeChecked();

  await page.getByRole("button", { name: "Apply 1 reviewed" }).click();
  await expect(
    page.getByText("1 note moved into reviewed folders."),
  ).toBeVisible();
  const moved = await (await request.get(`/api/notes/${note.id}`)).json();
  expect(moved.folder).toEqual({ id: folder.id, name: folder.name });
});
