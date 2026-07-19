import { z } from "zod";
import path from "node:path";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ATTACHMENTS_DIR: z
    .string()
    .min(1)
    .refine((value) => path.isAbsolute(value), {
      message: "ATTACHMENTS_DIR must be absolute",
    })
    .default("/data/attachments"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),
  MAX_PDF_IMAGE_BYTES: z.coerce.number().int().positive().default(26_214_400),
  MAX_BACKUP_ARCHIVE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2_147_483_648),
  MAX_BACKUP_EXPANDED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4_294_967_296),
  MAX_BACKUP_MANIFEST_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(26_214_400),
  MAX_BACKUP_ENTRIES: z.coerce.number().int().positive().default(50_000),
  MAX_BACKUP_COMPRESSION_RATIO: z.coerce.number().positive().default(5_000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnvironment = z.infer<typeof serverEnvSchema>;

export function readServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvSchema.parse(environment);
}
