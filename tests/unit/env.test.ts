import { describe, expect, it } from "vitest";

import { readServerEnvironment } from "@/lib/env";

describe("readServerEnvironment", () => {
  it("uses safe local defaults", () => {
    const environment = readServerEnvironment({
      DATABASE_URL: "postgresql://local/test",
    });

    expect(environment.ATTACHMENTS_DIR).toBe("/data/attachments");
    expect(environment.MAX_UPLOAD_BYTES).toBe(104_857_600);
    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.OLLAMA_BASE_URL).toBe(
      "http://host.docker.internal:11434",
    );
    expect(environment.OLLAMA_CHAT_MODEL).toBe("qwen3.5:4b");
    expect(environment.OLLAMA_EMBEDDING_MODEL).toBe("qwen3-embedding:0.6b");
    expect(environment.AI_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  it("rejects an invalid upload limit", () => {
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        MAX_UPLOAD_BYTES: "0",
      }),
    ).toThrow();
  });

  it("rejects a relative attachment directory", () => {
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        ATTACHMENTS_DIR: "./attachments",
      }),
    ).toThrow();
  });

  it("parses explicit local AI configuration without coercing false to true", () => {
    const disabled = readServerEnvironment({
      DATABASE_URL: "postgresql://local/test",
      AI_ENABLED: "false",
    });
    const enabled = readServerEnvironment({
      DATABASE_URL: "postgresql://local/test",
      AI_ENABLED: "true",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_CHAT_MODEL: "qwen3.5:9b",
      OLLAMA_EMBEDDING_MODEL: "qwen3-embedding:0.6b",
      AI_REQUEST_TIMEOUT_MS: "30000",
    });

    expect(disabled.AI_ENABLED).toBe(false);
    expect(enabled).toMatchObject({
      AI_ENABLED: true,
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_CHAT_MODEL: "qwen3.5:9b",
      AI_REQUEST_TIMEOUT_MS: 30_000,
    });
  });

  it("rejects unsafe AI endpoints, model names, and timeouts", () => {
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        OLLAMA_BASE_URL: "https://example.com",
      }),
    ).toThrow();
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        OLLAMA_CHAT_MODEL: "model name with spaces",
      }),
    ).toThrow();
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://local/test",
        AI_REQUEST_TIMEOUT_MS: "999",
      }),
    ).toThrow();
  });
});
