import { db } from "./db.js";
import { seedAugustData } from "./seed.js";
import { supabase } from "./supabase-client.js";

const APP_VERSION = "v1.1.0";

const state = {
  settings: null,
  drivers: [],
  kids: [],
  sessions: [],
  trips: [],
  activeTab: "calendar",
  editingTripId: null,
  editingSessionId: null,
  editingSessionModalId: null,
  editingTripModalId: null,
};

const REMOTE_TABLES = ["drivers", "kids", "sessions", "trips", "settings"];

function isSupabaseConfigured() {
  try {
    const url = supabase?.supabaseUrl || "";
    const key = supabase?.supabaseKey || "";
    if (!url || !key) return false;
    if (url.includes("TU-PROYECTO") || key.includes("TU_ANON_KEY")) return false;
    return true;
  } catch {
    return false;
  }
}

let remoteReady = false;
let realtimeChannel = null;
let realtimeRefreshTimer = null;

const dataApi = {
  uid: db.uid,

  async init() {
    await db.init();
    if (!isSupabaseConfigured()) return;
    const { error } = await supabase.from("settings").select("id").limit(1);
    remoteReady = !error;
  },

  async getAll(store) {
    if (!remoteReady || !REMOTE_TABLES.includes(store)) return db.getAll(store);
    const { data, error } = await supabase.from(store).select("*");
    if (error) return db.getAll(store);
    await db.clear(store);
    if (data.length) await db.bulkPut(store, data);
    return data;
  },

  async getSettings() {
    if (!remoteReady) return db.getSettings();
    const { data, error } = await supabase.from("settings").select("*").eq("id", "main").maybeSingle();
    if (error) return db.getSettings();
    if (!data) {
      const local = (await db.getSettings()) || {
        id: "main",
        activeSeason: "2026-2027",
        activeMonth: "2026-08",
        vacations: [],
        holidays: [],
        darkMode: false,
        seeded: false,
      };

      function scheduleRealtimeRefresh() {
        if (!remoteReady) return;
        if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = setTimeout(async () => {
          await loadState();
          renderAll();
        }, 120);
      }
      const { data: created } = await supabase.from("settings").upsert(local).select().single();
      await db.put("settings", created || local);
      return created || local;
    }
    await db.put("settings", data);
    return data;
  },

  async saveSettings(patch) {
    const current = (await this.getSettings()) || { id: "main" };
    const next = { ...current, ...patch, id: "main" };
    if (remoteReady) {
      const { data, error } = await supabase.from("settings").upsert(next).select().single();
      if (!error && data) {
        await db.put("settings", data);
        return data;
      }
    }
    return db.saveSettings(patch);
  },

  async put(store, value) {
    const next = value?.id ? value : { ...value, id: this.uid() };
    if (remoteReady && REMOTE_TABLES.includes(store)) {
      const { data, error } = await supabase.from(store).upsert(next).select().single();
      if (!error && data) {
        await db.put(store, data);
        return data;
      }
    }
    return db.put(store, next);
  },

  async bulkPut(store, values) {
    const nextValues = values.map((v) => (v?.id ? v : { ...v, id: this.uid() }));
    if (remoteReady && REMOTE_TABLES.includes(store)) {
      const { error } = await supabase.from(store).upsert(nextValues);
      if (!error) {
        await db.clear(store);
        if (nextValues.length) await db.bulkPut(store, nextValues);
        return;
      }
    }
    return db.bulkPut(store, nextValues);
  },

  async delete(store, id) {
    if (remoteReady && REMOTE_TABLES.includes(store)) {
      const { error } = await supabase.from(store).delete().eq("id", id);
      if (!error) {
        await db.delete(store, id);
        return;
      }
    }
    return db.delete(store, id);
  },

  async clear(store) {
    if (remoteReady && REMOTE_TABLES.includes(store)) {
      const { error } = await supabase.from(store).delete().not("id", "is", null);
      if (!error) {
        await db.clear(store);
        return;
      }
    }
    return db.clear(store);
  },

  async exportAll() {
    const payload = {};
    for (const store of REMOTE_TABLES) payload[store] = await this.getAll(store);
    return payload;
  },

  async importAll(payload) {
    for (const store of REMOTE_TABLES) {
      if (!Array.isArray(payload[store])) continue;
      await this.clear(store);
      await this.bulkPut(store, payload[store]);
    }
  },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const weekJsToIso = (d) => (d === 0 ? 7 : d);

function esc(str = "") {
  return str.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function normalizeName(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

function currentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function weekStart(date) {
  const d = new Date(date);
  const iso = weekJsToIso(d.getDay());
  d.setDate(d.getDate() - iso + 1);
  d.setHours(0, 0, 0, 0);
  return d;
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

function sessionCategoryLabel(session) {
  return session.category === "partido" ? "Partido" : "Entrenamiento";
}

function sessionSummary(session) {
  let info = `${session.date} · ${session.startTime}-${session.endTime} · ${esc(session.venue)} (${session.type})`;
  if (session.category === "partido") {
    const rival = session.opponent?.trim();
    if (rival && session.homeAway === "casa") info += ` · Polanens vs ${esc(rival)}`;
    else if (rival && session.homeAway === "fuera") info += ` · ${esc(rival)} vs Polanens`;
    else info += ` · Partido`;
  }
  return info;
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
  state.settings = await dataApi.getSettings();
  state.drivers = await dataApi.getAll("drivers");
  state.kids = await dataApi.getAll("kids");
  state.sessions = await dataApi.getAll("sessions");
  state.trips = await dataApi.getAll("trips");
}

async function ensureRamonDriver() {
  const exists = state.drivers.some((d) => normalizeName(d.name) === normalizeName("ramón"));
  if (exists) return;
  await dataApi.put("drivers", {
    id: dataApi.uid(),
    name: "Ramón",
    color: "#f97316",
    phone: "",
  });
  state.drivers = await dataApi.getAll("drivers");
}

async function ensureValentinaKid() {
  const exists = state.kids.some((k) => normalizeName(k.name) === normalizeName("valentina"));
  if (exists) return;
  await dataApi.put("kids", {
    id: dataApi.uid(),
    name: "Valentina",
    active: true,
  });
  state.kids = await dataApi.getAll("kids");
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
    .map((s) => `<option value="${s.id}">${sessionSummary(s)}</option>`)
    .join("");
  $("#trip-session").innerHTML = `<option value="">Selecciona evento</option><option value="__new__">+ Crear nuevo</option>${options}`;
}

function buildEventExistingOptions() {
  const { sessions } = getMonthData(state.settings.activeMonth);
  const options = sessions
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .map((s) => `<option value="${s.id}">${sessionSummary(s)}</option>`)
    .join("");
  $("#event-existing").innerHTML = `<option value="">Nuevo evento</option>${options}`;
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

function renderModalKidPicker() {
  $("#modal-trip-kids").innerHTML = state.kids
    .filter((k) => k.active)
    .map(
      (k) => `
      <div class="kid-row">
        <label><input type="checkbox" data-modal-kid-check="${k.id}" checked /> ${esc(k.name)}</label>
        <select data-modal-kid-status="${k.id}">
          <option value="confirmada">confirmada</option>
          <option value="si_esta">si está</option>
          <option value="no_va">no va</option>
        </select>
      </div>
    `
    )
    .join("");
}

function buildModalTripOptions(sessionId) {
  const options = state.trips
    .filter((t) => t.sessionId === sessionId)
    .map((t) => {
      const d = driverById(t.driverId);
      return `<option value="${t.id}">${d?.name || "Sin conductor"} · ${tripTypeLabel(t.tripType)}</option>`;
    })
    .join("");
  $("#modal-trip-existing").innerHTML = `<option value="">Nuevo viaje para este evento</option>${options}`;
}

function renderModalTripDriverOptions() {
  const options = state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  $("#modal-trip-driver").innerHTML = `<option value="">Selecciona</option>${options}`;
}

function renderTopBindings() {
  $("#active-month").value = state.settings.activeMonth;
  document.body.classList.toggle("dark", !!state.settings.darkMode);
  $("#app-version").textContent = `Reparto Voleibol ${APP_VERSION}`;
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
  const currentMonth = currentMonthString();
  const now = new Date();
  const currentWeekStart = weekStart(now);

  let html = "";
  dayNames.forEach((d) => {
    html += `<div class="day-name">${d}</div>`;
  });
  for (let i = 1; i < firstIso; i += 1) html += `<div class="day"></div>`;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateObj = new Date(start.getFullYear(), start.getMonth(), day);
    const date = formatDate(dateObj);
    const daySessions = sessionByDate[date] || [];
    const holiday = (state.settings.holidays || []).find((h) => h.date === date);
    const classes = ["day"];
    if (holiday) classes.push("is-holiday");
    if (month === currentMonth) {
      const ws = weekStart(dateObj);
      if (ws.getTime() === currentWeekStart.getTime()) classes.push("is-current-week");
      else if (ws < currentWeekStart) classes.push("is-past-week");
    }
    html += `<div class="${classes.join(" ")}"><div class="num">${day}</div>`;
    if (holiday) html += `<div class="meta">${esc(holiday.note || "Festivo")}</div>`;
    daySessions
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .forEach((session) => {
        html += `<div class="session-card calendar-session-card" data-session-id="${session.id}"><strong>${session.startTime}-${session.endTime}</strong> · ${esc(session.venue)} <span class="badge">${sessionCategoryLabel(session)}</span>`;
        if (session.category === "partido") {
          const rival = session.opponent?.trim();
          if (rival && session.homeAway === "casa") html += `<div class="meta">🏐 Polanens vs ${esc(rival)}</div>`;
          else if (rival && session.homeAway === "fuera") html += `<div class="meta">🏐 ${esc(rival)} vs Polanens</div>`;
          else html += `<div class="meta">🏐 Partido</div>`;
        }
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

  $("#drivers-summary").innerHTML = `<p><strong>${monthLabel(state.settings.activeMonth)}</strong> · ${sessions.length} eventos</p>`;
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

function renderDriversAdmin() {
  const items = state.drivers
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((d) => {
      const totalTrips = state.trips.filter((t) => t.driverId === d.id).length;
      return `<div class="session-card">
        <strong><span class="driver-chip" style="background:${d.color}"></span>${esc(d.name)}</strong>
        ${d.phone ? ` · ${esc(d.phone)}` : ""}
        <div class="meta">Viajes totales: ${totalTrips}</div>
      </div>`;
    })
    .join("");
  $("#drivers-admin-list").innerHTML = items || `<p class="hint">Sin conductores.</p>`;
}

function renderKidsAdmin() {
  const items = state.kids
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((k) => {
      const tripsCount = state.trips.reduce((sum, trip) => {
        const entry = trip.kids.find((kk) => kk.kidId === k.id);
        return entry && entry.status !== "no_va" ? sum + 1 : sum;
      }, 0);
      return `<div class="session-card">
        <strong>${esc(k.name)}</strong>
        <div class="meta">Participaciones: ${tripsCount}</div>
        <button class="btn ghost" data-del-kid="${k.id}">Eliminar</button>
      </div>`;
    })
    .join("");
  $("#kids-admin-list").innerHTML = items || `<p class="hint">Sin niñas.</p>`;
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
  buildEventExistingOptions();
  buildTripExistingOptions();
  renderDriverSelectors();
  renderKidPicker();
  renderCalendar();
  renderDriverView();
  renderKidView();
  renderStats();
  renderVacationList();
  renderHolidayList();
  renderDriversAdmin();
  renderKidsAdmin();
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
    await dataApi.saveSettings({ activeMonth: e.target.value });
    await loadState();
    renderAll();
  });

  $("#toggle-dark").addEventListener("click", async () => {
    await dataApi.saveSettings({ darkMode: !state.settings.darkMode });
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
  $("#event-existing").addEventListener("change", fillEventFormFromSelected);
  $("#event-category").addEventListener("change", toggleMatchFields);
  $("#modal-event-category").addEventListener("change", toggleModalMatchFields);
  $("#calendar-grid").addEventListener("click", handleCalendarClick);
  $("#close-event-modal").addEventListener("click", closeEventModal);
  $("#event-modal").addEventListener("click", (e) => {
    if (e.target.id === "event-modal") closeEventModal();
  });
  $("#modal-trip-existing").addEventListener("change", fillModalTripFormFromSelected);
  $("#modal-trip-driver").addEventListener("change", checkModalTripWarning);
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
      id: dataApi.uid(),
      date: $("#new-session-date").value,
      startTime: $("#new-session-start").value,
      endTime: $("#new-session-end").value,
      venue: $("#new-session-venue").value,
      type: $("#new-session-type").value,
      notes: $("#new-session-notes").value.trim(),
      category: "entrenamiento",
      opponent: "",
      homeAway: "",
    };
    if (!s.date || !s.startTime || !s.endTime) return;
    await dataApi.put("sessions", s);
    sessionId = s.id;
  }

  const driverId = $("#trip-driver").value;
  if (!driverId) return;

  const session = (await dataApi.getAll("sessions")).find((s) => s.id === sessionId);
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

  await dataApi.put("trips", {
    id: state.editingTripId || dataApi.uid(),
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
  let [dateRaw, startTime, endTime, venue, type, notes, category, opponent, homeAway] = parts;
  if (!dateRaw.includes("-")) {
    const day = Number(dateRaw);
    if (!Number.isFinite(day)) return null;
    dateRaw = `${activeMonth}-${String(day).padStart(2, "0")}`;
  }
  return {
    id: dataApi.uid(),
    date: dateRaw,
    startTime,
    endTime,
    venue: venue || "Silvia Martínez",
    type: type || (startTime < "14:00" ? "mañana" : "tarde"),
    notes: notes || "",
    category: category || "entrenamiento",
    opponent: opponent || "",
    homeAway: homeAway || "",
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
  await dataApi.bulkPut("sessions", sessions);
  ev.target.reset();
  await loadState();
  renderAll();
}

function toggleMatchFields() {
  const isMatch = $("#event-category").value === "partido";
  $("#event-opponent").toggleAttribute("required", isMatch);
  $("#event-home-away").toggleAttribute("required", isMatch);
}

function toggleModalMatchFields() {
  const isMatch = $("#modal-event-category").value === "partido";
  $("#modal-event-opponent").toggleAttribute("required", isMatch);
  $("#modal-event-home-away").toggleAttribute("required", isMatch);
}

function checkModalTripWarning() {
  const driverId = $("#modal-trip-driver").value;
  const warning = $("#modal-trip-warning");
  warning.classList.add("hidden");
  if (!driverId || !state.editingSessionModalId) return;
  const session = state.sessions.find((s) => s.id === state.editingSessionModalId);
  if (!session) return;
  const v = inVacation(driverId, session.date);
  if (v) {
    warning.textContent = "Este conductor está de vacaciones en esa fecha.";
    warning.classList.remove("hidden");
  }
}

function fillEventFormFromSelected() {
  const eventId = $("#event-existing").value;
  if (!eventId) {
    state.editingSessionId = null;
    $("#form-event").reset();
    toggleMatchFields();
    return;
  }
  const session = state.sessions.find((s) => s.id === eventId);
  if (!session) return;
  state.editingSessionId = session.id;
  $("#event-date").value = session.date || "";
  $("#event-start").value = session.startTime || "";
  $("#event-end").value = session.endTime || "";
  $("#event-venue").value = session.venue || "Silvia Martínez";
  $("#event-type").value = session.type || "tarde";
  $("#event-category").value = session.category || "entrenamiento";
  $("#event-opponent").value = session.opponent || "";
  $("#event-home-away").value = session.homeAway || "";
  $("#event-notes").value = session.notes || "";
  toggleMatchFields();
}

async function handleEventSubmit(ev) {
  ev.preventDefault();
  const category = $("#event-category").value;
  const date = $("#event-date").value;
  if (!date) return;
  await dataApi.put("sessions", {
    id: state.editingSessionId || dataApi.uid(),
    date,
    startTime: $("#event-start").value,
    endTime: $("#event-end").value,
    venue: $("#event-venue").value,
    type: $("#event-type").value,
    category,
    opponent: category === "partido" ? $("#event-opponent").value.trim() : "",
    homeAway: category === "partido" ? $("#event-home-away").value : "",
    notes: $("#event-notes").value.trim(),
  });
  ev.target.reset();
  state.editingSessionId = null;
  await loadState();
  renderAll();
}

async function deleteSessionAndTrips(sessionId) {
  const allTrips = await dataApi.getAll("trips");
  const linkedTrips = allTrips.filter((t) => t.sessionId === sessionId);
  for (const trip of linkedTrips) await dataApi.delete("trips", trip.id);
  await dataApi.delete("sessions", sessionId);
}

async function handleDeleteEventFromForm() {
  const eventId = $("#event-existing").value;
  if (!eventId) {
    alert("Selecciona primero un evento existente para eliminar.");
    return;
  }
  const session = state.sessions.find((s) => s.id === eventId);
  const ok = confirm(`¿Eliminar el evento del ${session?.date || ""} y sus viajes asociados?`);
  if (!ok) return;
  await deleteSessionAndTrips(eventId);
  state.editingSessionId = null;
  $("#form-event").reset();
  await loadState();
  renderAll();
}

function openEventModal(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  state.editingSessionModalId = session.id;
  state.editingTripModalId = null;
  $("#modal-event-date").value = session.date || "";
  $("#modal-event-start").value = session.startTime || "";
  $("#modal-event-end").value = session.endTime || "";
  $("#modal-event-venue").value = session.venue || "Silvia Martínez";
  $("#modal-event-type").value = session.type || "tarde";
  $("#modal-event-category").value = session.category || "entrenamiento";
  $("#modal-event-opponent").value = session.opponent || "";
  $("#modal-event-home-away").value = session.homeAway || "";
  $("#modal-event-notes").value = session.notes || "";
  renderModalTripDriverOptions();
  renderModalKidPicker();
  buildModalTripOptions(session.id);
  $("#form-trip-modal").reset();
  $("#modal-trip-existing").value = "";
  $("#modal-trip-warning").classList.add("hidden");
  toggleModalMatchFields();
  $("#event-modal").classList.remove("hidden");
}

function closeEventModal() {
  state.editingSessionModalId = null;
  state.editingTripModalId = null;
  $("#form-event-modal").reset();
  $("#form-trip-modal").reset();
  $("#modal-trip-warning").classList.add("hidden");
  $("#event-modal").classList.add("hidden");
}

function handleCalendarClick(ev) {
  const card = ev.target.closest(".calendar-session-card");
  if (!card) return;
  const { sessionId } = card.dataset;
  if (!sessionId) return;
  openEventModal(sessionId);
}

async function handleEventModalSubmit(ev) {
  ev.preventDefault();
  if (!state.editingSessionModalId) return;
  const category = $("#modal-event-category").value;
  await dataApi.put("sessions", {
    id: state.editingSessionModalId,
    date: $("#modal-event-date").value,
    startTime: $("#modal-event-start").value,
    endTime: $("#modal-event-end").value,
    venue: $("#modal-event-venue").value,
    type: $("#modal-event-type").value,
    category,
    opponent: category === "partido" ? $("#modal-event-opponent").value.trim() : "",
    homeAway: category === "partido" ? $("#modal-event-home-away").value : "",
    notes: $("#modal-event-notes").value.trim(),
  });
  closeEventModal();
  await loadState();
  renderAll();
}

async function handleDeleteEventFromModal() {
  const sessionId = state.editingSessionModalId;
  if (!sessionId) return;
  const session = state.sessions.find((s) => s.id === sessionId);
  const ok = confirm(`¿Eliminar el evento del ${session?.date || ""} y sus viajes asociados?`);
  if (!ok) return;
  await deleteSessionAndTrips(sessionId);
  closeEventModal();
  await loadState();
  renderAll();
}

async function handleDeleteTripFromForm() {
  const tripId = $("#trip-existing").value;
  if (!tripId) {
    alert("Selecciona primero un viaje existente para eliminar.");
    return;
  }
  const ok = confirm("¿Eliminar este viaje?");
  if (!ok) return;
  await dataApi.delete("trips", tripId);
  state.editingTripId = null;
  $("#form-trip").reset();
  await loadState();
  renderAll();
}

function fillModalTripFormFromSelected() {
  const tripId = $("#modal-trip-existing").value;
  if (!tripId) {
    state.editingTripModalId = null;
    $("#form-trip-modal").reset();
    renderModalTripDriverOptions();
    renderModalKidPicker();
    checkModalTripWarning();
    return;
  }
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) return;
  state.editingTripModalId = trip.id;
  $("#modal-trip-driver").value = trip.driverId || "";
  $("#modal-trip-type").value = trip.tripType || "ida_y_vuelta";
  $("#modal-trip-pickup").value = trip.pickupTime || "";
  $("#modal-trip-dropoff").value = trip.dropoffTime || "";
  $("#modal-trip-notes").value = trip.notes || "";
  state.kids.forEach((k) => {
    const entry = trip.kids.find((kk) => kk.kidId === k.id);
    const check = $(`[data-modal-kid-check="${k.id}"]`);
    const select = $(`[data-modal-kid-status="${k.id}"]`);
    if (!check || !select) return;
    if (!entry || entry.status === "no_va") {
      check.checked = false;
      select.value = "no_va";
    } else {
      check.checked = true;
      select.value = entry.status;
    }
  });
  checkModalTripWarning();
}

async function handleTripModalSubmit(ev) {
  ev.preventDefault();
  if (!state.editingSessionModalId) return;
  const driverId = $("#modal-trip-driver").value;
  if (!driverId) return;
  const session = state.sessions.find((s) => s.id === state.editingSessionModalId);
  if (!session) return;
  const v = inVacation(driverId, session.date);
  if (v) {
    alert("No se puede asignar: conductor en vacaciones.");
    return;
  }
  const kids = state.kids
    .filter((k) => k.active)
    .map((k) => {
      const checked = $(`[data-modal-kid-check="${k.id}"]`)?.checked;
      const status = $(`[data-modal-kid-status="${k.id}"]`)?.value || "confirmada";
      if (!checked) return { kidId: k.id, status: "no_va" };
      return { kidId: k.id, status };
    });
  await dataApi.put("trips", {
    id: state.editingTripModalId || dataApi.uid(),
    sessionId: state.editingSessionModalId,
    driverId,
    tripType: $("#modal-trip-type").value,
    kids,
    pickupTime: $("#modal-trip-pickup").value,
    dropoffTime: $("#modal-trip-dropoff").value,
    notes: $("#modal-trip-notes").value.trim(),
  });
  await loadState();
  buildModalTripOptions(state.editingSessionModalId);
  state.editingTripModalId = null;
  $("#form-trip-modal").reset();
  renderModalTripDriverOptions();
  renderModalKidPicker();
  checkModalTripWarning();
  renderAll();
}

async function handleDeleteTripFromModal() {
  const tripId = $("#modal-trip-existing").value;
  if (!tripId || !state.editingSessionModalId) {
    alert("Selecciona primero un viaje existente para eliminar.");
    return;
  }
  const ok = confirm("¿Eliminar este viaje?");
  if (!ok) return;
  await dataApi.delete("trips", tripId);
  await loadState();
  buildModalTripOptions(state.editingSessionModalId);
  state.editingTripModalId = null;
  $("#form-trip-modal").reset();
  renderModalTripDriverOptions();
  renderModalKidPicker();
  checkModalTripWarning();
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
      id: dataApi.uid(),
      driverId,
      startDate,
      endDate,
      note: $("#vac-note").value.trim(),
    },
  ];
  await dataApi.saveSettings({ vacations });
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleVacationDelete(ev) {
  const id = ev.target.dataset.delVac;
  if (!id) return;
  const vacations = (state.settings.vacations || []).filter((v) => v.id !== id);
  await dataApi.saveSettings({ vacations });
  await loadState();
  renderAll();
}

async function handleHolidaySubmit(ev) {
  ev.preventDefault();
  const date = $("#holiday-date").value;
  if (!date) return;
  const holidays = [
    ...(state.settings.holidays || []),
    { id: dataApi.uid(), date, note: $("#holiday-note").value.trim() },
  ];
  await dataApi.saveSettings({ holidays });
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleHolidayDelete(ev) {
  const id = ev.target.dataset.delHoliday;
  if (!id) return;
  const holidays = (state.settings.holidays || []).filter((h) => h.id !== id);
  await dataApi.saveSettings({ holidays });
  await loadState();
  renderAll();
}

async function handleDriverSubmit(ev) {
  ev.preventDefault();
  const name = $("#driver-name").value.trim();
  if (!name) return;
  const exists = state.drivers.some((d) => normalizeName(d.name) === normalizeName(name));
  if (exists) {
    alert("Ese conductor ya existe.");
    return;
  }
  await dataApi.put("drivers", {
    id: dataApi.uid(),
    name,
    color: $("#driver-color").value || "#f97316",
    phone: $("#driver-phone").value.trim(),
  });
  ev.target.reset();
  $("#driver-color").value = "#f97316";
  await loadState();
  renderAll();
}

async function handleKidSubmit(ev) {
  ev.preventDefault();
  const name = $("#kid-name").value.trim();
  if (!name) return;
  const exists = state.kids.some((k) => normalizeName(k.name) === normalizeName(name));
  if (exists) {
    alert("Esa niña ya existe.");
    return;
  }
  await dataApi.put("kids", {
    id: dataApi.uid(),
    name,
    active: true,
  });
  ev.target.reset();
  await loadState();
  renderAll();
}

async function handleKidDelete(ev) {
  const id = ev.target.dataset.delKid;
  if (!id) return;
  const child = kidById(id);
  const ok = confirm(`¿Eliminar a ${child?.name || "esta niña"} del listado?`);
  if (!ok) return;
  const affectedTrips = state.trips.filter((trip) => trip.kids.some((k) => k.kidId === id));
  for (const trip of affectedTrips) {
    const nextKids = trip.kids.filter((k) => k.kidId !== id);
    await dataApi.put("trips", { ...trip, kids: nextKids });
  }
  await dataApi.delete("kids", id);
  await loadState();
  renderAll();
}

async function exportJson() {
  const payload = await dataApi.exportAll();
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
  await dataApi.importAll(payload);
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
        id: dataApi.uid(),
        date: targetDate,
        startTime: src.startTime,
        endTime: src.endTime,
        venue: src.venue,
        type: src.type,
        category: src.category || "entrenamiento",
        opponent: src.opponent || "",
        homeAway: src.homeAway || "",
        notes: src.notes,
      };
      createdSessions.push(target);
      existingKey.add(key);
    }
    if (target) sourceToTarget.set(src.id, target.id);
  }

  if (createdSessions.length) await dataApi.bulkPut("sessions", createdSessions);
  await loadState();

  const sourceTrips = state.trips.filter((t) => sourceToTarget.has(t.sessionId));
  const copiedTrips = sourceTrips.map((t) => ({
    ...t,
    id: dataApi.uid(),
    sessionId: sourceToTarget.get(t.sessionId),
  }));
  if (copiedTrips.length) await dataApi.bulkPut("trips", copiedTrips);
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
  $("#form-driver").addEventListener("submit", handleDriverSubmit);
  $("#form-kid").addEventListener("submit", handleKidSubmit);
  $("#form-trip").addEventListener("submit", handleTripSubmit);
  $("#delete-trip").addEventListener("click", handleDeleteTripFromForm);
  $("#form-trip-modal").addEventListener("submit", handleTripModalSubmit);
  $("#delete-trip-modal").addEventListener("click", handleDeleteTripFromModal);
  $("#form-import-sessions").addEventListener("submit", handleImportSessions);
  $("#form-event").addEventListener("submit", handleEventSubmit);
  $("#delete-event").addEventListener("click", handleDeleteEventFromForm);
  $("#form-event-modal").addEventListener("submit", handleEventModalSubmit);
  $("#delete-event-modal").addEventListener("click", handleDeleteEventFromModal);
  $("#form-vacation").addEventListener("submit", handleVacationSubmit);
  $("#form-holiday").addEventListener("submit", handleHolidaySubmit);
  $("#vacations-list").addEventListener("click", handleVacationDelete);
  $("#holidays-list").addEventListener("click", handleHolidayDelete);
  $("#kids-admin-list").addEventListener("click", handleKidDelete);
  $("#export-json").addEventListener("click", exportJson);
  $("#import-json").addEventListener("change", (e) => importJson(e.target.files[0]));
  $("#duplicate-month").addEventListener("click", duplicatePreviousMonth);
  $("#load-seed").addEventListener("click", async () => {
    await seedAugustData({ force: true, dataLayer: dataApi });
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

function initRealtime() {
  if (!remoteReady) return;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel("carpool-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, scheduleRealtimeRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "kids" }, scheduleRealtimeRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, scheduleRealtimeRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, scheduleRealtimeRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, scheduleRealtimeRefresh)
    .subscribe();
}

function bindRealtimeLifecycle() {
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !remoteReady) return;
    await loadState();
    renderAll();
  });
}

async function init() {
  await dataApi.init();
  const settings = await dataApi.getSettings();
  if (!settings?.seeded) await seedAugustData({ dataLayer: dataApi });
  await loadState();
  await ensureRamonDriver();
  await ensureValentinaKid();
  bindTabs();
  bindInputs();
  bindFormsAndButtons();
  bindRealtimeLifecycle();
  initRealtime();
  renderAll();
  toggleMatchFields();
  toggleModalMatchFields();
  await initPWA();
}

init();
