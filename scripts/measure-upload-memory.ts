import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

const appUrl = new URL(process.env.APP_URL ?? "http://127.0.0.1:3101");
if (appUrl.hostname !== "127.0.0.1" && appUrl.hostname !== "localhost") {
  throw new Error("Upload memory measurement only runs against loopback");
}

const byteSize = Number(process.env.UPLOAD_BYTES ?? 96 * 1_024 * 1_024);
if (
  !Number.isSafeInteger(byteSize) ||
  byteSize <= 0 ||
  byteSize > 100 * 1_024 * 1_024
) {
  throw new Error("UPLOAD_BYTES must be between 1 and 104857600");
}
const containerName = process.env.APP_CONTAINER ?? "linked-notes-app-1";
const chunkSize = 64 * 1_024;

async function main() {
  const createdResponse = await fetch(new URL("/api/notes", appUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Bounded upload memory measurement" }),
  });
  if (!createdResponse.ok) throw new Error("Could not create measurement note");
  const created = (await createdResponse.json()) as {
    id: string;
    optimisticVersion: number;
  };

  const samples: number[] = [await containerMemoryMiB(containerName)];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      samples.push(await containerMemoryMiB(containerName));
      await delay(80);
    }
  })();

  const started = performance.now();
  const clientHash = createHash("sha256");
  const uploadUrl = new URL(`/api/notes/${created.id}/attachments`, appUrl);
  uploadUrl.searchParams.set(
    "expectedVersion",
    created.optimisticVersion.toString(),
  );
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": byteSize.toString(),
        "X-Linked-Notes-Filename": encodeURIComponent("bounded-memory.bin"),
      },
      body: Readable.toWeb(
        streamBytes(byteSize, clientHash),
      ) as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } finally {
    sampling = false;
    await sampler;
  }
  const elapsedMs = performance.now() - started;
  if (!uploadResponse.ok) {
    throw new Error(`Upload failed with ${uploadResponse.status}`);
  }
  const uploaded = (await uploadResponse.json()) as {
    attachment: { id: string; checksumSha256: string };
    note: { optimisticVersion: number };
  };
  const expectedChecksumSha256 = clientHash.digest("hex");
  if (uploaded.attachment.checksumSha256 !== expectedChecksumSha256) {
    throw new Error("Server checksum did not match the streamed client bytes");
  }

  const deletion = await fetch(
    new URL(`/api/attachments/${uploaded.attachment.id}`, appUrl),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: uploaded.note.optimisticVersion,
      }),
    },
  );
  if (!deletion.ok) throw new Error("Measurement attachment cleanup failed");
  const deleted = (await deletion.json()) as {
    note: { optimisticVersion: number };
  };
  const trash = await fetch(
    new URL(`/api/notes/${created.id}/actions`, appUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "trash",
        expectedVersion: deleted.note.optimisticVersion,
      }),
    },
  );
  if (!trash.ok) throw new Error("Measurement note cleanup failed");
  const trashed = (await trash.json()) as { optimisticVersion: number };
  const permanentDelete = await fetch(
    new URL(`/api/notes/${created.id}/actions`, appUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        expectedVersion: trashed.optimisticVersion,
      }),
    },
  );
  if (!permanentDelete.ok) throw new Error("Measurement note cleanup failed");

  const baselineMiB = samples[0]!;
  const peakMiB = Math.max(...samples);
  console.log(
    JSON.stringify(
      {
        containerName,
        byteSize,
        chunkSize,
        elapsedMs: round(elapsedMs),
        throughputMiBPerSecond: round(
          byteSize / 1_048_576 / (elapsedMs / 1_000),
        ),
        baselineMiB,
        peakMiB,
        peakIncreaseMiB: round(peakMiB - baselineMiB),
        samples: samples.length,
        checksumSha256: uploaded.attachment.checksumSha256,
        checksumVerified: true,
      },
      null,
      2,
    ),
  );
}

function streamBytes(total: number, hash: ReturnType<typeof createHash>) {
  async function* generate() {
    const chunk = Buffer.alloc(chunkSize, 0x5a);
    let sent = 0;
    while (sent < total) {
      const length = Math.min(chunk.length, total - sent);
      const value = chunk.subarray(0, length);
      hash.update(value);
      yield value;
      sent += length;
      await delay(2);
    }
  }
  return Readable.from(generate());
}

async function containerMemoryMiB(name: string) {
  const output = await commandOutput("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{.MemUsage}}",
    name,
  ]);
  const used = output.split("/", 1)[0]!.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB)$/.exec(used);
  if (!match) throw new Error(`Could not parse container memory: ${used}`);
  const value = Number(match[1]);
  if (match[2] === "KiB") return round(value / 1_024);
  if (match[2] === "GiB") return round(value * 1_024);
  return value;
}

function commandOutput(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
