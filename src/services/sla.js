const prisma = require("../db");

const DEFAULT_SLA = {
  CRITICAL: { response: 15, resolve: 240 },
  HIGH: { response: 30, resolve: 240 },
  MEDIUM: { response: 60, resolve: 240 },
  LOW: { response: 240, resolve: 240 },
};

const DEFAULT_BUSINESS_HOURS = [
  { dayOfWeek: 0, startTime: "08:00", endTime: "18:00", isWorking: false },
  { dayOfWeek: 1, startTime: "08:00", endTime: "18:00", isWorking: true },
  { dayOfWeek: 2, startTime: "08:00", endTime: "18:00", isWorking: true },
  { dayOfWeek: 3, startTime: "08:00", endTime: "18:00", isWorking: true },
  { dayOfWeek: 4, startTime: "08:00", endTime: "18:00", isWorking: true },
  { dayOfWeek: 5, startTime: "08:00", endTime: "18:00", isWorking: true },
  { dayOfWeek: 6, startTime: "08:00", endTime: "18:00", isWorking: false },
];

function parseTime(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map((n) => Number(n) || 0);
  return { hours, minutes };
}

function atTime(date, time) {
  const { hours, minutes } = parseTime(time);
  const out = new Date(date);
  out.setHours(hours, minutes, 0, 0);
  return out;
}

async function getBusinessSchedule() {
  const rows = await prisma.businessHours.findMany({ orderBy: { dayOfWeek: "asc" } });
  const schedule = new Map(DEFAULT_BUSINESS_HOURS.map((row) => [row.dayOfWeek, row]));
  for (const row of rows) schedule.set(row.dayOfWeek, row);
  return schedule;
}

function nextBusinessStart(from, schedule) {
  let cursor = new Date(from);
  for (let guard = 0; guard < 21; guard += 1) {
    const row = schedule.get(cursor.getDay());
    if (row?.isWorking) {
      const start = atTime(cursor, row.startTime);
      const end = atTime(cursor, row.endTime);
      if (cursor < start) return start;
      if (cursor < end) return cursor;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return new Date(from);
}

function addBusinessMinutes(from, minutes, schedule) {
  let remaining = Math.max(Number(minutes) || 0, 0);
  let cursor = nextBusinessStart(from, schedule);
  if (remaining === 0) return cursor;

  for (let guard = 0; guard < 10_000; guard += 1) {
    const row = schedule.get(cursor.getDay());
    if (!row?.isWorking) {
      cursor = nextBusinessStart(cursor, schedule);
      continue;
    }

    const end = atTime(cursor, row.endTime);
    const available = Math.max((end - cursor) / 60_000, 0);
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60_000);

    remaining -= available;
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
    cursor = nextBusinessStart(cursor, schedule);
  }

  throw new Error("ไม่สามารถคำนวณ SLA จากเวลาทำการได้");
}

// ลำดับการเลือก: นโยบายของหมวดหมู่ → นโยบายค่าเริ่มต้นของระดับความสำคัญ (categoryId = null) → DEFAULT_SLA
async function findSlaPolicy(priority, categoryId) {
  if (categoryId) {
    const own = await prisma.slaPolicy.findFirst({ where: { categoryId, priority } });
    if (own) return own;
  }
  return prisma.slaPolicy.findFirst({ where: { categoryId: null, priority }, orderBy: { id: "asc" } });
}

async function computeSlaDeadlines(priority, categoryId, from = new Date()) {
  const policy = await findSlaPolicy(priority, categoryId);

  const minutes = policy
    ? { response: policy.responseMinutes, resolve: policy.resolveMinutes }
    : DEFAULT_SLA[priority] || DEFAULT_SLA.MEDIUM;
  const schedule = await getBusinessSchedule();

  return {
    responseDueAt: addBusinessMinutes(from, minutes.response, schedule),
    resolveDueAt: addBusinessMinutes(from, minutes.resolve, schedule),
  };
}

// สถานะที่นับว่า "ตอบรับแล้ว" เมื่อเจ้าหน้าที่เปลี่ยนเข้าไป (มอบหมายเฉย ๆ ยังไม่นับ เพราะผู้แจ้งยังไม่ได้รับการติดต่อ)
const RESPONDED_STATUSES = ["IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"];

// ค่าที่ต้องเขียนลง ticket เมื่อเกิดการตอบรับครั้งแรก — คืน null ถ้าเคยตอบรับไปแล้ว
function firstResponsePatch(ticket, at = new Date()) {
  if (ticket.firstRespAt) return null;
  return {
    firstRespAt: at,
    responseBreached: ticket.responseDueAt ? at > new Date(ticket.responseDueAt) : false,
  };
}

module.exports = {
  computeSlaDeadlines,
  findSlaPolicy,
  firstResponsePatch,
  RESPONDED_STATUSES,
  DEFAULT_SLA,
  DEFAULT_BUSINESS_HOURS,
  addBusinessMinutes,
  getBusinessSchedule,
};
