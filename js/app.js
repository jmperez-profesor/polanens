import { db } from "./db.js";
import { seedAugustData } from "./seed.js";

const state = {
  settings: null,
  drivers: [],
  kids: [],
  sessions: [],
  trips: [],
  activeTab: "calendar",
  editingTripId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const weekJsToIso = (d) => (d === 0 ? 7 : d);

function esc(str = "") {
  return str.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function monthParts(month) {
  const [year, mm] = month.split("-").map(Number);
  return { year, month: mm };
}

function startEndForMonth(month) {
  const { year, month: mm } = monthParts(month);
  const start = new Date(year, mm - 1, 1);
  const end = new Date(year, mm, 0);
  return { start, end };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function addMonths(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function tripTypeLabel(type) {
  if (type === "ida") return "solo ida";
  if (type === "vuelta") return "solo vuelta";
  return "ida y vuelta";
}

function kidStatusBadge(status) {
  if (status === "si_esta") return '<span class="badge cond">⚠️ si está</span>';
  if (status === "no_va") return '<span class="badge out">✖ no va</span>';
  return '<span class="badge">✓ confirmada</span>';
}

function inVacation(driverId, date) {
  return (state.settings.vacations || []).find((v) => v.driverId === driverId && date >= v.startDate && date <= v.endDate);
}

async function loadState() {
  state.settings = await db.getSettings();
  state.drivers = await db.getAll("drivers");
  state.kids = await db.getAll("kids");
  state.sessions = await db.getAll("sessions");
  state.trips = await db.getAll("trips");
}

function getMonthData(month) {
  const sessions = state.sessions.filter((s) => s.date.startsWith(month));
  const sessionMap = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const trips = state.trips.filter((t) => sessionMap[t.sessionId]);
  return { sessions, trips, sessionMap };
}

function driverById(id) {
  return state.drivers.find((d) => d.id === id);
}

function kidById(id) {
  return state.kids.find((k) => k.id === id);
}

function buildSessionOptions() {
  const month = state.settings.activeMonth;
  const { sessions } = getMonthData(month);
  const options = sessions
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .map(
      (s) =>
        `<option value="${s.id}">${s.date} · ${s.startTime}-${s.endTime} · ${esc(s.venue)} (${s.type})</option>`
    )
    .join("");
  $("#trip-session").innerHTML = `<option value="">Selecciona entrenamiento</option><option value="__new__">+ Crear nuevo</option>${options}`;
}

function buildTripExistingOptions() {
  const { trips, sessionMap } = getMonthData(state.settings.activeMonth);
  const options = trips
    .sort((a, b) => {
      const sa = sessionMap[a.sessionId];
      const sb = sessionMap[b.sessionId];
      return `${sa?.date || ""}${sa?.startTime || ""}`.localeCompare(`${sb?.date || ""}${sb?.startTime || ""}`);
    })
    .map((t) => {
      const s = sessionMap[t.sessionId];
      const d = driverById(t.driverId);
      return `<option value="${t.id}">${s?.date || ""} · ${d?.name || "—"} · ${tripTypeLabel(t.tripType)}</option>`;
    })
    .join("");
  $("#trip-existing").innerHTML = `<option value="">Nuevo viaje</option>${options}`;
}

function renderKidPicker() {
  $("#trip-kids").innerHTML = state.kids
    .filter((k) => k.active)
    .map(
      (k) => `
      <div class="kid-row">
        <label><input type="checkbox" data-kid-check="${k.id}" checked /> ${esc(k.name)}</label>
        <select data-kid-status="${k.id}">
          <option value="confirmada">confirmada</option>
          <option value="si_esta">si está</option>
          <option value="no_va">no va</option>
        </select>
      </div>
    `
    )
    .join("");
}

function renderTopBindings() {
  $("#active-month").value = state.settings.activeMonth;
  document.body.classList.toggle("dark", !!state.settings.darkMode);
}

function renderCalendar() {
  const month = state.settings.activeMonth;
  const { sessions, trips } = getMonthData(month);
  const sessionByDate = sessions.reduce((acc, s) => {
    acc[s.date] ||= [];
    acc[s.date].push(s);
    return acc;
  }, {});
  const tripsBySession = trips.reduce((acc, t) => {
    acc[t.sessionId] ||= [];
    acc[t.sessionId].push(t);
    return acc;
  }, {});

  const { start, end } = startEndForMonth(month);
  const firstIso = weekJsToIso(start.getDay());
  const daysInMonth = end.getDate();

  let html = "";
  dayNames.forEach((d) => {
    html += `<div class="day-name">${d}</div>`;
  });
  for (let i = 1; i < firstIso; i += 1) html += `<div class="day"></div>`;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = formatDate(new Date(start.getFullYear(), start.getMonth(), day));
    const daySessions = sessionByDate[date] || [];
    const holiday = (state.settings.holidays || []).find((h) => h.date === date);
    html += `<div class="day ${holiday ? "is-holiday" : ""}"><div class="num">${day}</div>`;
    if (holiday) html += `<div class="meta">${esc(holiday.note || "Festivo")}</div>`;
    daySessions
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .forEach((session) => {
        html += `<div class="session-card"><strong>${session.startTime}-${session.endTime}</strong> · ${esc(session.venue)}`;
        if (session.notes) html += `<div class="meta">${esc(session.notes)}</div>`;
        (tripsBySession[session.id] || []).forEach((trip) => {
          const driver = driverById(trip.driverId);
          const girls = trip.kids
            .filter((k) => k.status !== "no_va")
            .map((k) => `${esc(kidById(k.kidId)?.name || "—")} ${k.status === "si_esta" ? "⚠️" : ""}`)
            .join(", ");
          html += `
            <div class="trip-card" style="border-left-color:${driver?.color || "#555"}">
              <div><strong>${esc(driver?.name || "Sin conductor")}</strong> · ${tripTypeLabel(trip.tripType)}</div>
              <div class="meta">${girls}</div>
            </div>`;
        });
        html += "</div>";
      });
    html += "</div>";
  }
  $("#calendar-grid").innerHTML = html;
}

function renderDriverView() {
  const { sessions, trips, sessionMap } = getMonthData(state.settings.activeMonth);
  const activeFilter = $("#driver-filter")?.value || "all";
  const rows = state.drivers
    .filter((driver) => activeFilter === "all" || driver.id === activeFilter)
    .map((driver) => {
      const mine = trips.filter((t) => t.driverId === driver.id);
      const details = mine
        .map((t) => {
          const s = sessionMap[t.sessionId];
          const girls = t.kids
            .filter((k) => k.status !== "no_va")
            .map((k) => `${kidById(k.kidId)?.name || "—"}${k.status === "si_esta" ? " (si está)" : ""}`)
            .join(", ");
          return `${s?.date || ""} · ${tripTypeLabel(t.tripType)} · ${girls}`;
        })
        .join("<br>");
      return `<tr>
        <td><span class="driver-chip" style="background:${driver.color}"></span>${esc(driver.name)}</td>
        <td>${mine.length}</td>
        <td>${details || "—"}</td>
      </tr>`;
    })
    .join("");

  $("#drivers-summary").innerHTML = `<p><strong>${monthLabel(state.settings.activeMonth)}</strong> · ${sessions.length} entrenamientos</p>`;
  $("#drivers-list").innerHTML = `<table class="table">
    <thead><tr><th>Conductor/a</th><th>Total viajes</th><th>Detalle</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderKidView() {
  const { trips, sessionMap } = getMonthData(state.settings.activeMonth);
  const cards = state.kids
    .filter((k) => k.active)
    .map((kid) => {
      const mine = trips
        .map((t) => {
          const kidEntry = t.kids.find((kk) => kk.kidId === kid.id);
          if (!kidEntry || kidEntry.status === "no_va") return null;
          const session = sessionMap[t.sessionId];
          const driver = driverById(t.driverId);
          return {
            date: session?.date || "",
            row: `${session?.date || ""} · ${tripTypeLabel(t.tripType)} · ${driver?.name || "—"} ${
              kidEntry.status === "si_esta" ? "⚠️ si está" : "✓"
            }`,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));
      return `<div class="session-card">
        <h3>${esc(kid.name)}</h3>
        ${mine.map((m) => `<div>${esc(m.row)}</div>`).join("") || "<div>Sin viajes en el mes.</div>"}
      </div>`;
    })
    .join("");
  $("#kids-list").innerHTML = cards;
}

function renderStats() {
  const { trips } = getMonthData(state.settings.activeMonth);
  const driverRows = state.drivers
    .map((d) => {
      const mine = trips.filter((t) => t.driverId === d.id);
      return `<tr><td><span class="driver-chip" style="background:${d.color}"></span>${esc(d.name)}</td><td>${mine.length}</td></tr>`;
    })
    .join("");

  const kidRows = state.kids
    .filter((k) => k.active)
    .map((k) => {
      const total = trips.reduce((sum, trip) => {
        const entry = trip.kids.find((kk) => kk.kidId === k.id);
        return entry && entry.status !== "no_va" ? sum + 1 : sum;
      }, 0);
      return `<tr><td>${esc(k.name)}</td><td>${total}</td></tr>`;
    })
    .join("");

  $("#stats-content").innerHTML = `
    <table class="table">
      <thead><tr><th>Conductor/a</th><th>Total viajes</th></tr></thead>
      <tbody>${driverRows}</tbody>
    </table>
    <br />
    <table class="table">
      <thead><tr><th>Niña</th><th>Total recogidas/entregas</th></tr></thead>
      <tbody>${kidRows}</tbody>
    </table>
  `;
}

function renderVacationList() {
  const items = (state.settings.vacations || [])
    .map((v) => {
      const driver = driverById(v.driverId);
      return `<div class="session-card">
        <strong>${esc(driver?.name || "Conductor/a")}</strong> · ${v.startDate} → ${v.endDate}
        ${v.note ? `<div>${esc(v.note)}</div>` : ""}
        <button class="btn ghost" data-del-vac="${v.id}">Eliminar</button>
      </div>`;
    })
    .join("");
  $("#vacations-list").innerHTML = items || `<p class="hint">Sin vacaciones registradas.</p>`;
}

function renderHolidayList() {
  const items = (state.settings.holidays || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (h) => `<div class="session-card">
      <strong>${h.date}</strong> ${h.note ? `· ${esc(h.note)}` : ""}
      <button class="btn ghost" data-del-holiday="${h.id}">Eliminar</button>
    </div>`
    )
    .join("");
  $("#holidays-list").innerHTML = items || `<p class="hint">Sin festivos registrados.</p>`;
}

function renderDriverSelectors() {
  const options = state.drivers
    .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
    .join("");
  $("#trip-driver").innerHTML = `<option value="">Selecciona</option>${options}`;
  $("#vac-driver").innerHTML = `<option value="">Selecciona</option>${options}`;
  $("#driver-filter").innerHTML = `<option value="all">Todos</option>${options}`;
}

function renderAll() {
  renderTopBindings();
  buildSessionOptions();
  buildTripExistingOptions();
  renderDriverSelectors();
  renderKidPicker();
  renderCalendar();
  renderDriverView();
  renderKidView();
  renderStats();
  renderVacationList();
  renderHolidayList();
}

function bindTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      $$(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === state.activeTab));
    });
  });
}

function bindInputs() {
  $("#active-month").addEventListener("change", async (e) => {
    await db.saveSettings({ activeMonth: e.target.value });
    await loadState();
    renderAll();
  });

  $("#toggle-dark").addEventListener("click", async () => {
    await db.saveSettings({ darkMode: !state.settings.darkMode });
    await loadState();
    renderAll();
  });

  $("#trip-session").addEventListener("change", (e) => {
    const showNew = e.target.value === "__new__";
    $$(".new-session-only").forEach((el) => el.classList.toggle("hidden", !showNew));
  });

  $("#trip-driver").addEventListener("change", checkTripWarning);
  $("#trip-session").addEventListener("change", checkTripWarning);
  $("#driver-filter").addEventListener("change", renderDriverView);
  $("#trip-existing").addEventListener("change", fillTripFormFromSelected);
}

function checkTripWarning() {
  const sessionId = $("#trip-session").value;
  const driverId = $("#trip-driver").value;
  if (!driverId) return;
  const warning = $("#trip-warning");
  warning.classList.add("hidden");
  let date = null;
  if (sessionId === "__new__") date = $("#new-session-date").value;
  else date = state.sessions.find((s) => s.id === sessionId)?.date;
  if (!date) return;
  const v = inVacation(driverId, date);
  if (v) {
    warning.textContent = "Este conductor está de vacaciones en esa fecha.";
    warning.classList.remove("hidden");
  }
}

async function handleTripSubmit(ev) {
  ev.preventDefault();
  let sessionId = $("#trip-session").value;
  if (!sessionId) return;

  if (sessionId === "__new__") {
    const s = {
      id: db.uid(),
      date: $("#new-session-date").value,
      startTime: $("#new-session-start").value,
      endTime: $("#new-session-end").value,
      venue: $("#new-session-venue").value,
      type: $("#new-session-type").value,
      notes: $("#new-session-notes").value.trim(),
    };
    if (!s.date || !s.startTime || !s.endTime) return;
    await db.put("sessions", s);
    sessionId = s.id;
  }

  const driverId = $("#trip-driver").value;
  if (!driverId) return;

  const session = (await db.getAll("sessions")).find((s) => s.id === sessionId);
  const v = inVacation(driverId, session.date);
  if (v) {
    alert("No se puede asignar: conductor en vacaciones.");
    return;
  }

  const kids = state.kids
    .filter((k) => k.active)
    .map((k) => {
      const checked = $(`[data-kid-check="${k.id}"]`)?.checked;
      const status = $(`[data-kid-status="${k.id}"]`)?.value || "confirmada";
      if (!checked) return { kidId: k.id, status: "no_va" };
      return { kidId: k.id, status };
    });

  await db.put("trips", {
    id: state.editingTripId || db.uid(),
    sessionId,
    driverId,
    tripType: $("#trip-type").value,
    kids,
    pickupTime: $("#trip-pickup").value,
    dropoffTime: $("#trip-dropoff").value,
    notes: $("#trip-notes").value.trim(),
  });

  ev.target.reset();
  state.editingTripId = null;
  $$(".new-session-only").forEach((el) => el.classList.add("hidden"));
  await loadState();
  renderAll();
}

function parseSessionLine(line, activeMonth) {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  let [dateRaw, startTime, endTime, venue, type, notes] = parts;
  if (!dateRaw.includes("-")) {
    const day = Number(dateRaw);
    if (!Number.isFinite(day)) return null;
    dateRaw = `${activeMonth}-${String(day).padStart(2, "0")}`;
  }
  return {
    id: db.uid(),
    date: dateRaw,
    startTime,
    endTime,
    venue: venue || "Silvia Martínez",
    type: type || (startTime < "14:00" ? "mañana" : "tarde"),
    notes: notes || "",
  };
}

async function handleImportSessions(ev) {
  ev.preventDefault();
  const text = $("#sessions-input").value.trim();
  if (!text) return;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sessions = lines
    .map((line) => parseSessionLine(line, state.settings.activeMonth))
    .filter(Boolean);
  if (!sessions.length) return;
  await db.bulkPut("sessions", sessions);
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleVacationSubmit(ev) {
  ev.preventDefault();
  const driverId = $("#vac-driver").value;
  const startDate = $("#vac-start").value;
  const endDate = $("#vac-end").value;
  if (!driverId || !startDate || !endDate) return;
  const vacations = [
    ...(state.settings.vacations || []),
    {
      id: db.uid(),
      driverId,
      startDate,
      endDate,
      note: $("#vac-note").value.trim(),
    },
  ];
  await db.saveSettings({ vacations });
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleVacationDelete(ev) {
  const id = ev.target.dataset.delVac;
  if (!id) return;
  const vacations = (state.settings.vacations || []).filter((v) => v.id !== id);
  await db.saveSettings({ vacations });
  await loadState();
  renderAll();
}

async function handleHolidaySubmit(ev) {
  ev.preventDefault();
  const date = $("#holiday-date").value;
  if (!date) return;
  const holidays = [
    ...(state.settings.holidays || []),
    { id: db.uid(), date, note: $("#holiday-note").value.trim() },
  ];
  await db.saveSettings({ holidays });
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleHolidayDelete(ev) {
  const id = ev.target.dataset.delHoliday;
  if (!id) return;
  const holidays = (state.settings.holidays || []).filter((h) => h.id !== id);
  await db.saveSettings({ holidays });
  await loadState();
  renderAll();
}

async function exportJson() {
  const payload = await db.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reparto-volley-${state.settings.activeMonth}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(file) {
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  await db.importAll(payload);
  await loadState();
  renderAll();
}

function nthWeekdayOfMonth(year, month, isoWeekday, nth) {
  let count = 0;
  for (let day = 1; day <= 31; day += 1) {
    const dt = new Date(year, month - 1, day);
    if (dt.getMonth() !== month - 1) break;
    if (weekJsToIso(dt.getDay()) === isoWeekday) {
      count += 1;
      if (count === nth) return formatDate(dt);
    }
  }
  return null;
}

function occurrenceInMonth(date) {
  const d = new Date(date);
  const weekday = weekJsToIso(d.getDay());
  let count = 0;
  for (let day = 1; day <= d.getDate(); day += 1) {
    const dt = new Date(d.getFullYear(), d.getMonth(), day);
    if (weekJsToIso(dt.getDay()) === weekday) count += 1;
  }
  return { weekday, nth: count };
}

async function duplicatePreviousMonth() {
  const targetMonth = state.settings.activeMonth;
  const sourceMonth = addMonths(targetMonth, -1);
  const { year: targetYear, month: targetM } = monthParts(targetMonth);
  const sourceSessions = state.sessions.filter((s) => s.date.startsWith(sourceMonth));
  if (!sourceSessions.length) return;
  const existing = state.sessions.filter((s) => s.date.startsWith(targetMonth));
  const existingKey = new Set(existing.map((s) => `${s.date}|${s.startTime}|${s.endTime}|${s.type}`));

  const createdSessions = [];
  const sourceToTarget = new Map();

  for (const src of sourceSessions) {
    const { weekday, nth } = occurrenceInMonth(src.date);
    const targetDate = nthWeekdayOfMonth(targetYear, targetM, weekday, nth);
    if (!targetDate) continue;
    const key = `${targetDate}|${src.startTime}|${src.endTime}|${src.type}`;
    let target = existing.find((s) => `${s.date}|${s.startTime}|${s.endTime}|${s.type}` === key);
    if (!target && !existingKey.has(key)) {
      target = {
        id: db.uid(),
        date: targetDate,
        startTime: src.startTime,
        endTime: src.endTime,
        venue: src.venue,
        type: src.type,
        notes: src.notes,
      };
      createdSessions.push(target);
      existingKey.add(key);
    }
    if (target) sourceToTarget.set(src.id, target.id);
  }

  if (createdSessions.length) await db.bulkPut("sessions", createdSessions);
  await loadState();

  const sourceTrips = state.trips.filter((t) => sourceToTarget.has(t.sessionId));
  const copiedTrips = sourceTrips.map((t) => ({
    ...t,
    id: db.uid(),
    sessionId: sourceToTarget.get(t.sessionId),
  }));
  if (copiedTrips.length) await db.bulkPut("trips", copiedTrips);
  await loadState();
  renderAll();
}

function fillTripFormFromSelected() {
  const tripId = $("#trip-existing").value;
  if (!tripId) {
    state.editingTripId = null;
    $("#form-trip").reset();
    buildSessionOptions();
    return;
  }
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) return;
  state.editingTripId = trip.id;
  $("#trip-session").value = trip.sessionId;
  $("#trip-driver").value = trip.driverId;
  $("#trip-type").value = trip.tripType;
  $("#trip-pickup").value = trip.pickupTime || "";
  $("#trip-dropoff").value = trip.dropoffTime || "";
  $("#trip-notes").value = trip.notes || "";
  state.kids.forEach((k) => {
    const entry = trip.kids.find((kk) => kk.kidId === k.id);
    const check = $(`[data-kid-check="${k.id}"]`);
    const select = $(`[data-kid-status="${k.id}"]`);
    if (!check || !select) return;
    if (!entry || entry.status === "no_va") {
      check.checked = false;
      select.value = "no_va";
    } else {
      check.checked = true;
      select.value = entry.status;
    }
  });
  checkTripWarning();
}

function bindFormsAndButtons() {
  $("#form-trip").addEventListener("submit", handleTripSubmit);
  $("#form-import-sessions").addEventListener("submit", handleImportSessions);
  $("#form-vacation").addEventListener("submit", handleVacationSubmit);
  $("#form-holiday").addEventListener("submit", handleHolidaySubmit);
  $("#vacations-list").addEventListener("click", handleVacationDelete);
  $("#holidays-list").addEventListener("click", handleHolidayDelete);
  $("#export-json").addEventListener("click", exportJson);
  $("#import-json").addEventListener("change", (e) => importJson(e.target.files[0]));
  $("#duplicate-month").addEventListener("click", duplicatePreviousMonth);
  $("#load-seed").addEventListener("click", async () => {
    await seedAugustData({ force: true });
    await loadState();
    renderAll();
  });
}

async function initPWA() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.error("No se pudo registrar SW", err);
    }
  }
}

async function init() {
  await db.init();
  const settings = await db.getSettings();
  if (!settings?.seeded) await seedAugustData();
  await loadState();
  bindTabs();
  bindInputs();
  bindFormsAndButtons();
  renderAll();
  await initPWA();
}

init();
