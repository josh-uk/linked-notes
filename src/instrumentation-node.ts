import { readServerEnvironment } from "@/lib/env";
import { ensureAttachmentDirectoryWritable } from "@/server/attachments/attachment-storage";
import { BACKUP_SCHEMA_VERSION } from "@/server/backups/backup-format";
import { prisma } from "@/server/db";

const DATA_SCHEMA_VERSION = 1;

export async function runStartupChecks() {
  try {
    const environment = readServerEnvironment();
    await ensureAttachmentDirectoryWritable();
    const metadata = await prisma.schemaMetadata.findUnique({
      where: { id: 1 },
    });
    if (
      !metadata ||
      metadata.dataSchemaVersion !== DATA_SCHEMA_VERSION ||
      metadata.backupSchemaVersion !== BACKUP_SCHEMA_VERSION
    ) {
      throw new Error("SchemaMetadataMismatch");
    }
    console.info("startup_check_passed", {
      runtime: "nodejs",
      attachmentLimitBytes: environment.MAX_UPLOAD_BYTES,
      dataSchemaVersion: metadata.dataSchemaVersion,
      backupSchemaVersion: metadata.backupSchemaVersion,
    });
  } catch (error) {
    console.error("startup_check_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new Error("Linked Notes startup checks failed");
  }
}
