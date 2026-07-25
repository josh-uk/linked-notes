#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import TurndownService from "turndown";

const execFile = promisify(execFileCallback);
const MAX_NOTES = 10_000;
const MAX_NOTE_CHARACTERS = 2_000_000;
const outputArgument = process.argv[2];

if (process.platform !== "darwin") {
  fail("Apple Notes export is only available on macOS.");
}
if (!outputArgument || outputArgument === "--help" || outputArgument === "-h") {
  console.log(
    "Usage: npm run apple-notes:export -- /absolute/path/to/new-export-folder",
  );
  process.exit(outputArgument ? 0 : 1);
}

const outputRoot = path.resolve(outputArgument);
await assertEmptyDestination(outputRoot);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });

console.log("Reading Apple Notes. macOS may ask you to allow Terminal access.");
const { stdout } = await execFile(
  "/usr/bin/osascript",
  [
    "-l",
    "JavaScript",
    "-e",
    collectionScript(),
    "--",
    String(MAX_NOTES),
    String(MAX_NOTE_CHARACTERS),
  ],
  { maxBuffer: 512 * 1024 * 1024 },
);
const payload = JSON.parse(stdout);
const turndown = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
turndown.remove(["script", "style"]);

const report = {
  exportedAt: new Date().toISOString(),
  notesDiscovered: payload.notes.length,
  notesExported: 0,
  attachmentsSaved: 0,
  warnings: [...payload.warnings],
};

for (const [index, note] of payload.notes.entries()) {
  const directory = path.join(
    outputRoot,
    ...[note.account, ...note.folders].map((value) => safeName(value, 100)),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const suffix = createHash("sha256").update(note.id).digest("hex").slice(0, 8);
  const baseName = `${safeName(note.name || "Untitled Note", 140)}--${suffix}`;
  const attachmentDirectory = path.join(
    directory,
    ".apple-notes-attachments",
    baseName,
  );
  const attachmentLines = [];

  for (const [attachmentIndex, attachment] of note.attachments.entries()) {
    const attachmentName = `${String(attachmentIndex + 1).padStart(3, "0")}-${safeName(
      attachment.name || "Attachment",
      140,
    )}`;
    const destination = path.join(attachmentDirectory, attachmentName);
    await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
    try {
      await saveAttachment(attachment.id, destination);
      report.attachmentsSaved += 1;
      attachmentLines.push(
        `- \`.apple-notes-attachments/${baseName}/${attachmentName}\``,
      );
    } catch {
      report.warnings.push({
        noteId: note.id,
        note: note.name,
        attachment: attachment.name,
        message:
          "Apple Notes did not allow this attachment type to be saved. Maps and webpage previews commonly have this limitation.",
      });
    }
  }

  let markdown = "";
  try {
    markdown = turndown.turndown(note.body || "");
  } catch {
    markdown = note.plaintext || "";
    report.warnings.push({
      noteId: note.id,
      note: note.name,
      message: "HTML conversion failed, so plain text was used.",
    });
  }
  if (note.locked) {
    report.warnings.push({
      noteId: note.id,
      note: note.name,
      message:
        "This note is password protected. Unlock it in Apple Notes and export again if its content is missing.",
    });
  }
  if (note.truncated) {
    report.warnings.push({
      noteId: note.id,
      note: note.name,
      message: `The note exceeded ${MAX_NOTE_CHARACTERS.toLocaleString()} characters and was truncated.`,
    });
  }

  const sections = [
    "---",
    "linked-notes-source: apple-notes",
    `linked-notes-source-id: ${JSON.stringify(note.id)}`,
    `created: ${note.createdAt ?? ""}`,
    `updated: ${note.updatedAt ?? ""}`,
    "---",
    "",
    `# ${note.name || "Untitled Note"}`,
    "",
    markdown.trim(),
  ];
  if (attachmentLines.length) {
    sections.push("", "## Apple Notes attachments", "", ...attachmentLines);
  }
  await writeFile(
    path.join(directory, `${baseName}.md`),
    `${sections.join("\n").trim()}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  report.notesExported += 1;
  if ((index + 1) % 100 === 0) {
    console.log(`Exported ${index + 1} of ${payload.notes.length} notes…`);
  }
}

await writeFile(
  path.join(outputRoot, "apple-notes-import-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600, flag: "wx" },
);
console.log(
  `Exported ${report.notesExported} notes and ${report.attachmentsSaved} attachments to ${outputRoot}`,
);
if (report.warnings.length) {
  console.log(
    `${report.warnings.length} warning(s) are recorded in apple-notes-import-report.json.`,
  );
}

async function assertEmptyDestination(destination) {
  try {
    await access(destination);
    const entries = await readdir(destination);
    if (entries.length) {
      fail("The destination must be a new or empty folder.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function saveAttachment(id, destination) {
  await execFile(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      `function run(argv) {
        const notes = Application("Notes");
        const matches = notes.attachments.whose({ id: argv[0] })();
        if (!matches.length) throw new Error("Attachment not found");
        notes.save(matches[0], { in: Path(argv[1]) });
        return "saved";
      }`,
      "--",
      id,
      destination,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

function collectionScript() {
  return String.raw`
function run(argv) {
  const app = Application("Notes");
  const maximumNotes = Number(argv[0]);
  const maximumCharacters = Number(argv[1]);
  const result = { notes: [], warnings: [] };
  const seenNoteIds = new Set();
  let count = 0;

  function value(getter, fallback) {
    try {
      const output = getter();
      return output == null ? fallback : output;
    } catch (_) {
      return fallback;
    }
  }

  function iso(getter) {
    const date = value(getter, null);
    if (!date) return null;
    try { return new Date(date).toISOString(); } catch (_) { return null; }
  }

  function visitFolders(folders, accountName, parents) {
    for (const folder of folders) {
      const folderName = String(value(() => folder.name(), "Untitled Folder"));
      visitNotes(value(() => folder.notes(), []), accountName, parents.concat([folderName]));
      visitFolders(value(() => folder.folders(), []), accountName, parents.concat([folderName]));
    }
  }

  function visitNotes(notes, accountName, folders) {
    for (const note of notes) {
      if (count >= maximumNotes) return;
      count += 1;
      const id = String(value(() => note.id(), "apple-note-" + count));
      if (seenNoteIds.has(id)) {
        count -= 1;
        continue;
      }
      seenNoteIds.add(id);
      const name = String(value(() => note.name(), "Untitled Note"));
      let body = String(value(() => note.body(), ""));
      let plaintext = String(value(() => note.plaintext(), ""));
      const truncated = body.length > maximumCharacters || plaintext.length > maximumCharacters;
      body = body.slice(0, maximumCharacters);
      plaintext = plaintext.slice(0, maximumCharacters);
      const attachments = value(() => note.attachments(), []).map((attachment) => ({
        id: String(value(() => attachment.id(), "")),
        name: String(value(() => attachment.name(), "Attachment"))
      })).filter((attachment) => attachment.id);
      result.notes.push({
        id,
        name,
        account: accountName,
        folders,
        body,
        plaintext,
        createdAt: iso(() => note.creationDate()),
        updatedAt: iso(() => note.modificationDate()),
        locked: Boolean(value(() => note.passwordProtected(), false)),
        shared: Boolean(value(() => note.shared(), false)),
        truncated,
        attachments
      });
    }
  }

  for (const account of app.accounts()) {
    if (count >= maximumNotes) break;
    const accountName = String(value(() => account.name(), "Apple Notes"));
    visitFolders(value(() => account.folders(), []), accountName, []);
    visitNotes(value(() => account.notes(), []), accountName, []);
  }
  if (count >= maximumNotes) {
    result.warnings.push({ message: "The export stopped at the configured note limit." });
  }
  return JSON.stringify(result);
}`;
}

function safeName(value, maximum) {
  return (
    String(value)
      .normalize("NFC")
      .replaceAll(/[/\\:\u0000-\u001f\u007f]/g, "-")
      .replaceAll(/^\.+|\.+$/g, "")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, maximum) || "Untitled"
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
