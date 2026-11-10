const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const { inTransaction } = require("../utils/transaction");

const router = express.Router();
router.use(authenticate);

const staff = requireRole("ADMIN", "AGENT");
const admin = requireRole("ADMIN");

const memberSelect = { id: true, fullName: true, email: true, role: true };

// GET /api/teams — รายชื่อทีม + สมาชิก + หมวดที่ดูแล (มีอีเมลสมาชิก จึงจำกัดเจ้าหน้าที่)
router.get(
  "/",
  staff,
  asyncHandler(async (req, res) => {
    const teams = await prisma.team.findMany({
      orderBy: { name: "asc" },
      include: {
        members: { include: { user: { select: memberSelect } } },
        categories: { select: { id: true, name: true, icon: true } },
        _count: { select: { tickets: true } },
      },
    });
    res.json(
      teams.map((t) => ({
        id: t.id, name: t.name, description: t.description, isActive: t.isActive,
        ticketCount: t._count.tickets,
        categories: t.categories,
        members: t.members.map((m) => m.user),
      }))
    );
  })
);

const teamSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อทีม"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  memberIds: z.array(z.coerce.number().int()).optional(),
  categoryIds: z.array(z.coerce.number().int()).optional(),
});

// POST /api/teams (ADMIN)
router.post(
  "/",
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, isActive, memberIds = [], categoryIds = [] } = teamSchema.parse(req.body);
    const team = await prisma.team.create({
      data: {
        name, description, isActive: isActive ?? true,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });
    if (categoryIds.length) {
      await prisma.category.updateMany({ where: { id: { in: categoryIds } }, data: { teamId: team.id } });
    }
    await audit(req, "CREATE_TEAM", "Team", team.id);
    res.status(201).json(team);
  })
);

// PATCH /api/teams/:id (ADMIN) — แก้ข้อมูล + sync สมาชิก + หมวด
router.patch(
  "/:id",
  admin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { name, description, isActive, memberIds, categoryIds } = teamSchema.partial().parse(req.body);

    // ทั้งชุดต้องสำเร็จหรือไม่เกิดเลย — เดิมถ้าพังหลัง deleteMany สมาชิกทีมจะหายไปทั้งหมด
    await inTransaction(async (tx) => {
      await tx.team.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      // sync สมาชิก (replace ทั้งชุด)
      if (memberIds) {
        await tx.teamMember.deleteMany({ where: { teamId: id } });
        if (memberIds.length)
          await tx.teamMember.createMany({ data: memberIds.map((userId) => ({ teamId: id, userId })) });
      }
      // sync หมวดที่ทีมดูแล
      if (categoryIds) {
        await tx.category.updateMany({ where: { teamId: id }, data: { teamId: null } });
        if (categoryIds.length)
          await tx.category.updateMany({ where: { id: { in: categoryIds } }, data: { teamId: id } });
      }
    });
    await audit(req, "UPDATE_TEAM", "Team", id);
    res.json({ ok: true });
  })
);

// DELETE /api/teams/:id (ADMIN)
router.delete(
  "/:id",
  admin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    // ปลดหมวด + ปลด ticket ออกจากทีมก่อนลบ
    await prisma.category.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.ticket.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id } });
    await audit(req, "DELETE_TEAM", "Team", id);
    res.json({ ok: true });
  })
);

module.exports = router;
