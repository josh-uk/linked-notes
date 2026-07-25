import { z } from "zod";

import { readServerEnvironment } from "@/lib/env";

import { AiDomainError } from "./ai-errors";

const MAX_RESPONSE_BYTES = 1_048_576;
const KEEP_ALIVE = "2m";

const tagsResponseSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(1),
      }),
    )
    .default([]),
});

const chatResponseSchema = z.object({
  message: z.object({
    content: z.string().min(1).max(524_288),
  }),
});

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number().finite()).min(1)).min(1),
});

export type OllamaMessage = {
  role: "system" | "user";
  content: string;
};

export async function listOllamaModels(): Promise<string[]> {
  const response = await ollamaRequest("/api/tags");
  return parseProviderResponse(tagsResponseSchema, response).models.map(
    ({ name }) => name,
  );
}

export async function chatWithOllama<T>({
  messages,
  format,
  responseSchema,
}: {
  messages: OllamaMessage[];
  format: Record<string, unknown>;
  responseSchema: z.ZodType<T>;
}): Promise<T> {
  const environment = readServerEnvironment();
  const response = await ollamaRequest("/api/chat", {
    model: environment.OLLAMA_CHAT_MODEL,
    messages,
    format,
    stream: false,
    think: false,
    keep_alive: KEEP_ALIVE,
    options: {
      temperature: 0.2,
      num_ctx: 8_192,
    },
  });
  const content = parseProviderResponse(chatResponseSchema, response).message
    .content;
  try {
    return responseSchema.parse(JSON.parse(content));
  } catch {
    throw new AiDomainError(
      "AI_INVALID_RESPONSE",
      "The local model returned an invalid response. Try the analysis again.",
      502,
    );
  }
}

export async function embedWithOllama(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const environment = readServerEnvironment();
  const response = await ollamaRequest("/api/embed", {
    model: environment.OLLAMA_EMBEDDING_MODEL,
    input: inputs,
    truncate: true,
    keep_alive: KEEP_ALIVE,
  });
  const embeddings = parseProviderResponse(
    embedResponseSchema,
    response,
  ).embeddings;
  if (embeddings.length !== inputs.length) {
    throw new AiDomainError(
      "AI_INVALID_RESPONSE",
      "The local embedding model returned an incomplete response.",
      502,
    );
  }
  return embeddings;
}

async function ollamaRequest(
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const environment = readServerEnvironment();
  if (!environment.AI_ENABLED) {
    throw new AiDomainError(
      "AI_DISABLED",
      "Local AI is disabled. Enable it in the Linked Notes environment first.",
      503,
    );
  }

  const baseUrl = environment.OLLAMA_BASE_URL.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(environment.AI_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new AiDomainError(
        "AI_TIMEOUT",
        "The local model took too long to respond. Try again.",
        504,
      );
    }
    throw new AiDomainError(
      "AI_UNAVAILABLE",
      "Ollama is not reachable. Check that the native Ollama service is running.",
      503,
    );
  }

  const payload = await readBoundedJson(response);
  if (!response.ok) {
    const message = ollamaErrorMessage(payload);
    const missingModel =
      response.status === 404 ||
      /model.+(?:not found|missing)|pull model/i.test(message);
    throw new AiDomainError(
      missingModel ? "AI_MODEL_MISSING" : "AI_PROVIDER_ERROR",
      missingModel
        ? "A configured local model is missing. Pull the models and try again."
        : "Ollama could not complete the request. Try again.",
      missingModel ? 503 : 502,
    );
  }
  return payload;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new AiDomainError(
      "AI_RESPONSE_TOO_LARGE",
      "The local model returned an unexpectedly large response.",
      502,
    );
  }

  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AiDomainError(
        "AI_RESPONSE_TOO_LARGE",
        "The local model returned an unexpectedly large response.",
        502,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AiDomainError(
      "AI_INVALID_RESPONSE",
      "Ollama returned an unreadable response.",
      502,
    );
  }
}

function ollamaErrorMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return "";
}

function parseProviderResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new AiDomainError(
    "AI_INVALID_RESPONSE",
    "Ollama returned an invalid response.",
    502,
  );
}
