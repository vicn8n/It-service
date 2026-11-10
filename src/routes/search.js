const express = require("express");
const prisma = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate);

// GET /api/search?q=... — ค้นหารวมทุกโมดูล
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ q, groups: [] });

    const ci = { contains: q, mode: "insensitive" };
    const isStaff = req.user.role !== "USER";
    const take = 6;

    // tickets — USER เห็นเฉพาะของตัวเอง
    const ticketWhere = {
      OR: [{ subject: ci }, { ticketNo: ci }, { description: ci }],
    };
    if (!isStaff) ticketWhere.requesterId = req.user.id;

    const tasks = [
      prisma.ticket.findMany({
        where: ticketWhere,
        select: { id: true, ticketNo: true, subject: true, status: true, priority: true },
        orderBy: { createdAt: "desc" },
        take,
      }),
      prisma.kbArticle.findMany({
        where: { published: true, OR: [{ title: ci }, { body: ci }] },
        select: { id: true, title: true, category: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take,
      }),
    ];

    // assets + users เฉพาะเจ้าหน้าที่
    if (isStaff) {
      tasks.push(
        prisma.asset.findMany({
          where: { OR: [{ assetTag: ci }, { brand: ci }, { model: ci }, { serialNo: ci }] },
          select: { id: true, assetTag: true, brand: true, model: true, status: true },
          orderBy: { assetTag: "asc" },
          take,
        }),
        prisma.user.findMany({
          where: { OR: [{ fullName: ci }, { email: ci }] },
          select: { id: true, fullName: true, email: true, role: true },
          orderBy: { fullName: "asc" },
          take,
        })
      );
    }

    const [tickets, kb, assets = [], users = []] = await Promise.all(tasks);

    const groups = [];
    if (tickets.length)
      groups.push({
        type: "ticket", label: "🎫 Ticket", route: "ticket-detail",
        items: tickets.map((t) => ({ id: t.id, title: `${t.ticketNo} — ${t.subject}`, sub: t.status, tag: t.priority })),
      });
    if (assets.length)
      groups.push({
        type: "asset", label: "📦 ทรัพย์สิน", route: "asset-detail",
        items: assets.map((a) => ({ id: a.id, title: `${a.assetTag} — ${a.brand} ${a.model}`, sub: a.status })),
      });
    if (kb.length)
      groups.push({
        type: "kb", label: "📚 คลังความรู้", route: "kb-article",
        items: kb.map((k) => ({ id: k.id, title: k.title, sub: k.category?.name || "" })),
      });
    if (users.length)
      groups.push({
        type: "user", label: "👥 ผู้ใช้งาน", route: "users",
        items: users.map((u) => ({ id: u.id, title: u.fullName, sub: u.email, tag: u.role })),
      });

    res.json({ q, total: groups.reduce((s, g) => s + g.items.length, 0), groups });
  })
);

module.exports = router;
