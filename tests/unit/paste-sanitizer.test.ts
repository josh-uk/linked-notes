import { describe, expect, it } from "vitest";

import { sanitizePastedHtml } from "@/features/notes/paste-sanitizer";

describe("sanitizePastedHtml", () => {
  it("keeps safe common formatting while removing active attributes", () => {
    const result = sanitizePastedHtml(
      '<p style="position:fixed" onclick="alert(1)"><strong>Safe</strong> text</p>',
    );

    expect(result).toBe("<p><strong>Safe</strong> text</p>");
  });

  it("converts markup containing active elements to plain text", () => {
    const result = sanitizePastedHtml("<p>Hello</p><script>alert(1)</script>");

    expect(result).toBe("Helloalert(1)");
    expect(result).not.toContain("<script");
  });

  it("removes unsafe link targets", () => {
    expect(sanitizePastedHtml('<a href="javascript:alert(1)">Bad</a>')).toBe(
      "<a>Bad</a>",
    );
  });
});
