import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCashflow, applyPaymentShift, buildReport, parseCsv } from "./logic.js";
import { readFile } from "node:fs/promises";

const csv = await readFile(new URL("./data/sample_cashflow.csv", import.meta.url), "utf8");
const transactions = parseCsv(csv);

test("учебный CSV содержит десять корректных операций", () => {
  assert.equal(transactions.length, 10);
  assert.equal(transactions.filter((item) => item.type === "outflow").length, 5);
});

test("базовый прогноз обнаруживает кассовый разрыв", () => {
  const result = analyzeCashflow(transactions, 1_200_000);
  assert.equal(result.minimumBalance, -550_000);
  assert.equal(result.minimumDate, "2026-12-13");
  assert.equal(result.gapDays, 2);
});

test("дебиторка и концентрация рассчитаны верно", () => {
  const result = analyzeCashflow(transactions, 1_200_000);
  assert.equal(result.overdueTotal, 480_000);
  assert.equal(result.topDebtor, "Альфа Ритейл");
  assert.equal(result.topDebtorShare, 62.5);
  assert.equal(result.aging["8–30 дней"], 300_000);
  assert.equal(result.aging["Более 30 дней"], 180_000);
});

test("перенос платежа устраняет кассовый разрыв", () => {
  const shifted = applyPaymentShift(transactions, "P005", "2026-12-16");
  const result = analyzeCashflow(shifted, 1_200_000);
  assert.equal(result.minimumBalance, 50_000);
  assert.equal(result.gapStart, null);
});

test("отчёт фиксирует решение и эффект", () => {
  const base = analyzeCashflow(transactions, 1_200_000);
  const scenario = analyzeCashflow(applyPaymentShift(transactions, "P005", "2026-12-16"), 1_200_000);
  const report = buildReport(base, scenario, { id: "P005", oldDate: "2026-12-13", newDate: "2026-12-16" });
  assert.match(report, /550 000 ₽/);
  assert.match(report, /разрыв устранён/);
  assert.match(report, /\+600 000 ₽/);
});

test("некорректные данные отклоняются", () => {
  assert.throws(() => analyzeCashflow(transactions, -1), /неотрицательным/);
  assert.throws(() => applyPaymentShift(transactions, "missing", "2026-12-16"), /не найден/);
  assert.throws(() => parseCsv("id,date\n1,2026-01-01"), /отсутствуют колонки/);
});
