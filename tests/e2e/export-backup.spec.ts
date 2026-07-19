import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type APIRequestContext } from "@playwright/test";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function createNote(request: APIRequestContext, title: string) {
  const response = await request.post("/api/notes", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; optimisticVersion: number };
}

test("exports Markdown/PDF and safely replaces the workspace from a portable backup", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const target = await createNote(request, `Export target ${suffix}`);
  let source = await createNote(request, `Export source ${suffix}`);
  const contentResponse = await request.patch(`/api/notes/${source.id}`, {
    data: {
      expectedVersion: source.optimisticVersion,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Portable format" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Bold local link",
                marks: [
                  { type: "bold" },
                  {
                    type: "link",
                    attrs: { href: "https://example.test/read" },
                  },
                ],
              },
              { type: "text", text: " and " },
              {
                type: "mention",
                attrs: {
                  id: target.id,
                  mentionId: randomUUID(),
                  label: `Export target ${suffix}`,
                },
              },
            ],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Keep meaning" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  expect(contentResponse.status()).toBe(200);
  source = (await contentResponse.json()) as typeof source;
  const attachment = await request.post(
    `/api/notes/${source.id}/attachments?expectedVersion=${source.optimisticVersion}`,
    {
      headers: {
        "Content-Type": "image/png",
        "X-Linked-Notes-Filename": encodeURIComponent("pdf-image.png"),
      },
      data: pngBytes,
    },
  );
  expect(attachment.status()).toBe(201);

  await page.goto("/");
  await page
    .getByRole("option", { name: new RegExp(`Export source ${suffix}`) })
    .click();

  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export note as Markdown" }).click();
  const markdown = await markdownDownload;
  expect(markdown.suggestedFilename()).toContain("Export source");
  const markdownPath = await markdown.path();
  expect(markdownPath).not.toBeNull();
  const markdownText = await readFile(markdownPath!, "utf8");
  expect(markdownText).toContain("## Portable format");
  expect(markdownText).toContain("- [x] Keep meaning");
  expect(markdownText).toContain(`linked-notes://note/${target.id}`);
  expect(markdownText).toContain("pdf-image.png");

  const pdfDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export note as PDF with backlinks" })
    .click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/Export source.*\.pdf$/);
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.byteLength).toBeGreaterThan(10_000);

  const secondPdf = await request.get(
    `/api/notes/${source.id}/export?format=pdf&backlinks=true`,
  );
  expect(secondPdf.status()).toBe(200);
  expect(secondPdf.headers()).toMatchObject({
    "content-type": "application/pdf",
    "x-content-type-options": "nosniff",
  });
  expect(secondPdf.headers()["content-disposition"]).toContain("attachment;");
  const secondPdfBytes = await secondPdf.body();
  expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(
    createHash("sha256").update(secondPdfBytes).digest("hex"),
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Organize notes" });
  const backupDownload = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download full backup" }).click();
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toMatch(/\.linked-notes-backup\.tar\.gz$/);
  const backupPath = await backup.path();
  expect(backupPath).not.toBeNull();

  const extra = await createNote(request, `Removed by replace ${suffix}`);
  await dialog.getByLabel("Backup archive").setInputFiles(backupPath!);
  await dialog.getByLabel("Restore mode").selectOption("replace");
  await dialog.getByLabel(/Type REPLACE to confirm/).fill("REPLACE");
  const restoreResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/backups/restore?") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Validate and restore" }).click();
  expect((await restoreResponse).status()).toBe(200);
  await expect(dialog.getByText("Restore complete")).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Download safety backup" }),
  ).toBeVisible();
  const safetyDownload = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download safety backup" }).click();
  const safety = await safetyDownload;
  expect((await readFile((await safety.path())!)).subarray(0, 2)).toEqual(
    Buffer.from([0x1f, 0x8b]),
  );

  await dialog.getByRole("button", { name: "Reload workspace" }).click();
  await expect(
    page.getByRole("option", { name: new RegExp(`Export source ${suffix}`) }),
  ).toBeVisible();
  expect((await request.get(`/api/notes/${extra.id}`)).status()).toBe(404);
});
