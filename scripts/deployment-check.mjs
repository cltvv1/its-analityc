import { constants, promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const envPath = resolve(".env.local");
if (existsSync(envPath)) loadEnvFile(envPath);

const errors = [];
const warnings = [];

function configured(name) {
  return Boolean(process.env[name]?.trim());
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    errors.push(
      `Требуется Node.js 22.13 или новее, установлена версия ${process.versions.node}`,
    );
  }
}

function checkEnvironment() {
  if (!existsSync(envPath)) {
    errors.push("Не найден файл .env.local");
    return;
  }
  for (const name of [
    "ATOL_LOGIN",
    "ATOL_PASSWORD",
    "ENGINEER_ADMIN_PASSWORD",
  ]) {
    if (!configured(name)) errors.push(`Не заполнена переменная ${name}`);
  }
  if (
    configured("ENGINEER_ADMIN_PASSWORD") &&
    process.env.ENGINEER_ADMIN_PASSWORD.length < 10
  ) {
    warnings.push(
      "ENGINEER_ADMIN_PASSWORD короче 10 символов — лучше использовать более длинный пароль",
    );
  }
  if (process.env.ATOL_HEADLESS === "false") {
    warnings.push(
      "ATOL_HEADLESS=false: на сервере без экрана рекомендуется значение true",
    );
  }
}

function browserCandidates() {
  return [
    process.env.ATOL_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
}

async function checkBrowser() {
  const browser = browserCandidates().find((candidate) =>
    existsSync(candidate),
  );
  if (!browser) {
    errors.push(
      "Не найден Chrome, Chromium или Edge; установите браузер либо задайте ATOL_BROWSER_PATH",
    );
  }
}

async function checkStateStorage() {
  const statePath = resolve(
    process.env.ITS_STATE_PATH || "server-data/runtime-state.json",
  );
  const stateDirectory = dirname(statePath);
  await fs.mkdir(stateDirectory, { recursive: true });
  try {
    await fs.access(stateDirectory, constants.R_OK | constants.W_OK);
  } catch {
    errors.push(`Нет доступа на чтение и запись к ${stateDirectory}`);
  }

  if (!existsSync(statePath)) {
    warnings.push(
      "Файл состояния отсутствует: при первом запуске история и распределение инженеров будут пустыми",
    );
    return;
  }

  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!state?.syncedData) {
      warnings.push("В файле состояния пока нет результатов синхронизации");
    }
  } catch {
    errors.push(`Файл состояния повреждён или не является JSON: ${statePath}`);
  }
}

async function checkBuild() {
  if (!existsSync(resolve("dist"))) {
    errors.push("Не найдена production-сборка; выполните npm run build");
  }
}

checkNodeVersion();
checkEnvironment();
await checkBrowser();
await checkStateStorage();
await checkBuild();

for (const warning of warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
for (const error of errors) console.error(`ОШИБКА: ${error}`);

if (errors.length) {
  console.error(`Проверка сервера не пройдена: ошибок ${errors.length}`);
  process.exitCode = 1;
} else {
  console.log(
    `Сервер готов к запуску${
      warnings.length ? `, предупреждений: ${warnings.length}` : ""
    }.`,
  );
}
