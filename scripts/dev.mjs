import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "bridge"], {
    shell: true,
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev:site"], {
    shell: true,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 100);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
