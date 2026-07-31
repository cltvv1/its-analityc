import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseAssignmentWorkbook } from "../scripts/assignment-export.mjs";

function workbookBuffer(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("assignment export uses association date and keeps only annual ITS", () => {
  const buffer = workbookBuffer([
    [
      "Серийный номер устройства",
      "Имя устройства",
      "Имя оффера",
      "Дата ассоциации",
      "Логин",
      "Имя пользователя",
      "IP адрес пользователя",
    ],
    [
      "001",
      "001",
      "АТОЛ Connect. ИТС на 1 год",
      "05.07.2026 09:15",
      "engineer-1",
      "Инженер Один",
      null,
    ],
    [
      "002",
      "002",
      "АТОЛ Connect. ИТС для Sigma на 12 месяцев",
      "06.07.2026 10:30",
      "engineer-2",
      "Инженер Два",
      null,
    ],
  ]);

  const result = parseAssignmentWorkbook(buffer);
  assert.equal(result.total, 2);
  assert.deepEqual(result.assignments, [
    {
      id: "001-05.07.2026 09:15-Инженер Один",
      date: "05.07.2026 09:15",
      engineer: "Инженер Один",
    },
  ]);
});

test("assignment export accepts real Excel dates", () => {
  const associatedAt = new Date(2026, 6, 30, 3, 38);
  const buffer = workbookBuffer([
    [
      "Серийный номер устройства",
      "Имя устройства",
      "Имя оффера",
      "Дата ассоциации",
      "Логин",
      "Имя пользователя",
      "IP адрес пользователя",
    ],
    [
      "003",
      "003",
      "АТОЛ Connect. ИТС на 1 год",
      associatedAt,
      "engineer-3",
      "Инженер Три",
      null,
    ],
  ]);

  const result = parseAssignmentWorkbook(buffer);
  assert.equal(result.assignments[0].date, "30.07.2026 03:38");
});
