import { afterEach, describe, expect, it, vi } from "vitest";

import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import { noteApiError } from "@/server/notes/api-response";

afterEach(() => vi.restoreAllMocks());

describe("security boundaries", () => {
  it("builds a nonce-bound production policy with no inline-script or network wildcard", () => {
    const policy = buildContentSecurityPolicy("safeNonce123=", false);
    expect(policy).toContain(
      "script-src 'self' 'nonce-safeNonce123=' 'strict-dynamic'",
    );
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("https:");
    expect(policy).not.toContain("connect-src *");
  });

  it("adds only development allowances when explicitly requested", () => {
    const policy = buildContentSecurityPolicy("safeNonce123=", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("rejects unsafe nonce characters", () => {
    expect(() => buildContentSecurityPolicy("bad<nonce", false)).toThrow(
      "nonce was invalid",
    );
  });

  it("logs only the error class, never private error messages", async () => {
    const privateValue = "PRIVATE NOTE BODY AND SECRET";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = noteApiError(
      new Error(privateValue),
      "The operation failed safely",
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(privateValue);
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateValue);
    expect(log).toHaveBeenCalledWith("notes_api_error", {
      error: "Error",
    });
  });
});
