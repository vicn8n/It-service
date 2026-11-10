const prisma = require("../db");

const OPEN_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"];

// เลือกเจ้าหน้าที่ที่งานค้างน้อยที่สุดจากชุด candidate ids
async function pickLeastLoaded(candidateIds) {
  if (!candidateIds.length) return null;
  const loads = await prisma.ticket.groupBy({
    by: ["assigneeId"],
    where: { assigneeId: { in: candidateIds }, status: { in: OPEN_STATUSES } },
    _count: true,
  });
  const loadMap = Object.fromEntries(loads.map((l) => [l.assigneeId, l._count]));
  return [...candidateIds].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0))[0];
}

/**
 * หาผู้รับผิดชอบอัตโนมัติสำหรับ ticket ใหม่
 * - ถ้าหมวดหมู่ผูกกับทีม → เลือกจากสมาชิกทีมนั้นที่งานน้อยสุด (คืน teamId ด้วย)
 * - ไม่งั้น fallback → AGENT ทุกคนที่ active งานน้อยสุด
 * คืน { assigneeId, teamId }
 */
async function autoAssign(categoryId) {
  // 1) มีทีมประจำหมวดไหม
  if (categoryId) {
    const cat = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { teamId: true, team: { select: { isActive: true } } },
    });
    if (cat?.teamId && cat.team?.isActive) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: cat.teamId, user: { isActive: true, role: { in: ["AGENT", "ADMIN", "MANAGER"] } } },
        select: { userId: true },
      });
      const ids = members.map((m) => m.userId);
      const assigneeId = await pickLeastLoaded(ids);
      if (assigneeId) return { assigneeId, teamId: cat.teamId };
      // ทีมไม่มีสมาชิกใช้งานได้ → ยังผูกทีมไว้ แต่ไม่มีผู้รับผิดชอบ
      return { assigneeId: null, teamId: cat.teamId };
    }
  }
  // 2) fallback: AGENT ทั้งหมด
  const agents = await prisma.user.findMany({ where: { role: "AGENT", isActive: true }, select: { id: true } });
  const assigneeId = await pickLeastLoaded(agents.map((a) => a.id));
  return { assigneeId, teamId: null };
}

module.exports = { autoAssign, pickLeastLoaded, OPEN_STATUSES };
