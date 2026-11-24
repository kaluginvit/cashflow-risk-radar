const DAY = 86_400_000;

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV не содержит операций.");
  const headers = splitCsvLine(lines[0]);
  const required = ["id", "date", "type", "category", "counterparty", "amount", "status", "due_date", "description"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`В CSV отсутствуют колонки: ${missing.join(", ")}.`);

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    const amount = Number(row.amount);
    if (!row.id || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Некорректная операция в строке ${index + 2}.`);
    }
    if (!["inflow", "outflow"].includes(row.type)) throw new Error(`Неизвестный тип операции в строке ${index + 2}.`);
    return { ...row, amount };
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) {
      current += '"'; i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim()); current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

export function analyzeCashflow(transactions, openingBalance, asOf = "2026-12-01") {
  const start = Number(openingBalance);
  if (!Number.isFinite(start) || start < 0) throw new Error("Начальный остаток должен быть неотрицательным числом.");
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance = start;
  let minimumBalance = start;
  let minimumDate = asOf;
  let gapStart = null;
  let gapRecovery = null;
  const timeline = sorted.map((item) => {
    balance += item.type === "inflow" ? item.amount : -item.amount;
    if (balance < minimumBalance) { minimumBalance = balance; minimumDate = item.date; }
    if (balance < 0 && !gapStart) gapStart = item.date;
    if (balance >= 0 && gapStart && !gapRecovery) gapRecovery = item.date;
    return { ...item, balance };
  });
  const horizonEnd = sorted.at(-1)?.date ?? asOf;
  const gapEnd = gapStart ? (gapRecovery ?? horizonEnd) : null;
  const gapDays = gapStart ? Math.max(1, daysBetween(gapStart, gapEnd)) : 0;
  const overdue = sorted.filter((item) => item.type === "inflow" && item.status === "overdue");
  const overdueTotal = overdue.reduce((sum, item) => sum + item.amount, 0);
  const aging = { "0–7 дней": 0, "8–30 дней": 0, "Более 30 дней": 0 };
  const byCounterparty = {};
  for (const item of overdue) {
    const age = Math.max(0, daysBetween(item.due_date, asOf));
    const bucket = age <= 7 ? "0–7 дней" : age <= 30 ? "8–30 дней" : "Более 30 дней";
    aging[bucket] += item.amount;
    byCounterparty[item.counterparty] = (byCounterparty[item.counterparty] ?? 0) + item.amount;
  }
  const [topDebtor = "—", topDebt = 0] = Object.entries(byCounterparty).sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    openingBalance: start,
    closingBalance: balance,
    minimumBalance,
    minimumDate,
    gapStart,
    gapRecovery,
    gapDays,
    timeline,
    overdueTotal,
    aging,
    topDebtor,
    topDebt,
    topDebtorShare: overdueTotal ? topDebt / overdueTotal * 100 : 0,
  };
}

export function applyPaymentShift(transactions, transactionId, newDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw new Error("Укажите новую дату платежа.");
  const target = transactions.find((item) => item.id === transactionId && item.type === "outflow");
  if (!target) throw new Error("Исходящий платёж не найден.");
  return transactions.map((item) => item.id === transactionId ? { ...item, date: newDate } : { ...item });
}

export function buildReport(base, scenario, shift) {
  const rub = (value) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;
  const gap = base.minimumBalance < 0
    ? `кассовый разрыв ${rub(Math.abs(base.minimumBalance))} на ${base.minimumDate}`
    : "кассовый разрыв не обнаружен";
  const scenarioGap = scenario.minimumBalance < 0
    ? `остаётся разрыв ${rub(Math.abs(scenario.minimumBalance))}`
    : `разрыв устранён, минимальный остаток ${rub(scenario.minimumBalance)}`;
  return [
    "# CashFlow Radar — аналитический отчёт",
    "",
    `- Исходный прогноз: ${gap}.`,
    `- Просроченная дебиторка: ${rub(base.overdueTotal)}.`,
    `- Крупнейший должник: ${base.topDebtor} — ${base.topDebtorShare.toFixed(1)}%.`,
    `- Сценарий: платёж ${shift.id} перенесён с ${shift.oldDate} на ${shift.newDate}.`,
    `- Результат сценария: ${scenarioGap}.`,
    `- Изменение минимального остатка: +${rub(scenario.minimumBalance - base.minimumBalance)}.`,
    "",
    "Данные учебные и вымышленные. Отчёт не является бухгалтерской или инвестиционной рекомендацией.",
  ].join("\n");
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY);
}
