import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const envPath = resolve(".env.local");
if (existsSync(envPath)) loadEnvFile(envPath);

const statePath = resolve(
  process.env.ITS_STATE_PATH || "server-data/runtime-state.json",
);
const backupDirectory = resolve(
  process.env.ITS_BACKUP_DIR || "server-backups",
);
const retention = Math.max(
  1,
  Number.parseInt(process.env.ITS_BACKUP_RETENTION || "30", 10) || 30,
);
const backupPrefix = `${basename(statePath, ".json")}.`;

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function validateStateFile() {
  const text = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(text);
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Файл состояния не содержит объект JSON");
  }
  return text;
}

async function removeExpiredBackups() {
  const entries = await fs.readdir(backupDirectory, {
    withFileTypes: true,
  });
  const backups = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(backupPrefix) &&
        entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();

  await Promise.all(
    backups
      .slice(retention)
      .map((name) => fs.rm(resolve(backupDirectory, name))),
  );
}

try {
  const state = await validateStateFile();
  await fs.mkdir(backupDirectory, { recursive: true });
  const backupPath = resolve(
    backupDirectory,
    `${backupPrefix}${timestamp()}.json`,
  );
  const temporaryPath = `${backupPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, state, {
    encoding: "utf8",
    flag: "wx",
  });
  await fs.rename(temporaryPath, backupPath);
  await removeExpiredBackups();
  console.log(`Резервная копия создана: ${backupPath}`);
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log(
      `Файл состояния пока не создан, резервное копирование пропущено: ${statePath}`,
    );
  } else {
    console.error(
      `Не удалось создать резервную копию: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
