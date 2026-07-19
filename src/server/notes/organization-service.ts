import { Prisma, SettingType } from "@prisma/client";
import { z } from "zod";

import type {
  FolderSummary,
  OrganizationResponse,
  TagSummary,
} from "@/features/notes/types";
import { prisma } from "@/server/db";

import { NoteDomainError } from "./note-errors";

export const MAX_FOLDER_DEPTH = 6;
const TRASH_RETENTION_KEY = "trashRetentionDays";

const folderNameSchema = z.string().trim().min(1).max(200);
const folderParentSchema = z.string().uuid().nullable();
const tagNameSchema = z.string().trim().min(1).max(100);
const tagColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

export const createFolderInputSchema = z
  .object({
    name: folderNameSchema,
    parentId: folderParentSchema.default(null),
    sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
  })
  .strict();

export const updateFolderInputSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: folderParentSchema.optional(),
    sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one folder field is required",
  });

export const deleteFolderInputSchema = z
  .object({
    strategy: z.enum(["move-to-parent", "trash-notes"]),
  })
  .strict();

export const createTagInputSchema = z
  .object({
    name: tagNameSchema,
    color: tagColorSchema.default(null),
  })
  .strict();

export const updateTagInputSchema = z
  .object({
    name: tagNameSchema.optional(),
    color: tagColorSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one tag field is required",
  });

export const trashRetentionInputSchema = z
  .object({ days: z.number().int().min(0).max(3650) })
  .strict();

type FolderNode = { id: string; parentId: string | null; name?: string };

export async function getOrganization(): Promise<OrganizationResponse> {
  const [folders, tags, setting] = await Promise.all([
    prisma.folder.findMany({
      orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { notes: true } } },
    }),
    prisma.tag.findMany({
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      include: { _count: { select: { notes: true } } },
    }),
    prisma.setting.findUnique({ where: { key: TRASH_RETENTION_KEY } }),
  ]);

  return {
    folders: folders.map(serializeFolder),
    tags: tags.map(serializeTag),
    trashRetentionDays: settingNumber(setting?.value),
    maxFolderDepth: MAX_FOLDER_DEPTH,
  };
}

export async function createFolder(value: unknown): Promise<FolderSummary> {
  const input = createFolderInputSchema.parse(value);
  try {
    return await prisma.$transaction(async (transaction) => {
      const folders = await transaction.folder.findMany({
        select: { id: true, parentId: true, name: true },
      });
      assertFolderPlacement(folders, null, input.parentId);
      if (
        await transaction.folder.findFirst({
          where: {
            parentId: input.parentId,
            name: { equals: input.name, mode: "insensitive" },
          },
        })
      ) {
        throw new NoteDomainError(
          "ORGANIZATION_CONFLICT",
          "A folder with that name already exists here",
          409,
        );
      }
      return serializeFolder(
        await transaction.folder.create({
          data: input,
          include: { _count: { select: { notes: true } } },
        }),
      );
    });
  } catch (error) {
    throw mapOrganizationConstraint(
      error,
      "A folder with that name already exists here",
    );
  }
}

export async function updateFolder(
  id: string,
  value: unknown,
): Promise<FolderSummary> {
  z.string().uuid().parse(id);
  const input = updateFolderInputSchema.parse(value);
  try {
    return await prisma.$transaction(async (transaction) => {
      const folders = await transaction.folder.findMany({
        select: { id: true, parentId: true, name: true },
      });
      const current = folders.find((folder) => folder.id === id);
      if (!current) throw notFound("FOLDER_NOT_FOUND", "Folder not found");
      const nextParent =
        input.parentId === undefined ? current.parentId : input.parentId;
      assertFolderPlacement(folders, id, nextParent);
      const nextName = input.name ?? current.name!;
      if (
        await transaction.folder.findFirst({
          where: {
            id: { not: id },
            parentId: nextParent,
            name: { equals: nextName, mode: "insensitive" },
          },
        })
      ) {
        throw new NoteDomainError(
          "ORGANIZATION_CONFLICT",
          "A folder with that name already exists here",
          409,
        );
      }
      return serializeFolder(
        await transaction.folder.update({
          where: { id },
          data: input,
          include: { _count: { select: { notes: true } } },
        }),
      );
    });
  } catch (error) {
    throw mapOrganizationConstraint(
      error,
      "A folder with that name already exists here",
    );
  }
}

export async function deleteFolder(id: string, value: unknown) {
  z.string().uuid().parse(id);
  const input = deleteFolderInputSchema.parse(value);
  try {
    return await prisma.$transaction(async (transaction) => {
      const folders = await transaction.folder.findMany({
        select: { id: true, parentId: true, name: true },
      });
      const folder = folders.find((item) => item.id === id);
      if (!folder) throw notFound("FOLDER_NOT_FOUND", "Folder not found");

      if (input.strategy === "move-to-parent") {
        assertChildFoldersCanMove(folders, id, folder.parentId);
        await transaction.note.updateMany({
          where: { folderId: id },
          data: {
            folderId: folder.parentId,
            optimisticVersion: { increment: 1 },
          },
        });
        await transaction.folder.updateMany({
          where: { parentId: id },
          data: { parentId: folder.parentId },
        });
        await transaction.folder.delete({ where: { id } });
        return { id, deleted: true as const, strategy: input.strategy };
      }

      const subtree = collectSubtree(folders, id);
      await transaction.note.updateMany({
        where: { folderId: { in: subtree } },
        data: {
          folderId: null,
          trashedAt: new Date(),
          pinnedAt: null,
          optimisticVersion: { increment: 1 },
        },
      });
      for (const folderId of [...subtree].reverse()) {
        await transaction.folder.delete({ where: { id: folderId } });
      }
      return { id, deleted: true as const, strategy: input.strategy };
    });
  } catch (error) {
    throw mapOrganizationConstraint(
      error,
      "Child folders conflict with folders at the destination",
    );
  }
}

function assertChildFoldersCanMove(
  folders: Required<FolderNode>[],
  folderId: string,
  destinationParentId: string | null,
) {
  const movingChildren = folders.filter(
    (folder) => folder.parentId === folderId,
  );
  const destinationNames = new Set(
    folders
      .filter(
        (folder) =>
          folder.parentId === destinationParentId && folder.id !== folderId,
      )
      .map((folder) => folder.name.toLocaleLowerCase()),
  );

  for (const child of movingChildren) {
    const normalizedName = child.name.toLocaleLowerCase();
    if (destinationNames.has(normalizedName)) {
      throw new NoteDomainError(
        "ORGANIZATION_CONFLICT",
        "Child folders conflict with folders at the destination",
        409,
      );
    }
    destinationNames.add(normalizedName);
  }
}

export async function createTag(value: unknown): Promise<TagSummary> {
  const input = createTagInputSchema.parse(value);
  try {
    return serializeTag(
      await prisma.tag.create({
        data: {
          normalizedName: normalizeTagName(input.name),
          displayName: compactName(input.name),
          color: input.color,
        },
        include: { _count: { select: { notes: true } } },
      }),
    );
  } catch (error) {
    throw mapOrganizationConstraint(
      error,
      "A tag with that name already exists",
    );
  }
}

export async function updateTag(
  id: string,
  value: unknown,
): Promise<TagSummary> {
  z.string().uuid().parse(id);
  const input = updateTagInputSchema.parse(value);
  try {
    return serializeTag(
      await prisma.tag.update({
        where: { id },
        data: {
          ...(input.name === undefined
            ? {}
            : {
                normalizedName: normalizeTagName(input.name),
                displayName: compactName(input.name),
              }),
          ...(input.color === undefined ? {} : { color: input.color }),
        },
        include: { _count: { select: { notes: true } } },
      }),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw notFound("TAG_NOT_FOUND", "Tag not found");
    }
    throw mapOrganizationConstraint(
      error,
      "A tag with that name already exists",
    );
  }
}

export async function deleteTag(id: string) {
  z.string().uuid().parse(id);
  try {
    await prisma.tag.delete({ where: { id } });
    return { id, deleted: true as const };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw notFound("TAG_NOT_FOUND", "Tag not found");
    }
    throw error;
  }
}

export async function setTrashRetention(value: unknown) {
  const input = trashRetentionInputSchema.parse(value);
  await prisma.setting.upsert({
    where: { key: TRASH_RETENTION_KEY },
    create: {
      key: TRASH_RETENTION_KEY,
      type: SettingType.NUMBER,
      value: input.days,
      version: 1,
    },
    update: {
      type: SettingType.NUMBER,
      value: input.days,
      version: { increment: 1 },
    },
  });
  return { days: input.days };
}

export async function applyConfiguredTrashRetention(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: TRASH_RETENTION_KEY },
    select: { value: true },
  });
  const days = settingNumber(setting?.value);
  if (days === 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return (
    await prisma.note.deleteMany({
      where: { trashedAt: { lte: cutoff } },
    })
  ).count;
}

export async function assertFolderExists(
  transaction: Prisma.TransactionClient,
  folderId: string | null,
) {
  if (folderId === null) return;
  if (!(await transaction.folder.findUnique({ where: { id: folderId } }))) {
    throw notFound("FOLDER_NOT_FOUND", "Folder not found");
  }
}

export async function assertTagsExist(
  transaction: Prisma.TransactionClient,
  tagIds: string[],
) {
  if (tagIds.length === 0) return;
  const count = await transaction.tag.count({ where: { id: { in: tagIds } } });
  if (count !== new Set(tagIds).size) {
    throw notFound("TAG_NOT_FOUND", "One or more tags were not found");
  }
}

function assertFolderPlacement(
  folders: FolderNode[],
  folderId: string | null,
  parentId: string | null,
) {
  if (folderId && parentId === folderId) {
    throw new NoteDomainError(
      "FOLDER_CYCLE",
      "A folder cannot be its own parent",
      409,
    );
  }

  let parentDepth = 0;
  let cursor = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (folderId && cursor === folderId) {
      throw new NoteDomainError(
        "FOLDER_CYCLE",
        "A folder cannot be moved inside its descendant",
        409,
      );
    }
    if (visited.has(cursor)) {
      throw new NoteDomainError(
        "FOLDER_CYCLE",
        "The folder tree contains a cycle",
        409,
      );
    }
    visited.add(cursor);
    const parent = folders.find((folder) => folder.id === cursor);
    if (!parent)
      throw notFound("FOLDER_PARENT_NOT_FOUND", "Parent folder not found");
    parentDepth += 1;
    cursor = parent.parentId;
  }

  const subtreeHeight = folderId ? getSubtreeHeight(folders, folderId) : 1;
  if (parentDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
    throw new NoteDomainError(
      "FOLDER_DEPTH_EXCEEDED",
      `Folders may be at most ${MAX_FOLDER_DEPTH} levels deep`,
      409,
    );
  }
}

function getSubtreeHeight(folders: FolderNode[], rootId: string): number {
  const children = folders.filter((folder) => folder.parentId === rootId);
  if (children.length === 0) return 1;
  return (
    1 +
    Math.max(...children.map((child) => getSubtreeHeight(folders, child.id)))
  );
}

function collectSubtree(folders: FolderNode[], rootId: string): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    result.push(id);
    folders
      .filter((folder) => folder.parentId === id)
      .forEach((child) => visit(child.id));
  };
  visit(rootId);
  return result;
}

function normalizeTagName(value: string): string {
  return compactName(value).toLocaleLowerCase();
}

function compactName(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function settingNumber(value: Prisma.JsonValue | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function notFound(code: string, message: string) {
  return new NoteDomainError(code, message, 404);
}

function mapOrganizationConstraint(error: unknown, message: string): Error {
  if (error instanceof NoteDomainError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2014") {
      return new NoteDomainError("ORGANIZATION_CONFLICT", message, 409);
    }
    if (error.code === "P2025")
      return notFound("FOLDER_NOT_FOUND", "Folder not found");
  }
  return error instanceof Error
    ? error
    : new Error("Organization operation failed");
}

function serializeFolder(folder: {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { notes: number };
}): FolderSummary {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    sortOrder: folder.sortOrder,
    noteCount: folder._count.notes,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

function serializeTag(tag: {
  id: string;
  normalizedName: string;
  displayName: string;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { notes: number };
}): TagSummary {
  return {
    id: tag.id,
    normalizedName: tag.normalizedName,
    displayName: tag.displayName,
    color: tag.color,
    noteCount: tag._count.notes,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}
