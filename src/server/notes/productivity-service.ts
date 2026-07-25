import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  EDITOR_DOCUMENT_SCHEMA_VERSION,
  EMPTY_EDITOR_DOCUMENT,
} from "@/features/notes/document-schema";
import type {
  DailyNoteResponse,
  NoteTemplateSummary,
} from "@/features/notes/types";
import { prisma } from "@/server/db";

import { deriveEditorDocument } from "./derive-document";
import { NoteDomainError } from "./note-errors";
import { getNote } from "./note-service";

const templateIdSchema = z.string().uuid();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
    );
  }, "Date must be a real calendar date");

export const createTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    title: z.string().max(500).default(""),
    content: z.unknown(),
  })
  .strict();

export const updateTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    title: z.string().max(500).optional(),
    content: z.unknown().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.title !== undefined ||
      value.content !== undefined,
    "At least one template field is required",
  );

export const dailyNoteInputSchema = z
  .object({
    date: isoDateSchema,
    templateId: templateIdSchema.optional(),
  })
  .strict();

export async function listNoteTemplates(): Promise<NoteTemplateSummary[]> {
  const templates = await prisma.noteTemplate.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return templates.map(serializeTemplate);
}

export async function createNoteTemplate(
  value: unknown,
): Promise<NoteTemplateSummary> {
  const input = createTemplateInputSchema.parse(value);
  const derived = deriveEditorDocument(input.content);
  try {
    const template = await prisma.noteTemplate.create({
      data: {
        name: input.name,
        title: input.title,
        content: derived.content as Prisma.InputJsonValue,
      },
    });
    return serializeTemplate(template);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new NoteDomainError(
        "NOTE_TEMPLATE_EXISTS",
        "A template with that name already exists",
        409,
      );
    }
    throw error;
  }
}

export async function updateNoteTemplate(
  id: string,
  value: unknown,
): Promise<NoteTemplateSummary> {
  templateIdSchema.parse(id);
  const input = updateTemplateInputSchema.parse(value);
  const derived =
    input.content === undefined
      ? undefined
      : deriveEditorDocument(input.content);
  try {
    const template = await prisma.noteTemplate.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(derived
          ? { content: derived.content as Prisma.InputJsonValue }
          : {}),
      },
    });
    return serializeTemplate(template);
  } catch (error) {
    if (isNotFound(error)) {
      throw new NoteDomainError(
        "NOTE_TEMPLATE_NOT_FOUND",
        "That note template no longer exists",
        404,
      );
    }
    if (isUniqueConstraint(error)) {
      throw new NoteDomainError(
        "NOTE_TEMPLATE_EXISTS",
        "A template with that name already exists",
        409,
      );
    }
    throw error;
  }
}

export async function deleteNoteTemplate(id: string) {
  templateIdSchema.parse(id);
  try {
    await prisma.noteTemplate.delete({ where: { id } });
    return { id, deleted: true as const };
  } catch (error) {
    if (isNotFound(error)) {
      throw new NoteDomainError(
        "NOTE_TEMPLATE_NOT_FOUND",
        "That note template no longer exists",
        404,
      );
    }
    throw error;
  }
}

export async function getOrCreateDailyNote(
  value: unknown,
): Promise<DailyNoteResponse> {
  const input = dailyNoteInputSchema.parse(value);
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const result = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.note.findUnique({
      where: { dailyDate: date },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const template = input.templateId
      ? await transaction.noteTemplate.findUnique({
          where: { id: input.templateId },
        })
      : null;
    if (input.templateId && !template) {
      throw new NoteDomainError(
        "NOTE_TEMPLATE_NOT_FOUND",
        "That note template no longer exists",
        404,
      );
    }
    const derived = deriveEditorDocument(
      template?.content ?? EMPTY_EDITOR_DOCUMENT,
    );
    const note = await transaction.note.create({
      data: {
        title:
          template?.title.trim() ||
          `Daily note — ${new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(date)}`,
        content: derived.content as Prisma.InputJsonValue,
        contentText: derived.plainText,
        contentHtml: derived.sanitizedHtml,
        contentSchema: EDITOR_DOCUMENT_SCHEMA_VERSION,
        dailyDate: date,
      },
      select: { id: true },
    });
    return { id: note.id, created: true };
  });
  return { note: await getNote(result.id), created: result.created };
}

type TemplateRecord = Awaited<
  ReturnType<typeof prisma.noteTemplate.findFirst>
> &
  object;

function serializeTemplate(template: NonNullable<TemplateRecord>) {
  return {
    id: template.id,
    name: template.name,
    title: template.title,
    content: template.content as NoteTemplateSummary["content"],
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function isUniqueConstraint(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isNotFound(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}
