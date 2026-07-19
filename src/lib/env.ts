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
