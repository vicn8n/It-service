const express = require("express");
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { parsePaging } = require("../utils/pagination");
const { upload, verifyUpload, UPLOAD_DIR } = require("../middleware/upload");
const { audit } = require("../utils/audit");

const router = express.Router();
router.use(authenticate);

function removeUploadedFile(file) {
  if (!file) return;
  const fileName = file.filename || file.filePath;
  if (fileName) fs.promises.unlink(path.join(UPLOAD_DIR, fileName)).catch(() => {});
}

// ─── หมวดหมู่ KB ───
router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const cats = await prisma.kbCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { articles: { where: { published: true } } } } },
    });
    res.json(cats);
  })
);

router.post(
  "/categories",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const { name, icon } = z.object({ name: z.string().min(1), icon: z.string().optional() }).parse(req.body);
    res.status(201).json(await prisma.kbCategory.create({ data: { name, icon } }));
  })
);

// ─── บทความ ───
router.get(
  "/articles",
  asyncHandler(async (req, res) => {
    const { q, categoryId } = req.query;
    const where = {};
    // USER เห็นเฉพาะที่ published
    if (req.user.role === "USER") where.published = true;
    if (categoryId) where.categoryId = Number(categoryId);
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { tags: { contains: q, mode: "insensitive" } }];

    const { page, take, skip } = parsePaging(req.query);
    const [items, total] = await Promise.all([
      prisma.kbArticle.findMany({
        where, take, skip, orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          summary: true,
          tags: true,
          views: true,
          published: true,
          updatedAt: true,
          category: { select: { name: true, icon: true } },
          author: { select: { fullName: true } },
          _count: { select: { attachments: true } },
        },
      }),
      prisma.kbArticle.count({ where }),
    ]);
    res.json({ items, total, page, pageSize: take });
  })
);

router.get(
  "/articles/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const article = await prisma.kbArticle.findUnique({
      where: { id },
      include: { category: true, author: { select: { fullName: true } }, attachments: { orderBy: { createdAt: "asc" } } },
    });
    if (!article) return res.status(404).json({ error: "ไม่พบบทความ" });
    if (!article.published && req.user.role === "USER") return res.status(403).json({ error: "บทความนี้ยังไม่เผยแพร่" });
    // นับยอดอ่าน
    await prisma.kbArticle.update({ where: { id }, data: { views: { increment: 1 } } });
    res.json(article);
  })
);

const articleSchema = z.object({
  title: z.string().min(3),
  body: z.string().min(5),
  summary: z.string().optional(),
  categoryId: z.coerce.number().int().nullable().optional(),
  tags: z.string().optional(),
  published: z.boolean().default(false),
});

router.post(
  "/articles",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const data = articleSchema.parse(req.body);
    const article = await prisma.kbArticle.create({ data: { ...data, authorId: req.user.id } });
    await audit(req, "CREATE_KB", "KbArticle", article.id);
    res.status(201).json(article);
  })
);

router.patch(
  "/articles/:id",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = articleSchema.partial().parse(req.body);
    const article = await prisma.kbArticle.update({ where: { id }, data });
    await audit(req, "UPDATE_KB", "KbArticle", id);
    res.json(article);
  })
);

router.post(
  "/articles/:id/attachments",
  requireRole("ADMIN", "AGENT"),
  upload.single("file"),
  verifyUpload,
  asyncHandler(async (req, res) => {
    const articleId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "กรุณาแนบไฟล์ PDF หรือรูปภาพ" });

    const article = await prisma.kbArticle.findUnique({ where: { id: articleId }, select: { id: true } });
    if (!article) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: "ไม่พบบทความ" });
    }

    const att = await prisma.kbAttachment.create({
      data: {
        articleId,
        fileName: req.file.originalname,
        filePath: req.file.filename,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
    await audit(req, "ADD_KB_ATTACHMENT", "KbArticle", articleId, { attachmentId: att.id, fileName: att.fileName });
    res.status(201).json(att);
  })
);

router.delete(
  "/articles/:id/attachments/:attId",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const articleId = Number(req.params.id);
    const attId = Number(req.params.attId);
    const att = await prisma.kbAttachment.findFirst({ where: { id: attId, articleId } });
    if (!att) return res.status(404).json({ error: "ไม่พบไฟล์แนบ" });

    await prisma.kbAttachment.delete({ where: { id: attId } });
    removeUploadedFile({ filePath: att.filePath });
    await audit(req, "DELETE_KB_ATTACHMENT", "KbArticle", articleId, { attachmentId: att.id, fileName: att.fileName });
    res.json({ ok: true });
  })
);

router.delete(
  "/articles/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const article = await prisma.kbArticle.findUnique({ where: { id }, include: { attachments: true } });
    if (!article) return res.status(404).json({ error: "ไม่พบบทความ" });
    await prisma.kbArticle.delete({ where: { id } });
    article.attachments.forEach((att) => removeUploadedFile({ filePath: att.filePath }));
    await audit(req, "DELETE_KB", "KbArticle", id, { title: article.title });
    res.json({ ok: true });
  })
);

module.exports = router;
