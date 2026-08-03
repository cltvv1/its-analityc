import { promises as fs } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "win32") {
  console.log("Исправление vinext не требуется на этой операционной системе.");
  process.exit(0);
}

const targetPath = resolve(
  "node_modules/vinext/dist/server/static-file-cache.js",
);
const windowsImplementation =
  "relativePath: path.relative(base, batch[j]),";
const portableImplementation =
  'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';

let source;
try {
  source = await fs.readFile(targetPath, "utf8");
} catch (error) {
  console.error(
    `Не найден установленный vinext: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

if (source.includes(portableImplementation)) {
  console.log("Исправление статических файлов vinext уже установлено.");
  process.exit(0);
}

if (!source.includes(windowsImplementation)) {
  console.error(
    "Версия vinext изменилась: автоматическое исправление статических файлов неприменимо.",
  );
  process.exit(1);
}

const patched = source.replace(
  windowsImplementation,
  portableImplementation,
);
await fs.writeFile(targetPath, patched, "utf8");
console.log("Установлено исправление статических файлов vinext для Windows.");
