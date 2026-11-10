const prisma = require("../db");

// เดือน/ปีปัจจุบันตามเวลาไทย → "YYMM" (เช่น ตุลาคม 2026 = "2610")
function bangkokYYMM(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return p.year.slice(-2) + p.month;
}

// สร้างเลขที่ ticket แบบ atomic ป้องกันเลขซ้ำเมื่อมีหลาย request พร้อมกัน
// รูปแบบ: INC-YYMM-0001 — เริ่มนับ 0001 ใหม่ทุกเดือน (counter แยกต่อเดือน)
// ใส่ YYMM ในเลขด้วยเพราะ ticketNo เป็น unique ถ้าใช้ INC-0001 ซ้ำข้ามเดือนจะชนกัน
// เลขเก่า (INC-0001 …) ยังอยู่เหมือนเดิม
async function nextTicketNo(tx = prisma, now = new Date()) {
  const ym = bangkokYYMM(now);
  const counter = await tx.counter.upsert({
    where: { id: `ticket-${ym}` },
    update: { value: { increment: 1 } },
    create: { id: `ticket-${ym}`, value: 1 },
  });
  return `INC-${ym}-${String(counter.value).padStart(4, "0")}`;
}

module.exports = { nextTicketNo, bangkokYYMM };
