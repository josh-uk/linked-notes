import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

test.describe.configure({ mode: "serial" });

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function createNote(request: APIRequestContext, title: string) {
  const response = await request.post("/api/notes", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; optimisticVersion: number };
}

async function openNote(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await expect(
    page.getByRole("heading", { name: "Attachments" }),
  ).toBeVisible();
}

test("uploads, previews, downloads, filters, and removes attachments from the desktop editor", async ({
  page,
  request,
}) => {
  const title = `Attachment desktop ${Date.now()}`;
  const note = await createNote(request, title);
  await openNote(page, title);

  const pngUpload = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${note.id}/attachments?`) &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "local-preview.png",
    mimeType: "image/png",
    buffer: pngBytes,
  });
  const pngResponse = await pngUpload;
  expect(pngResponse.status()).toBe(201);
  const pngPayload = (await pngResponse.json()) as {
    attachment: { id: string; downloadUrl: string };
  };
  const pngCard = page.locator(".attachment-card").filter({
    hasText: "local-preview.png",
  });
  await expect(pngCard).toBeVisible();
  await expect(
    pngCard.getByRole("img", { name: "local-preview.png" }),
  ).toBeVisible();
  await expect(pngCard).toContainText("1 × 1");

  const jsonBytes = Buffer.from('{"desktop":true,"local":true}');
  const jsonUpload = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${note.id}/attachments?`) &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "workspace.json",
    mimeType: "application/json",
    buffer: jsonBytes,
  });
  expect((await jsonUpload).status()).toBe(201);
  await expect(
    page.locator(".attachment-card").filter({ hasText: "workspace.json" }),
  ).toBeVisible();

  const download = await request.get(pngPayload.attachment.downloadUrl);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pngBytes);
  expect(download.headers()).toMatchObject({
    "content-type": "image/png",
    "x-content-type-options": "nosniff",
  });
  expect(download.headers()["content-disposition"]).toContain("attachment;");

  await expect(
    page.getByRole("option", { name: new RegExp(`${title}.*2 files`) }),
  ).toBeVisible();
  await page.getByLabel("Attachment filter").selectOption("with");
  await expect(
    page.getByRole("option", { name: new RegExp(title) }),
  ).toBeVisible();

  await pngCard
    .getByRole("button", { name: "Remove attachment local-preview.png" })
    .click();
  await expect(
    pngCard.getByRole("button", { name: "Remove file" }),
  ).toBeVisible();
  const deletion = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/attachments/${pngPayload.attachment.id}`) &&
      response.request().method() === "DELETE",
  );
  await pngCard.getByRole("button", { name: "Remove file" }).click();
  expect((await deletion).status()).toBe(200);
  await expect(pngCard).toHaveCount(0);
  expect((await request.get(pngPayload.attachment.downloadUrl)).status()).toBe(
    404,
  );

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("supports dropped files, pasted images, recoverable upload errors, and storage checks", async ({
  page,
  request,
}) => {
  const title = `Attachment input ${Date.now()}`;
  const note = await createNote(request, title);
  await openNote(page, title);

  const dropUpload = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${note.id}/attachments?`) &&
      response.request().method() === "POST",
  );
  await page.locator(".editor-pane").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new TextEncoder().encode("dropped bytes")], "dropped.bin", {
        type: "application/x-local-test",
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  expect((await dropUpload).status()).toBe(201);
  await expect(
    page.locator(".attachment-card").filter({ hasText: "dropped.bin" }),
  ).toBeVisible();

  const pasteUpload = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${note.id}/attachments?`) &&
      response.request().method() === "POST",
  );
  await page.locator(".editor-pane").evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (value) =>
      value.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, pngBytes.toString("base64"));
  expect((await pasteUpload).status()).toBe(201);
  await expect(
    page.locator(".attachment-card").filter({ hasText: "pasted.png" }),
  ).toBeVisible();

  let failNextUpload = true;
  await page.route(`**/api/notes/${note.id}/attachments?*`, async (route) => {
    if (failNextUpload) {
      failNextUpload = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEST_UPLOAD_FAILURE", message: "Retry this upload" },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("retry bytes"),
  });
  const failedUpload = page
    .getByLabel("Attachment uploads")
    .locator('[data-state="failed"]')
    .filter({ hasText: "retry.txt" });
  await expect(failedUpload).toContainText("Retry this upload");
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${note.id}/attachments?`) &&
      response.request().method() === "POST",
  );
  await failedUpload
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  expect((await retryResponse).status()).toBe(201);
  await expect(
    page.locator(".attachment-card").filter({ hasText: "retry.txt" }),
  ).toBeVisible();
  await page.unroute(`**/api/notes/${note.id}/attachments?*`);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Organize notes" });
  await settings
    .getByRole("button", { name: "Check attachment storage" })
    .click();
  await expect(settings.getByText(/\d+ metadata rows/)).toBeVisible();
  await expect(settings.getByText(/0 missing · 0 corrupt/)).toBeVisible();
});
