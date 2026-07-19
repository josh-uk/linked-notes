import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
  return result.stdout.trim().split("\n").filter(Boolean);
}

const tracked = git("ls-files");
const failures = [];
const textFiles = tracked.filter((file) =>
  /(?:^|\/)(?:[^/]+\.(?:md|ya?ml|json|mjs|ts|tsx|css)|Dockerfile)$/.test(file),
);
const contents = new Map(
  await Promise.all(
    textFiles.map(async (file) => [file, await readFile(file, "utf8")]),
  ),
);

const prohibitedBranchReferences = [
  /refs\/heads\/main\b/,
  /\borigin\/main\b/,
  /branches:\s*\[?main\b/,
  /default branch (?:is|:)\s*`?main\b/i,
  /git (?:switch|checkout|pull|push)[^\n]*\bmain\b/,
];
for (const [file, content] of contents) {
  for (const pattern of prohibitedBranchReferences) {
    if (pattern.test(content)) {
      failures.push(`${file} contains a prohibited default-branch reference`);
      break;
    }
  }
}

for (const [file, content] of contents) {
  if (!file.startsWith("src/")) continue;
  const external = content.match(/https?:\/\/[A-Za-z0-9][^\s"'`)<]*/g) ?? [];
  for (const url of external) {
    failures.push(`${file} contains an external runtime URL: ${url}`);
  }
}

for (const file of tracked) {
  if (
    (file.startsWith(".env") && file !== ".env.example") ||
    /\.(?:linked-notes-backup\.tar\.gz|pem|p12|key)$/i.test(file) ||
    /(?:^|\/)(?:attachment_data|postgres_data)(?:\/|$)/.test(file)
  ) {
    failures.push(`Unsafe local/private artifact is tracked: ${file}`);
  }
}

const migrationFiles = [];
for (const entry of await readdir("prisma/migrations", { recursive: true })) {
  const file = path.join("prisma/migrations", entry);
  if ((await stat(file)).isFile()) migrationFiles.push(file);
}
const trackedMigrations = new Set(
  tracked.filter((file) => file.startsWith("prisma/migrations/")),
);
for (const file of migrationFiles) {
  if (!trackedMigrations.has(file))
    failures.push(`Untracked migration: ${file}`);
}

for (const [file, content] of contents) {
  if (!file.startsWith(".github/workflows/")) continue;
  for (const match of content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];
    if (action.startsWith("./")) continue;
    const reference = action.slice(action.lastIndexOf("@") + 1);
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      failures.push(`${file} has a mutable action reference: ${action}`);
    }
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (packageJson.version !== packageLock.version) {
  failures.push("package.json and package-lock.json versions differ");
}
if (packageLock.packages?.[""]?.version !== packageJson.version) {
  failures.push("package-lock root package version differs");
}
const changelog = await readFile("CHANGELOG.md", "utf8");
if (!changelog.includes(`## [${packageJson.version}] - `)) {
  failures.push(`CHANGELOG.md has no dated ${packageJson.version} entry`);
}

for (const [file, content] of contents) {
  if (!file.endsWith(".md")) continue;
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    try {
      await stat(resolved);
    } catch {
      failures.push(`${file} links to missing local target: ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Release audit failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Release audit passed: ${tracked.length} tracked files, immutable action pins, version/changelog alignment, migrations, documentation links, branch references, private artifacts, and runtime URLs`,
);
