const prisma = require("../db");
const { notifyMany } = require("./notify");

// แจ้งเตือนรอบชำระเงินของ Software License (รายเดือน/รายปี)
// - แจ้ง ADMIN/MANAGER ทุกคน เมื่อเหลือ <= remindDaysBefore วันก่อนถึง nextBillingDate (แจ้งครั้งเดียวต่อรอบ)
// - พอเลยวันชำระแล้ว เลื่อน nextBillingDate ไปรอบถัดไปอัตโนมัติ
// วันที่เก็บเป็น DATE (UTC เที่ยงคืน) — เทียบกับ "วันนี้" ตามเวลาไทย

const TZ = process.env.APP_TIMEZONE || "Asia/Bangkok";
const DAY_MS = 24 * 60 * 60 * 1000;

function todayUtcDate() {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  return new Date(ymd + "T00:00:00Z");
}

// เลื่อนไปอีก n เดือน โดยยึด "วันที่" เดิม (เช่น 31 → 28/29/30 ในเดือนที่สั้นกว่า แล้วกลับมา 31)
function addMonthsKeepDay(date, months, day) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

function nextCycle(date, cycle, day) {
  return addMonthsKeepDay(date, cycle === "YEARLY" ? 12 : 1, day || date.getUTCDate());
}

function fmtThaiDate(d) {
  return d.toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(v) {
  if (v == null) return "";
  return " ยอด " + Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";
}

async function checkLicenseBilling() {
  const today = todayUtcDate();
  const items = await prisma.softwareLicense.findMany({
    where: { billingCycle: { in: ["MONTHLY", "YEARLY"] }, nextBillingDate: { not: null } },
    include: { vendor: { select: { name: true } } },
  });
  let advanced = 0;
  let reminded = 0;
  let recipients = null;

  for (const l of items) {
    let due = l.nextBillingDate;
    // เลยวันชำระแล้ว → เลื่อนไปรอบถัดไป (วนจนถึงอนาคต เผื่อเซิร์ฟเวอร์ปิดไปนาน)
    if (due < today) {
      while (due < today) due = nextCycle(due, l.billingCycle, l.billingDay);
      await prisma.softwareLicense.update({ where: { id: l.id }, data: { nextBillingDate: due } });
      advanced++;
    }
    const daysLeft = Math.round((due - today) / DAY_MS);
    const alreadySent = l.lastBillingRemindedFor && l.lastBillingRemindedFor.getTime() === due.getTime();
    if (daysLeft > l.remindDaysBefore || alreadySent) continue;

    if (!recipients) {
      const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } }, select: { id: true } });
      recipients = staff.map((u) => u.id);
    }
    const cycleLabel = l.billingCycle === "YEARLY" ? "รายปี" : "รายเดือน";
    const when = daysLeft === 0 ? "วันนี้" : `อีก ${daysLeft} วัน`;
    const title = `💳 ถึงรอบชำระ ${l.name} (${cycleLabel}) ${when}`;
    const body = `ครบกำหนดชำระ ${fmtThaiDate(due)}${fmtMoney(l.billingAmount ?? l.cost)}` +
      (l.vendor?.name ? ` · ผู้จำหน่าย ${l.vendor.name}` : "") + ` · ${l.totalSeats} seats`;
    await notifyMany(recipients, title, body, "licenses");
    await prisma.softwareLicense.update({ where: { id: l.id }, data: { lastBillingRemindedFor: due } });
    reminded++;
  }
  if (advanced || reminded) console.log(`[BILLING] แจ้งเตือน ${reminded} รายการ, เลื่อนรอบ ${advanced} รายการ`);
  return { checked: items.length, reminded, advanced };
}

function startLicenseBillingJob(intervalMs = 60 * 60_000) {
  const run = () => checkLicenseBilling().catch((e) => console.error("[BILLING] ตรวจรอบชำระผิดพลาด:", e.message));
  run();
  setInterval(run, intervalMs).unref();
}

module.exports = { startLicenseBillingJob, checkLicenseBilling, addMonthsKeepDay, nextCycle };
