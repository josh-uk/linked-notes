import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiDomainError } from "@/server/ai/ai-errors";
import {
  chatWithOllama,
  embedWithOllama,
  listOllamaModels,
} from "@/server/ai/ollama-client";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://local/test";
  process.env.AI_ENABLED = "true";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_CHAT_MODEL = "qwen3.5:4b";
  process.env.OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
  process.env.AI_REQUEST_TIMEOUT_MS = "120000";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

describe("Ollama client", () => {
  it("lists local model names without exposing the endpoint to the browser", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        models: [{ name: "qwen3.5:4b" }, { name: "qwen3-embedding:0.6b" }],
      }),
    );

    await expect(listOllamaModels()).resolves.toEqual([
      "qwen3.5:4b",
      "qwen3-embedding:0.6b",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/tags",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("requests bounded structured chat output with thinking disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        message: { content: JSON.stringify({ bullets: ["A", "B", "C"] }) },
      }),
    );

    const result = await chatWithOllama({
      messages: [{ role: "user", content: "Summarise" }],
      format: { type: "object" },
      responseSchema: z.object({
        bullets: z.array(z.string()).length(3),
      }),
    });

    expect(result.bullets).toEqual(["A", "B", "C"]);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "qwen3.5:4b",
      stream: false,
      think: false,
      keep_alive: "2m",
      options: { num_ctx: 8192 },
    });
  });

  it("validates embedding count and dimensions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        embeddings: [
          [1, 0],
          [0, 1],
        ],
      }),
    );
    await expect(embedWithOllama(["one", "two"])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("turns malformed output, missing models, and timeouts into safe errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: { content: "{not-json" } }),
    );
    await expect(
      chatWithOllama({
        messages: [{ role: "user", content: "Summarise" }],
        format: { type: "object" },
        responseSchema: z.object({ bullets: z.array(z.string()) }),
      }),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE", status: 502 });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "model 'missing' not found" }, 404),
    );
    await expect(embedWithOllama(["one"])).rejects.toMatchObject({
      code: "AI_MODEL_MISSING",
      status: 503,
    });

    fetchMock.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(listOllamaModels()).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      status: 504,
    });
  });

  it("rejects disabled AI before making a network request", async () => {
    process.env.AI_ENABLED = "false";
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(listOllamaModels()).rejects.toBeInstanceOf(AiDomainError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized responses before parsing private content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Length": "1048577" },
      }),
    );

    await expect(listOllamaModels()).rejects.toMatchObject({
      code: "AI_RESPONSE_TOO_LARGE",
      status: 502,
    });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
