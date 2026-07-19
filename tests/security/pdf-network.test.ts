import { describe, expect, it } from "vitest";

import { renderPrintHtmlPdf } from "@/server/exports/pdf-renderer";

describe("PDF renderer network boundary", () => {
  it("aborts non-local resource requests before rendering completes", async () => {
    await expect(
      renderPrintHtmlPdf(`<!doctype html>
        <html lang="en">
          <body><img src="http://127.0.0.1:9/private-resource"></body>
        </html>`),
    ).rejects.toMatchObject({ code: "PDF_NETWORK_REQUEST_BLOCKED" });
  });
});
