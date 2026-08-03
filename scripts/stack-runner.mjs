import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

function loadLocalEnvironment() {
  const envPath = resolve(".env.local");
  if (existsSync(envPath)) loadEnvFile(envPath);
}

function childProcess(label, args, environment) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  child.label = label;
  return child;
}

export function runStack(mode) {
  loadLocalEnvironment();

  const production = mode === "production";
  const host = process.env.APP_HOST || "0.0.0.0";
  const port = process.env.PORT || "3000";
  const environment = {
    ...process.env,
    NODE_ENV: production ? "production" : "development",
  };
  const siteCommand = production ? "start" : "dev";
  const children = [
    childProcess(
      "АТОЛ-помощник",
      [resolve("scripts/atol-bridge.mjs")],
      environment,
    ),
    childProcess(
      "веб-приложение",
      [
        resolve("node_modules/vinext/dist/cli.js"),
        siteCommand,
        "--hostname",
        host,
        "--port",
        port,
      ],
      environment,
    ),
  ];

  let stopping = false;
  let exitCode = 0;

  function stop(nextExitCode = 0) {
    if (stopping) return;
    stopping = true;
    exitCode = nextExitCode;

    for (const child of children) {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }

    const forceTimer = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      }
    }, 5_000);
    forceTimer.unref();

    Promise.all(
      children.map(
        (child) =>
          new Promise((resolveExit) => {
            if (child.exitCode !== null) resolveExit();
            else child.once("exit", resolveExit);
          }),
      ),
    ).then(() => process.exit(exitCode));
  }

  for (const child of children) {
    child.on("error", (error) => {
      console.error(`${child.label} не запущен:`, error.message);
      stop(1);
    });
    child.on("exit", (code, signal) => {
      if (stopping) return;
      const reason = signal ? `сигнал ${signal}` : `код ${code ?? 1}`;
      console.error(`${child.label} остановлен (${reason})`);
      stop(code && code > 0 ? code : 1);
    });
  }

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  process.on("SIGHUP", () => stop(0));
}
