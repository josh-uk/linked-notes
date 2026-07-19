const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function smoke() {
  const health = await fetch(`${appUrl}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) throw new Error(`Health endpoint returned ${health.status}`);

  const payload = (await health.json()) as {
    status?: string;
    database?: string;
  };
  if (payload.status !== "ok" || payload.database !== "reachable") {
    throw new Error(`Unexpected health response: ${JSON.stringify(payload)}`);
  }

  const home = await fetch(appUrl, { signal: AbortSignal.timeout(10_000) });
  if (!home.ok || !(await home.text()).includes("Linked Notes")) {
    throw new Error("Home page smoke check failed");
  }

  console.log(`Linked Notes smoke check passed at ${appUrl}`);
}

smoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
