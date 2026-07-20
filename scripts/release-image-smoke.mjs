import { spawn } from "node:child_process";

const appImage = process.env.APP_IMAGE ?? "linked-notes:release-candidate";
const migrateImage =
  process.env.MIGRATE_IMAGE ?? "linked-notes-migrate:release-candidate";
const platform = process.env.TARGET_PLATFORM ?? "linux/amd64";
if (!new Set(["linux/amd64", "linux/arm64"]).has(platform)) {
  throw new Error(`Unsupported TARGET_PLATFORM: ${platform}`);
}

const suffix =
  `${process.env.GITHUB_RUN_ID ?? process.pid}-${platform.split("/").at(-1)}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-");
const names = {
  network: `linked-notes-smoke-network-${suffix}`,
  database: `linked-notes-smoke-db-${suffix}`,
  app: `linked-notes-smoke-app-${suffix}`,
  migrate: `linked-notes-smoke-migrate-${suffix}`,
  databaseVolume: `linked-notes-smoke-postgres-${suffix}`,
  attachmentVolume: `linked-notes-smoke-attachments-${suffix}`,
};
const databaseUrl =
  "postgresql://linked_notes:release-smoke-password@db:5432/linked_notes?schema=public";

async function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    const timeout = options.timeoutMilliseconds
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMilliseconds)
      : null;
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0 || options.allowFailure) {
        resolve({ code: code ?? 1, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${program} ${args.join(" ")} exited ${code}\n${stdout}${stderr}`,
        ),
      );
    });
  });
}

const docker = (args, options) => command("docker", args, options);

async function dockerStart(container) {
  let firstError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await docker(["start", container], { timeoutMilliseconds: 10_000 });
      return;
    } catch (error) {
      firstError ??= error;
      const state = await docker(
        ["inspect", "--format", "{{.State.Running}}", container],
        { capture: true, allowFailure: true },
      );
      if (state.stdout.trim() === "true") return;
    }
  }
  throw firstError;
}

async function waitFor(label, check, timeoutMilliseconds = 120_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMilliseconds) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${label} did not become ready${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function appNode(source, environment = {}) {
  const environmentArgs = Object.entries(environment).flatMap(
    ([key, value]) => ["-e", `${key}=${value}`],
  );
  const wrapped = `const base = "http://127.0.0.1:3000"; (async () => { ${source} })().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });`;
  return docker(
    ["exec", ...environmentArgs, names.app, "node", "-e", wrapped],
    { capture: true },
  );
}

async function appJson(source, environment = {}) {
  const result = await appNode(source, environment);
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("The app smoke command returned no JSON");
  return JSON.parse(line);
}

async function startApp() {
  await docker([
    "create",
    "--name",
    names.app,
    "--platform",
    platform,
    "--network",
    names.network,
    "--read-only",
    "--init",
    "--tmpfs",
    "/tmp:size=256m,mode=1777",
    "--mount",
    `type=volume,source=${names.attachmentVolume},target=/data/attachments`,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    "ATTACHMENTS_DIR=/data/attachments",
    appImage,
  ]);
  await dockerStart(names.app);
  await waitFor(
    "release app",
    async () =>
      (
        await appNode(`
          const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(5_000) });
          if (!response.ok) process.exit(1);
          const payload = await response.json();
          if (payload.status !== "ok" || payload.database !== "reachable" || payload.attachments !== "writable") process.exit(1);
        `)
      ).code === 0,
    platform === "linux/arm64" ? 240_000 : 120_000,
  );
}

async function cleanup() {
  for (const container of [names.app, names.migrate, names.database]) {
    await docker(["rm", "-f", container], {
      capture: true,
      allowFailure: true,
    });
  }
  for (const volume of [names.attachmentVolume, names.databaseVolume]) {
    await docker(["volume", "rm", "-f", volume], {
      capture: true,
      allowFailure: true,
    });
  }
  await docker(["network", "rm", names.network], {
    capture: true,
    allowFailure: true,
  });
}

async function smoke() {
  await cleanup();
  await docker(["network", "create", "--internal", names.network]);
  await docker(["volume", "create", names.databaseVolume]);
  await docker(["volume", "create", names.attachmentVolume]);
  await docker([
    "create",
    "--name",
    names.database,
    "--network",
    names.network,
    "--network-alias",
    "db",
    "-e",
    "POSTGRES_DB=linked_notes",
    "-e",
    "POSTGRES_USER=linked_notes",
    "-e",
    "POSTGRES_PASSWORD=release-smoke-password",
    "--mount",
    `type=volume,source=${names.databaseVolume},target=/var/lib/postgresql`,
    "postgres:18-alpine",
  ]);
  await dockerStart(names.database);
  await waitFor("PostgreSQL", async () => {
    const result = await docker(
      [
        "exec",
        names.database,
        "pg_isready",
        "-U",
        "linked_notes",
        "-d",
        "linked_notes",
      ],
      { capture: true, allowFailure: true },
    );
    return result.code === 0;
  });

  await docker([
    "create",
    "--name",
    names.migrate,
    "--platform",
    platform,
    "--network",
    names.network,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    migrateImage,
  ]);
  await dockerStart(names.migrate);
  await waitFor("migration container", async () => {
    const result = await docker(
      [
        "inspect",
        "--format",
        "{{.State.Status}} {{.State.ExitCode}}",
        names.migrate,
      ],
      { capture: true },
    );
    const state = result.stdout.trim();
    if (state === "exited 0") return true;
    if (state.startsWith("exited ")) {
      await docker(["logs", names.migrate], { allowFailure: true });
      throw new Error(`Migration container failed: ${state}`);
    }
    return false;
  });
  await docker(["rm", names.migrate]);
  await startApp();

  const created = await appJson(`
    const response = await fetch(base + "/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Release candidate persistence" }),
    });
    if (response.status !== 201) throw new Error("Note creation failed: " + response.status);
    console.log(JSON.stringify(await response.json()));
  `);
  const updated = await appJson(
    `
      const response = await fetch(base + "/api/notes/" + process.env.NOTE_ID, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: Number(process.env.NOTE_VERSION),
          title: "Release candidate persistence",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Persists through backup, restore, and restart." }] }] },
        }),
      });
      if (!response.ok) throw new Error("Note update failed: " + response.status);
      console.log(JSON.stringify(await response.json()));
    `,
    { NOTE_ID: created.id, NOTE_VERSION: String(created.optimisticVersion) },
  );

  const attachmentText = "release-candidate-attachment";
  const uploaded = await appJson(
    `
      const bytes = new TextEncoder().encode(process.env.ATTACHMENT_TEXT);
      const response = await fetch(base + "/api/notes/" + process.env.NOTE_ID + "/attachments?expectedVersion=" + process.env.NOTE_VERSION, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(bytes.byteLength),
          "X-Linked-Notes-Filename": encodeURIComponent("release-proof.txt"),
        },
        body: bytes,
      });
      if (response.status !== 201) throw new Error("Attachment upload failed: " + response.status);
      console.log(JSON.stringify(await response.json()));
    `,
    {
      NOTE_ID: created.id,
      NOTE_VERSION: String(updated.optimisticVersion),
      ATTACHMENT_TEXT: attachmentText,
    },
  );

  await appNode(
    `
      const response = await fetch(base + "/api/notes/" + process.env.NOTE_ID + "/export?format=pdf&backlinks=true", { signal: AbortSignal.timeout(180_000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || response.headers.get("content-type") !== "application/pdf" || new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") {
        throw new Error("PDF export verification failed: " + response.status);
      }
    `,
    { NOTE_ID: created.id },
  );

  const backup = await appJson(`
    const response = await fetch(base + "/api/backups", { signal: AbortSignal.timeout(180_000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("Backup generation failed: " + response.status);
    console.log(JSON.stringify({
      archive: Buffer.from(bytes).toString("base64"),
      checksum: response.headers.get("x-linked-notes-archive-sha256"),
    }));
  `);
  if (!/^[0-9a-f]{64}$/.test(backup.checksum)) {
    throw new Error("Backup response did not include a SHA-256 checksum");
  }

  const extra = await appJson(`
    const response = await fetch(base + "/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Removed by replace restore" }),
    });
    if (response.status !== 201) throw new Error("Restore fixture creation failed");
    console.log(JSON.stringify(await response.json()));
  `);
  await appNode(
    `
      const bytes = Buffer.from(process.env.BACKUP_BASE64, "base64");
      const response = await fetch(base + "/api/backups/restore?mode=replace&confirmation=REPLACE", {
        method: "POST",
        headers: { "Content-Type": "application/gzip", "Content-Length": String(bytes.byteLength) },
        body: bytes,
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error("Backup replace restore failed: " + response.status + " " + await response.text());
    `,
    { BACKUP_BASE64: backup.archive },
  );

  await appNode(
    `
      const note = await fetch(base + "/api/notes/" + process.env.NOTE_ID);
      const notePayload = await note.json();
      if (!note.ok || JSON.stringify(notePayload).includes("Persists through backup, restore, and restart.") === false) {
        throw new Error("Restored note was not preserved");
      }
      const removed = await fetch(base + "/api/notes/" + process.env.EXTRA_ID);
      if (removed.status !== 404) throw new Error("Replace restore retained post-backup data");
      const attachment = await fetch(base + "/api/attachments/" + process.env.ATTACHMENT_ID);
      if (!attachment.ok || await attachment.text() !== process.env.ATTACHMENT_TEXT) {
        throw new Error("Restored attachment bytes did not match");
      }
    `,
    {
      NOTE_ID: created.id,
      EXTRA_ID: extra.id,
      ATTACHMENT_ID: uploaded.attachment.id,
      ATTACHMENT_TEXT: attachmentText,
    },
  );

  await appNode(`
    let blocked = false;
    try {
      await fetch("http://192.0.2.1:81/", { signal: AbortSignal.timeout(3_000) });
    } catch {
      blocked = true;
    }
    if (!blocked) throw new Error("Outbound network probe unexpectedly succeeded");
  `);

  await docker(["rm", "-f", names.app]);
  await startApp();
  await appNode(
    `
      const note = await fetch(base + "/api/notes/" + process.env.NOTE_ID);
      const attachment = await fetch(base + "/api/attachments/" + process.env.ATTACHMENT_ID);
      if (!note.ok || !attachment.ok || await attachment.text() !== process.env.ATTACHMENT_TEXT) {
        throw new Error("Data did not persist through app-container replacement");
      }
    `,
    {
      NOTE_ID: created.id,
      ATTACHMENT_ID: uploaded.attachment.id,
      ATTACHMENT_TEXT: attachmentText,
    },
  );

  console.log(
    `Release image smoke passed for ${platform}: clean migration, health, PDF, backup/replace restore, attachment persistence, restart persistence, and denied outbound network`,
  );
}

try {
  await smoke();
} catch (error) {
  await docker(["logs", names.app], { capture: false, allowFailure: true });
  throw error;
} finally {
  await cleanup();
}
