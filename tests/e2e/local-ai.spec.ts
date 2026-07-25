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
      action: "summarize" | "find-connections";
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
      "This result is from an earlier version of the note. Run the analysis again before inserting it.",
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
