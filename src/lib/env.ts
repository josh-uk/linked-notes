import { z } from "zod";
import path from "node:path";

const environmentBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const ollamaModelName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, {
    message: "Ollama model names contain unsupported characters",
  });

const localOllamaUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "host.docker.internal",
      "ollama",
    ].includes(url.hostname) &&
    !url.username &&
    !url.password &&
    (url.pathname === "/" || url.pathname === "") &&
    !url.search &&
    !url.hash
  );
}, "OLLAMA_BASE_URL must be an uncredentialed local Ollama origin");

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
  AI_ENABLED: environmentBoolean.default(false),
  OLLAMA_BASE_URL: localOllamaUrl.default("http://host.docker.internal:11434"),
  OLLAMA_CHAT_MODEL: ollamaModelName.default("qwen3.5:4b"),
  OLLAMA_EMBEDDING_MODEL: ollamaModelName.default("qwen3-embedding:0.6b"),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(120_000),
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
