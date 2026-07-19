import { chromium } from "playwright-core";

import type { BacklinksResponse, MentionTarget } from "@/features/notes/types";
import { NoteDomainError } from "@/server/notes/note-errors";
import { renderEditorDocumentHtml } from "@/server/notes/derive-document";

export type PdfExportAttachment = {
  originalName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  available: boolean;
  embeddedDataUrl: string | null;
};

export type PdfExportModel = {
  note: {
    id: string;
    title: string;
    content: unknown;
    createdAt: Date;
    updatedAt: Date;
    folderName: string | null;
    tags: Array<{ displayName: string; color: string | null }>;
  };
  mentionTargets: MentionTarget[];
  attachments: PdfExportAttachment[];
  backlinks: BacklinksResponse | null;
};

let rendererQueue: Promise<void> = Promise.resolve();

export function renderNotePdf(model: PdfExportModel) {
  const work = rendererQueue.then(() =>
    renderPrintHtmlPdf(buildNotePrintHtml(model)),
  );
  rendererQueue = work.then(
    () => undefined,
    () => undefined,
  );
  return work;
}

export function buildNotePrintHtml(model: PdfExportModel) {
  const noteHtml = renderEditorDocumentHtml(model.note.content, {
    currentNoteId: model.note.id,
    targets: model.mentionTargets,
  });
  const metadata = [
    model.note.folderName ? `Folder: ${model.note.folderName}` : null,
    model.note.tags.length
      ? `Tags: ${model.note.tags.map(({ displayName }) => displayName).join(", ")}`
      : null,
    `Created: ${model.note.createdAt.toISOString()}`,
    `Updated: ${model.note.updatedAt.toISOString()}`,
  ].filter((value): value is string => Boolean(value));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(model.note.title || "Untitled Note")}</title>
  <style>
    @page { size: A4; margin: 18mm 17mm 20mm; }
    * { box-sizing: border-box; }
    html { color: #25221f; background: #fff; font: 11pt/1.52 Arial, Helvetica, sans-serif; }
    body { margin: 0; overflow-wrap: anywhere; }
    h1, h2, h3 { color: #1f1c19; line-height: 1.22; break-after: avoid; }
    .document-title { margin: 0 0 8px; font-size: 25pt; letter-spacing: -0.025em; }
    .metadata { margin: 0 0 24px; color: #6d655e; font-size: 8.5pt; }
    .metadata span + span::before { content: " · "; }
    a { color: #7d4e36; text-decoration-thickness: 1px; }
    p, li, blockquote, pre { orphans: 3; widows: 3; }
    blockquote { margin-left: 0; padding-left: 13px; border-left: 3px solid #d5c5b8; color: #514942; }
    code { border-radius: 3px; background: #f2eeea; padding: 1px 3px; font: 0.92em ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; padding: 10px 12px; background: #f2eeea; border: 1px solid #ded6cf; border-radius: 6px; }
    pre code { padding: 0; }
    .note-mention { display: inline; border-radius: 3px; background: #f1e2d7; color: #74452f; padding: 0 3px; }
    .note-mention.is-missing, .note-mention.is-trashed { text-decoration: line-through; color: #766d66; background: #ece8e4; }
    ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    ul[data-type="taskList"] li { display: flex; gap: 8px; }
    ul[data-type="taskList"] input { margin-top: 4px; }
    hr { border: 0; border-top: 1px solid #d9d1ca; margin: 20px 0; }
    .section { margin-top: 28px; break-before: auto; }
    .section > h2 { border-bottom: 1px solid #ddd4cc; padding-bottom: 5px; font-size: 14pt; }
    .attachment { display: grid; grid-template-columns: 1fr auto; gap: 4px 14px; border-bottom: 1px solid #eee8e3; padding: 8px 0; break-inside: avoid; }
    .attachment strong { min-width: 0; }
    .attachment small { color: #746c65; }
    .attachment img { grid-column: 1 / -1; display: block; max-width: 100%; max-height: 105mm; margin-top: 7px; object-fit: contain; object-position: left top; }
    .backlink { border-bottom: 1px solid #eee8e3; padding: 7px 0; break-inside: avoid; }
    .backlink span { color: #746c65; font-size: 9pt; }
    .footer-id { margin-top: 30px; color: #958c84; font-size: 7.5pt; }
  </style>
</head>
<body>
  <header>
    <h1 class="document-title">${escapeHtml(model.note.title || "Untitled Note")}</h1>
    <p class="metadata">${metadata.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</p>
  </header>
  <main>${noteHtml || "<p></p>"}</main>
  ${renderAttachmentSection(model.attachments)}
  ${renderBacklinkSection(model.backlinks)}
  <p class="footer-id">Linked Notes · ${escapeHtml(model.note.id)}</p>
</body>
</html>`;
}

/** Internal rendering boundary kept public for direct security regression tests. */
export async function renderPrintHtmlPdf(html: string) {
  let browser;
  let blockedRequests = 0;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
        "--host-resolver-rules=MAP * ~NOTFOUND",
      ],
    });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url === "about:blank" ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      ) {
        await route.continue();
        return;
      }
      blockedRequests += 1;
      await route.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    });
    if (blockedRequests > 0) {
      throw new NoteDomainError(
        "PDF_NETWORK_REQUEST_BLOCKED",
        "The print renderer rejected a network resource",
        400,
      );
    }
    return normalizePdf(Buffer.from(pdf));
  } catch (error) {
    if (error instanceof NoteDomainError) throw error;
    console.warn("pdf_renderer_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new NoteDomainError(
      "PDF_RENDERER_UNAVAILABLE",
      "Linked Notes could not start its local PDF renderer",
      503,
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function normalizePdf(input: Buffer) {
  let value = input.toString("latin1");
  value = replaceSameLength(
    value,
    /\/(CreationDate|ModDate) \(D:[^)]+\)/g,
    (match) => {
      const key = match.startsWith("/CreationDate")
        ? "CreationDate"
        : "ModDate";
      return `/${key} (D:20000101000000+00'00')`;
    },
  );
  value = replaceSameLength(
    value,
    /\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/g,
    (match) => match.replaceAll(/[0-9A-Fa-f]/g, "0"),
  );
  return Buffer.from(value, "latin1");
}

function replaceSameLength(
  value: string,
  pattern: RegExp,
  replacement: (match: string) => string,
) {
  return value.replace(pattern, (match) => {
    const next = replacement(match);
    if (next.length > match.length) return next.slice(0, match.length);
    return next.padEnd(match.length, " ");
  });
}

function renderAttachmentSection(attachments: PdfExportAttachment[]) {
  if (attachments.length === 0) return "";
  return `<section class="section"><h2>Attachments</h2>${attachments
    .map(
      (attachment) => `<article class="attachment">
        <strong>${escapeHtml(attachment.originalName)}</strong>
        <small>${formatBytes(attachment.byteSize)} · ${escapeHtml(attachment.mimeType)}${attachment.available ? "" : " · unavailable"}</small>
        ${
          attachment.embeddedDataUrl
            ? `<img src="${attachment.embeddedDataUrl}" alt="${escapeAttribute(attachment.originalName)}" width="${attachment.width ?? ""}" height="${attachment.height ?? ""}">`
            : ""
        }
      </article>`,
    )
    .join("")}</section>`;
}

function renderBacklinkSection(backlinks: BacklinksResponse | null) {
  if (!backlinks || backlinks.items.length === 0) return "";
  const shownMentions = backlinks.items.reduce(
    (total, item) => total + item.contexts.length,
    0,
  );
  const truncation = backlinks.nextCursor
    ? `<p>Showing the first ${shownMentions} of ${backlinks.totalMentions} backlink mentions. Open Linked Notes to load the remaining pages.</p>`
    : "";
  return `<section class="section"><h2>Backlinks</h2>${truncation}${backlinks.items
    .map(
      (item) =>
        `<article class="backlink"><strong>${escapeHtml(item.sourceTitle)}</strong> <span>(${item.sourceState})</span>${item.contexts
          .map((context) => `<p>${escapeHtml(context.context)}</p>`)
          .join("")}</article>`,
    )
    .join("")}</section>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
