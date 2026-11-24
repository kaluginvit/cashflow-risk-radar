import { analyzeCashflow, applyPaymentShift, buildReport, parseCsv } from "./logic.js";

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const state = { transactions: [], base: null, scenario: null, report: "" };
const elements = {
  file: document.querySelector("#csv-file"), opening: document.querySelector("#opening-balance"),
  loadSample: document.querySelector("#load-sample"), analyze: document.querySelector("#analyze"),
  error: document.querySelector("#error"), workspace: document.querySelector("#workspace"),
  payment: document.querySelector("#payment"), newDate: document.querySelector("#new-date"),
  runScenario: document.querySelector("#run-scenario"), download: document.querySelector("#download-report"),
};

elements.loadSample.addEventListener("click", async () => {
  try {
    const response = await fetch("./data/sample_cashflow.csv");
    state.transactions = parseCsv(await response.text());
    elements.opening.value = "1200000";
    setFileStatus("Загружен учебный набор: 10 операций");
    populatePayments();
    analyze();
  } catch (error) { showError(error.message); }
});

elements.file.addEventListener("change", async () => {
  try {
    state.transactions = parseCsv(await elements.file.files[0].text());
    setFileStatus(`Загружено операций: ${state.transactions.length}`);
    populatePayments();
    showError("");
  } catch (error) { showError(error.message); }
});

elements.analyze.addEventListener("click", analyze);
elements.runScenario.addEventListener("click", () => {
  try {
    if (!state.base) throw new Error("Сначала выполните исходный анализ.");
    const original = state.transactions.find((item) => item.id === elements.payment.value);
    const shifted = applyPaymentShift(state.transactions, elements.payment.value, elements.newDate.value);
    state.scenario = analyzeCashflow(shifted, Number(elements.opening.value));
    state.report = buildReport(state.base, state.scenario, { id: original.id, oldDate: original.date, newDate: elements.newDate.value });
    renderScenario(original);
  } catch (error) { showError(error.message); }
});

elements.download.addEventListener("click", () => {
  if (!state.report) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([state.report], { type: "text/markdown;charset=utf-8" }));
  link.download = "cashflow-radar-report.md";
  link.click();
  URL.revokeObjectURL(link.href);
});

function analyze() {
  try {
    if (!state.transactions.length) throw new Error("Загрузите CSV или учебный набор.");
    state.base = analyzeCashflow(state.transactions, Number(elements.opening.value));
    state.scenario = null; state.report = "";
    renderBase();
    showError("");
  } catch (error) { showError(error.message); }
}

function populatePayments() {
  elements.payment.replaceChildren();
  state.transactions.filter((item) => item.type === "outflow").forEach((item) => {
    elements.payment.add(new Option(`${item.id} · ${item.counterparty} · ${rub.format(item.amount)}`, item.id));
  });
  if (state.transactions.some((item) => item.id === "P005")) elements.payment.value = "P005";
  elements.newDate.value = "2026-12-16";
}

function renderBase() {
  const data = state.base;
  elements.workspace.hidden = false;
  setText("min-balance", rub.format(data.minimumBalance));
  setText("min-date", data.minimumDate);
  setText("gap", data.minimumBalance < 0 ? `${rub.format(Math.abs(data.minimumBalance))} · ${data.gapDays} дн.` : "Нет");
  setText("overdue", rub.format(data.overdueTotal));
  setText("debtor", `${data.topDebtor} · ${data.topDebtorShare.toFixed(1)}%`);
  renderChart(data.timeline, "#forecast-chart", "#ff6b57");
  renderAging(data.aging);
  renderTimeline(data.timeline);
  document.querySelector("#scenario-result").hidden = true;
  document.querySelector("#analysis-heading").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderScenario(original) {
  const data = state.scenario;
  document.querySelector("#scenario-result").hidden = false;
  setText("scenario-min", rub.format(data.minimumBalance));
  setText("scenario-delta", `+${rub.format(data.minimumBalance - state.base.minimumBalance)}`);
  setText("scenario-status", data.minimumBalance >= 0 ? "Кассовый разрыв устранён" : "Разрыв сохраняется");
  setText("scenario-description", `${original.counterparty}: платёж ${rub.format(original.amount)} перенесён с ${original.date} на ${elements.newDate.value}.`);
  renderChart(data.timeline, "#scenario-chart", "#b9ef4a");
  elements.download.disabled = false;
  document.querySelector("#scenario-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderChart(timeline, selector, color) {
  const svg = document.querySelector(selector);
  const width = 760, height = 250, pad = 36;
  const values = [Number(elements.opening.value), ...timeline.map((item) => item.balance)];
  const min = Math.min(0, ...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = pad + index * ((width - pad * 2) / (values.length - 1));
    const y = pad + (max - value) / range * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zeroY = pad + max / range * (height - pad * 2);
  svg.innerHTML = `<line x1="${pad}" y1="${zeroY}" x2="${width-pad}" y2="${zeroY}" class="zero"/><polyline points="${points}" style="stroke:${color}"/><text x="${pad}" y="${Math.max(18, zeroY-8)}">0 ₽</text>`;
}

function renderAging(aging) {
  const container = document.querySelector("#aging");
  container.replaceChildren(...Object.entries(aging).map(([label, value]) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${label}</span><strong>${rub.format(value)}</strong>`;
    return row;
  }));
}

function renderTimeline(timeline) {
  const body = document.querySelector("#timeline");
  body.replaceChildren(...timeline.map((item) => {
    const row = document.createElement("tr");
    row.className = item.balance < 0 ? "negative" : "";
    row.innerHTML = `<td>${item.date}</td><td>${item.counterparty}</td><td>${item.type === "inflow" ? "Поступление" : "Платёж"}</td><td>${item.type === "inflow" ? "+" : "−"}${rub.format(item.amount)}</td><td>${rub.format(item.balance)}</td>`;
    return row;
  }));
}

function setFileStatus(text) { setText("file-status", text); }
function setText(id, text) { document.querySelector(`#${id}`).textContent = text; }
function showError(message) { elements.error.textContent = message; }
