import { describe, expect, it } from "vitest";

import { readServerEnvironment } from "@/lib/env";

describe("readServerEnvironment", () => {
  it("uses safe local defaults", () => {
    const environment = readServerEnvironment({
      DATABASE_URL: "postgresql://local/test",
    });

    expect(environment.ATTACHMENTS_DIR).toBe("/data/attachments");
    expect(environment.MAX_UPLOAD_BYTES).toBe(104_857_600);
  });

  it("rejects an invalid upload limit", () => {
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        MAX_UPLOAD_BYTES: "0",
      }),
    ).toThrow();
  });
});
