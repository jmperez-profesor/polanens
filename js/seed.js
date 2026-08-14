import { db } from "./db.js";

const driverColors = {
  Vanesa: "#e11d48",
  Loli: "#2563eb",
  Sonia: "#16a34a",
  Carpena: "#9333ea",
  "Ramón": "#f97316",
};

function toDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createSession(date, startTime, endTime, venue, type, notes = "") {
  return { id: db.uid(), date, startTime, endTime, venue, type, notes };
}

function girlsWithStatus(names, conditionalNames = []) {
  return names.map((name) => ({
    kidName: name,
    status: conditionalNames.includes(name) ? "si_esta" : "confirmada",
  }));
}

export async function seedAugustData({ force = false } = {}) {
  const settings = await db.getSettings();
  if (settings?.seeded && !force) return false;

  await Promise.all(["drivers", "kids", "sessions", "trips"].map((store) => db.clear(store)));

  const drivers = ["Vanesa", "Loli", "Sonia", "Carpena", "Ramón"].map((name) => ({
    id: db.uid(),
    name,
    phone: "",
    color: driverColors[name],
  }));
  const driverByName = Object.fromEntries(drivers.map((d) => [d.name, d]));

  const kids = ["Aina", "Nerea", "Blanca", "Martina"].map((name) => ({
    id: db.uid(),
    name,
    active: true,
  }));
  const kidByName = Object.fromEntries(kids.map((k) => [k.name, k]));

  await db.bulkPut("drivers", drivers);
  await db.bulkPut("kids", kids);

  const year = 2026;
  const month = 8;
  const sessions = [];

  [10, 17, 24, 31].forEach((day) => {
    sessions.push(
      createSession(
        toDate(year, month, day),
        "11:00",
        day === 10 ? "13:30" : "13:00",
        "Silvia Martínez",
        "mañana",
        day === 10 ? "Presentación + mediciones" : ""
      )
    );
  });

  [
    3, 5, 7, 10, 12, 14, 17, 19, 21, 24, 26, 28, 31,
  ].forEach((day) => {
    const venue = day === 21 || day === 26 ? "Lara González" : "Silvia Martínez";
    sessions.push(createSession(toDate(year, month, day), "17:00", "19:00", venue, "tarde"));
  });

  await db.bulkPut("sessions", sessions);
  const byKey = Object.fromEntries(sessions.map((s) => [`${s.date}|${s.type}`, s]));

  const allGirls = ["Aina", "Nerea", "Blanca", "Martina"];
  const threeGirls = ["Nerea", "Blanca", "Martina"];

  const trips = [
    {
      driver: "Vanesa",
      session: byKey["2026-08-10|tarde"],
      tripType: "vuelta",
      pickupTime: "",
      dropoffTime: "19:00",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Vanesa",
      session: byKey["2026-08-12|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Vanesa",
      session: byKey["2026-08-14|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Vanesa",
      session: byKey["2026-08-26|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(threeGirls, ["Blanca"]),
      notes: "Blanca si está",
    },
    {
      driver: "Loli",
      session: byKey["2026-08-19|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(threeGirls, ["Blanca"]),
      notes: "",
    },
    {
      driver: "Loli",
      session: byKey["2026-08-21|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(threeGirls),
      notes: "",
    },
    {
      driver: "Loli",
      session: byKey["2026-08-24|mañana"],
      tripType: "ida",
      pickupTime: "11:00",
      dropoffTime: "",
      girls: girlsWithStatus(threeGirls),
      notes: "",
    },
    {
      driver: "Loli",
      session: byKey["2026-08-28|tarde"],
      tripType: "ida_y_vuelta",
      pickupTime: "17:00",
      dropoffTime: "19:00",
      girls: girlsWithStatus(threeGirls),
      notes: "",
    },
    {
      driver: "Sonia",
      session: byKey["2026-08-17|tarde"],
      tripType: "vuelta",
      pickupTime: "",
      dropoffTime: "19:00",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Sonia",
      session: byKey["2026-08-24|tarde"],
      tripType: "vuelta",
      pickupTime: "",
      dropoffTime: "19:00",
      girls: girlsWithStatus(threeGirls),
      notes: "",
    },
    {
      driver: "Sonia",
      session: byKey["2026-08-31|tarde"],
      tripType: "vuelta",
      pickupTime: "",
      dropoffTime: "19:00",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Carpena",
      session: byKey["2026-08-10|mañana"],
      tripType: "ida",
      pickupTime: "11:00",
      dropoffTime: "",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Carpena",
      session: byKey["2026-08-17|mañana"],
      tripType: "ida",
      pickupTime: "11:00",
      dropoffTime: "",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
    {
      driver: "Carpena",
      session: byKey["2026-08-31|mañana"],
      tripType: "ida",
      pickupTime: "11:00",
      dropoffTime: "",
      girls: girlsWithStatus(allGirls),
      notes: "",
    },
  ].map((trip) => ({
    id: db.uid(),
    sessionId: trip.session.id,
    driverId: driverByName[trip.driver].id,
    tripType: trip.tripType,
    kids: trip.girls.map((g) => ({ kidId: kidByName[g.kidName].id, status: g.status })),
    pickupTime: trip.pickupTime,
    dropoffTime: trip.dropoffTime,
    notes: trip.notes,
  }));

  await db.bulkPut("trips", trips);

  await db.saveSettings({
    activeMonth: "2026-08",
    activeSeason: "2026-2027",
    seeded: true,
    vacations: [
      {
        id: db.uid(),
        driverId: driverByName["Carpena"].id,
        startDate: "2026-08-18",
        endDate: "2026-08-30",
        note: "Vacaciones",
      },
    ],
  });
  return true;
}
