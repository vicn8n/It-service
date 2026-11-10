const prisma = require("../db");

// เลขเอกสารแบบ atomic: <PREFIX>-0001 (เช่น PRB-0001, CHG-0001)
async function nextNo(counterId, prefix, tx = prisma) {
  const c = await tx.counter.upsert({
    where: { id: counterId },
    update: { value: { increment: 1 } },
    create: { id: counterId, value: 1 },
  });
  return `${prefix}-${String(c.value).padStart(4, "0")}`;
}

module.exports = { nextNo };
