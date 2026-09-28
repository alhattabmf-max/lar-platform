import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

const children = new Set();

function run(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function runPnpm(script, env) {
  return run("cmd.exe", ["/d", "/s", "/c", `pnpm.cmd run ${script}`], env);
}

function prefix(child, name) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
}

function waitForTunnel(child) {
  return new Promise((resolveUrl, reject) => {
    let buffer = "";
    const timeout = setTimeout(
      () => reject(new Error("The temporary preview URL was not created in time.")),
      60_000,
    );

    const read = (chunk) => {
      const content = chunk.toString();
      buffer = `${buffer}${content}`.slice(-20_000);
      const match = buffer.match(
        /https:\/\/[a-z0-9.-]+(?:localhost\.run|lhr\.life|lhr\.rocks)/i,
      );
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl(match[0]);
    };

    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The preview tunnel stopped early (${code ?? "unknown"}).`));
    });
  });
}

async function waitFor(url, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || response.status < 500) return;
    } catch {
      // The development servers are still compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  }
  throw new Error(`${label} did not become ready within two minutes.`);
}

function stop() {
  for (const child of children) child.kill();
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

const tunnel = run("ssh.exe", [
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ServerAliveInterval=30",
  "-o",
  "ExitOnForwardFailure=yes",
  "-R",
  "80:127.0.0.1:3001",
  "nokey@localhost.run",
]);
prefix(tunnel, "LINK");

try {
  const publicUrl = await waitForTunnel(tunnel);
  const sharedEnv = {
    ...process.env,
    CORS_ALLOWED_ORIGINS: `${publicUrl},http://localhost:3001`,
  };

  const api = runPnpm("dev:api", sharedEnv);
  const worker = runPnpm("dev:worker", sharedEnv);
  const web = runPnpm("dev:web", {
    ...sharedEnv,
    NEXT_PUBLIC_API_BASE_URL: "",
    INTERNAL_API_BASE_URL: "http://127.0.0.1:3000",
    PREVIEW_PROXY_API_URL: "http://127.0.0.1:3000",
  });

  prefix(api, "API");
  prefix(worker, "WORKER");
  prefix(web, "WEB");

  await Promise.all([
    waitFor("http://127.0.0.1:3000/health", "API"),
    waitFor("http://127.0.0.1:3001/ar-SA", "Web interface"),
  ]);

  writeFileSync(resolve(root, "PREVIEW_URL.txt"), `${publicUrl}/ar-SA\n`, "utf8");
  console.log("\n============================================================");
  console.log("LAR PREVIEW IS READY");
  console.log(`${publicUrl}/ar-SA`);
  console.log("Send this URL to Codex. Close with STOP_PREVIEW.cmd.");
  console.log("Use test data only while the temporary link is open.");
  console.log("============================================================\n");
} catch (error) {
  console.error(`[PREVIEW] ${error instanceof Error ? error.message : String(error)}`);
  stop();
  process.exit(1);
}
