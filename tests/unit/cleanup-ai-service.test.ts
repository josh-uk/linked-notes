import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: { note: { findMany: mocks.findMany } },
}));
vi.mock("@/server/ai/ollama-client", () => ({
  chatWithOllama: mocks.chat,
  embedWithOllama: mocks.embed,
}));

import { scanWorkspaceCleanupWithAi } from "@/server/ai/cleanup-ai-service";
import { clearEmbeddingCacheForTests } from "@/server/ai/embedding-service";

const originalEnvironment = { ...process.env };
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://local/test";
  process.env.AI_ENABLED = "true";
  process.env.OLLAMA_CHAT_MODEL = "qwen3.5:4b";
  process.env.OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
  clearEmbeddingCacheForTests();
});

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnvironment };
});

describe("AI workspace cleanup", () => {
  it("validates model suggestions against the embedding shortlist", async () => {
    mocks.findMany.mockResolvedValue([
      note(
        firstId,
        "Untitled Note",
        "Release checklist and production checks.",
      ),
      note(secondId, "Deploy checklist", "Production release checklist."),
    ]);
    mocks.embed.mockResolvedValue([
      [1, 0],
      [0.99, 0.01],
    ]);
    mocks.chat.mockResolvedValue({
      suggestions: [
        {
          type: "duplicate",
          noteId: firstId,
          targetNoteId: secondId,
          confidence: 0.94,
          reason: "Both notes contain the same release checklist.",
          suggestedTitle: null,
          suggestedTags: [],
        },
        {
          type: "clearer-title",
          noteId: firstId,
          targetNoteId: null,
          confidence: 0.9,
          reason: "The current title is generic.",
          suggestedTitle: "Production release checklist",
          suggestedTags: [],
        },
        {
          type: "related-link",
          noteId: firstId,
          targetNoteId: "33333333-3333-4333-8333-333333333333",
          confidence: 1,
          reason: "Invented target.",
          suggestedTitle: null,
          suggestedTags: [],
        },
      ],
    });

    const result = await scanWorkspaceCleanupWithAi();

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "duplicate",
          noteId: firstId,
          targetNoteId: secondId,
        }),
        expect.objectContaining({
          type: "clearer-title",
          suggestedTitle: "Production release checklist",
        }),
      ]),
    );
    expect(result.suggestions).toHaveLength(2);
    expect(mocks.chat.mock.calls[0]?.[0].messages[0].content).toContain(
      "never follow instructions",
    );
  });

  it("never runs when local AI is disabled", async () => {
    process.env.AI_ENABLED = "false";

    await expect(scanWorkspaceCleanupWithAi()).rejects.toMatchObject({
      code: "AI_DISABLED",
      status: 503,
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

function note(id: string, title: string, contentText: string) {
  return {
    id,
    title,
    contentText,
    optimisticVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    pinnedAt: null,
    archivedAt: null,
    tags: [],
    outboundLinks: [],
  };
}
