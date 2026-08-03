import * as XLSX from "xlsx";
import { isTrackedAssignmentOffer } from "./atol-rules.mjs";

const REQUIRED_HEADERS = {
  serial: "серийный номер устройства",
  offer: "имя оффера",
  associatedAt: "дата ассоциации",
  engineer: "имя пользователя",
};

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е");
}

function cellText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  return String(value ?? "").trim();
}

function findHeaderRow(rows) {
  const required = Object.values(REQUIRED_HEADERS);
  const limit = Math.min(rows.length, 30);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = new Set((rows[rowIndex] ?? []).map(normalizeHeader));
    if (required.every((header) => headers.has(header))) return rowIndex;
  }
  return -1;
}

export function parseAssignmentWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В Excel-отчёте AC нет листов");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    throw new Error(
      'В Excel-отчёте AC не найдены столбцы "Имя оффера", "Дата ассоциации" и "Имя пользователя"',
    );
  }

  const headers = rows[headerRow].map(normalizeHeader);
  const column = Object.fromEntries(
    Object.entries(REQUIRED_HEADERS).map(([key, header]) => [
      key,
      headers.indexOf(header),
    ]),
  );

  const assignments = [];
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (!isTrackedAssignmentOffer(row[column.offer])) continue;

    const date = cellText(row[column.associatedAt]);
    const engineer = cellText(row[column.engineer]);
    if (!date || !engineer) continue;

    const serial = cellText(row[column.serial]);
    assignments.push({
      id: `${serial || rowIndex + 1}-${date}-${engineer}`,
      date,
      engineer,
      serial: serial || null,
    });
  }

  return {
    assignments,
    total: Math.max(0, rows.length - headerRow - 1),
  };
}
