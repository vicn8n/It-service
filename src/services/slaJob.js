const prisma = require("../db");

// ตรวจ ticket ที่เกิน SLA (resolveDueAt ผ่านไปแล้วแต่ยังไม่ปิด) แล้ว mark slaBreached
async function checkSlaBreaches() {
  try {
    const now = new Date();
    const result = await prisma.ticket.updateMany({
      where: {
        slaBreached: false,
        resolveDueAt: { lt: now },
        status: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] },
      },
      data: { slaBreached: true },
    });
    if (result.count > 0) {
      console.log(`[SLA] พบ ticket เกิน SLA ใหม่ ${result.count} รายการ`);
    }
    // SLA ตอบรับ: ถึงกำหนดแล้วแต่ยังไม่มีเจ้าหน้าที่ตอบรับ
    const resp = await prisma.ticket.updateMany({
      where: {
        responseBreached: false,
        firstRespAt: null,
        responseDueAt: { lt: now },
        status: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] },
      },
      data: { responseBreached: true },
    });
    if (resp.count > 0) {
      console.log(`[SLA] พบ ticket ตอบรับเกินกำหนดใหม่ ${resp.count} รายการ`);
    }
  } catch (e) {
    console.error("[SLA] ตรวจสอบ SLA ผิดพลาด:", e.message);
  }
}

let timer = null;
function startSlaJob(intervalMs = 5 * 60_000) {
  checkSlaBreaches(); // รันทันทีตอน start
  timer = setInterval(checkSlaBreaches, intervalMs);
  if (timer.unref) timer.unref();
}

module.exports = { startSlaJob, checkSlaBreaches };
