const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { parsePaging } = require("../utils/pagination");
const { inTransaction, httpError } = require("../utils/transaction");
const { audit } = require("../utils/audit");
const { upload, verifyUpload } = require("../middleware/upload");

const router = express.Router();
router.use(authenticate);

const STATUSES = ["IN_USE", "IN_STOCK", "REPAIR", "LOANED", "RETIRED", "DISPOSED"];
const IMPORT_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const MAX_IMPORT_ROWS = 1000;

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_IMPORT_FILE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (IMPORT_EXTENSIONS.has(ext)) cb(null, true);
    else cb(Object.assign(new Error("รองรับเฉพาะไฟล์ CSV, XLSX, XLS"), { status: 400, expose: true }));
  },
});

const assetInclude = {
  type: true,
  owner: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
};

// ─────────── GET /api/assets/pick — ค้นเครื่องสำหรับฟอร์มแจ้งซ่อม ───────────
// ทุก role ใช้ได้ แต่คืนเฉพาะฟิลด์ที่ใช้ระบุตัวเครื่อง ไม่มีราคา/serial/ประวัติ
// ต้องประกาศก่อน "/:id" ไม่งั้นจะถูก route นั้นจับไปก่อน
const pickSelect = {
  id: true,
  assetTag: true,
  brand: true,
  model: true,
  hostname: true,
  ownerId: true,
  type: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
};

router.get(
  "/pick",
  asyncHandler(async (req, res) => {
    const { id, ownerId, q } = req.query;
    const where = {};
    if (id) {
      const assetId = Number(id);
      if (!Number.isInteger(assetId)) return res.status(400).json({ error: "id ไม่ถูกต้อง" });
      where.id = assetId;
    }
    if (ownerId) where.ownerId = ownerId === "me" ? req.user.id : Number(ownerId);
    if (q) {
      where.OR = [
        { assetTag: { contains: q, mode: "insensitive" } },
        { hostname: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
      ];
    }
    const take = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ where, select: pickSelect, orderBy: { assetTag: "asc" }, take }),
      prisma.asset.count({ where }),
    ]);
    res.json({ items, total });
  })
);

// ─────────── GET /api/assets — list + filter (เจ้าหน้าที่) ───────────
router.get(
  "/",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const { typeId, status, departmentId, ownerId, q, warrantyExpiring } = req.query;
    const where = {};
    if (typeId) where.typeId = Number(typeId);
    if (status) where.status = status;
    if (departmentId) where.departmentId = Number(departmentId);
    if (ownerId) where.ownerId = ownerId === "me" ? req.user.id : Number(ownerId);
    if (q) {
      where.OR = [
        { assetTag: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
        { serialNo: { contains: q, mode: "insensitive" } },
        { hostname: { contains: q, mode: "insensitive" } },
        { officeSuite: { contains: q, mode: "insensitive" } },
        { accountingAssetCode: { contains: q, mode: "insensitive" } },
      ];
    }
    // ประกันใกล้หมด (ภายใน N วัน)
    if (warrantyExpiring) {
      const days = Number(warrantyExpiring) || 30;
      const until = new Date(Date.now() + days * 86_400_000);
      where.warrantyExpiry = { lte: until, gte: new Date() };
    }

    const { page, take, skip } = parsePaging(req.query);
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ where, include: assetInclude, orderBy: { assetTag: "asc" }, take, skip }),
      prisma.asset.count({ where }),
    ]);
    res.json({ items, total, page, pageSize: take });
  })
);

// ─────────── GET /api/assets/:id ───────────
router.get(
  "/:id",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const asset = await prisma.asset.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        ...assetInclude,
        tickets: { select: { id: true, ticketNo: true, subject: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } },
        assignments: {
          include: { user: { select: { id: true, fullName: true, email: true, username: true } } },
          orderBy: { assignedAt: "desc" },
        },
        attachments: true,
        relationsFrom: { include: { target: { select: { id: true, assetTag: true, brand: true, model: true, status: true, type: { select: { name: true } } } } } },
        relationsTo: { include: { source: { select: { id: true, assetTag: true, brand: true, model: true, status: true, type: { select: { name: true } } } } } },
        softwareAssignments: {
          include: { license: { select: { id: true, name: true, publisher: true, expiry: true, totalSeats: true } } },
          orderBy: { assignedAt: "desc" },
        },
      },
    });
    if (!asset) return res.status(404).json({ error: "ไม่พบทรัพย์สิน" });
    res.json(asset);
  })
);

const assetSchema = z.object({
  assetTag: z.string().min(1, "กรุณากรอก Asset ID"),
  typeId: z.coerce.number().int(),
  brand: z.string().min(1, "กรุณากรอกยี่ห้อ"),
  model: z.string().min(1, "กรุณากรอกรุ่น"),
  serialNo: z.string().optional(),
  hostname: z.string().optional(),
  ipAddress: z.string().optional(),
  macAddress: z.string().optional(),
  specification: z.string().optional(),
  os: z.string().optional(),
  officeSuite: z.string().optional(),
  accountingAssetCode: z.string().optional(),
  status: z.enum(STATUSES).default("IN_STOCK"),
  locationText: z.string().optional(),
  locationId: z.coerce.number().int().nullable().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
  ownerName: z.string().optional(),
  departmentId: z.coerce.number().int().nullable().optional(),
  vendorId: z.coerce.number().int().nullable().optional(),
  contractId: z.coerce.number().int().nullable().optional(),
  purchaseDate: z.coerce.date().optional(),
  // Decimal(12,2) ในฐานข้อมูล — เกินนี้ PostgreSQL จะปฏิเสธ
  purchasePrice: z.coerce.number().min(0).max(9_999_999_999.99, "ราคาเกิน 9,999,999,999.99").optional(),
  poNumber: z.string().optional(),
  warrantyExpiry: z.coerce.date().optional(),
  usefulLifeMonths: z.coerce.number().int().optional(),
  salvageValue: z.coerce.number().min(0).max(9_999_999_999.99, "มูลค่าซากเกิน 9,999,999,999.99").optional(),
  notes: z.string().optional(),
});

const headerAliases = {
  assetTag: ["assettag", "assetid", "asset", "assetcode", "assetno", "assetnumber", "devicename", "device", "computername", "computer", "hostname", "host", "name", "รหัสทรัพย์สิน", "รหัสasset", "ชื่อเครื่อง"],
  typeId: ["typeid", "assettypeid", "ประเภทid"],
  type: ["type", "assettype", "category", "ประเภท", "ชนิด"],
  brand: ["brand", "manufacturer", "vendor", "make", "ยี่ห้อ", "ผู้ผลิต"],
  model: ["model", "hardwaremodel", "systemmodel", "product", "รุ่น"],
  serialNo: ["serialno", "serialnumber", "sn", "s/n", "ซีเรียล", "เลขซีเรียล"],
  hostname: ["hostname", "host", "computername", "devicename", "device", "name", "ชื่อเครื่อง"],
  ipAddress: ["ipaddress", "ip", "ipaddr"],
  macAddress: ["macaddress", "mac", "macaddr"],
  specification: ["specification", "spec", "สเปค", "รายละเอียดเครื่อง"],
  os: ["os", "operatingsystem"],
  officeSuite: ["officesuite", "office", "microsoftoffice", "msoffice", "officeversion", "office365", "ใช้office", "ใช้ office", "officeที่ใช้", "โปรแกรมoffice"],
  accountingAssetCode: ["accountingassetcode", "accountassetcode", "accountingcode", "assetaccountingcode", "financeassetcode", "fixedassetcode", "fixedassetno", "accountassetno", "accountcode", "รหัสทรัพย์สินบัญชี", "รหัสทรัพย์สินของบัญชี", "รหัสบัญชี", "รหัสสินทรัพย์บัญชี"],
  status: ["status", "สถานะ"],
  locationText: ["locationtext", "locationdetail", "location", "สถานที่", "ที่ตั้ง"],
  locationId: ["locationid", "สาขาid"],
  ownerId: ["ownerid", "userid", "ผู้ครอบครองid"],
  owner: ["owner", "user", "assignee", "ผู้ครอบครอง", "ผู้ใช้"],
  departmentId: ["departmentid", "deptid", "แผนกid"],
  department: ["department", "dept", "แผนก"],
  vendorId: ["vendorid", "ผู้จำหน่ายid"],
  vendor: ["supplier", "reseller", "ผู้จำหน่าย"],
  purchaseDate: ["purchasedate", "buydate", "วันที่ซื้อ"],
  purchasePrice: ["purchaseprice", "price", "cost", "ราคา"],
  poNumber: ["ponumber", "po", "เลขpo"],
  warrantyExpiry: ["warrantyexpiry", "warrantyexpire", "warrantyend", "วันหมดประกัน", "หมดประกัน"],
  usefulLifeMonths: ["usefullifemonths", "usefullife", "life", "อายุการใช้งานเดือน", "อายุการใช้งาน"],
  salvageValue: ["salvagevalue", "มูลค่าซาก"],
  notes: ["notes", "note", "remark", "remarks", "หมายเหตุ"],
};

const statusAliases = {
  inuse: "IN_USE",
  in_use: "IN_USE",
  ใช้งานอยู่: "IN_USE",
  ใช้งาน: "IN_USE",
  instock: "IN_STOCK",
  in_stock: "IN_STOCK",
  stock: "IN_STOCK",
  ว่าง: "IN_STOCK",
  พร้อมใช้: "IN_STOCK",
  repair: "REPAIR",
  ซ่อม: "REPAIR",
  ระหว่างซ่อม: "REPAIR",
  loaned: "LOANED",
  ยืมออก: "LOANED",
  retired: "RETIRED",
  รอจำหน่าย: "RETIRED",
  disposed: "DISPOSED",
  จำหน่ายแล้ว: "DISPOSED",
};

function normalizeKey(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]*:]+/g, "");
}

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function cleanString(value) {
  if (isBlank(value)) return undefined;
  return String(value).trim();
}

function toNumber(value) {
  if (isBlank(value)) return undefined;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

function excelSerialToDate(value) {
  const parsed = XLSX.SSF.parse_date_code(Number(value));
  if (!parsed) return undefined;
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
}

function toDate(value) {
  if (isBlank(value)) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20_000 && value < 80_000) return excelSerialToDate(value);

  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20_000 && n < 80_000) return excelSerialToDate(n);
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    const year = yy.length === 2 ? Number("20" + yy) : Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeStatus(value) {
  if (isBlank(value)) return "IN_STOCK";
  const raw = String(value).trim();
  if (STATUSES.includes(raw)) return raw;
  return statusAliases[raw] || statusAliases[normalizeKey(raw)] || undefined;
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((h, i) => { item[h] = cells[i] ?? ""; });
    return item;
  });
}

// ตรวจเนื้อไฟล์ให้ตรงกับนามสกุล ไม่เชื่อแค่ชื่อไฟล์
// .xlsx = ZIP (PK), .xls = OLE2 (D0 CF 11 E0), .csv = ข้อความ UTF-8 ที่ไม่มี byte 0
function assertImportContent(file, ext) {
  const b = file.buffer;
  const bad = () => { throw Object.assign(new Error("เนื้อไฟล์ไม่ตรงกับนามสกุล กรุณาบันทึกไฟล์ใหม่เป็น CSV หรือ Excel"), { status: 400, expose: true }); };
  if (ext === ".xlsx" && !(b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) bad();
  if (ext === ".xls" && !(b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)) bad();
  if (ext === ".csv") {
    if (b.includes(0)) bad();
    try { new TextDecoder("utf-8", { fatal: true }).decode(b); } catch {
      throw Object.assign(new Error("ไฟล์ CSV ต้องเข้ารหัส UTF-8 (ใน Excel เลือก Save As → CSV UTF-8)"), { status: 400, expose: true });
    }
  }
}

function parseImportFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  assertImportContent(file, ext);
  if (ext === ".csv") return parseCsv(file.buffer.toString("utf8"));

  const wb = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
}

function normalizeImportRow(row) {
  const byHeader = {};
  for (const [key, value] of Object.entries(row)) byHeader[normalizeKey(key)] = value;

  const get = (field) => {
    for (const alias of headerAliases[field] || []) {
      const key = normalizeKey(alias);
      if (Object.prototype.hasOwnProperty.call(byHeader, key)) return byHeader[key];
    }
    return undefined;
  };

  return {
    assetTag: cleanString(get("assetTag")),
    typeId: toNumber(get("typeId")),
    type: cleanString(get("type")),
    brand: cleanString(get("brand")),
    model: cleanString(get("model")),
    serialNo: cleanString(get("serialNo")),
    hostname: cleanString(get("hostname")),
    ipAddress: cleanString(get("ipAddress")),
    macAddress: cleanString(get("macAddress")),
    specification: cleanString(get("specification")),
    os: cleanString(get("os")),
    officeSuite: cleanString(get("officeSuite")),
    accountingAssetCode: cleanString(get("accountingAssetCode")),
    status: normalizeStatus(get("status")),
    locationText: cleanString(get("locationText")),
    locationId: toNumber(get("locationId")),
    location: cleanString(get("location")),
    ownerId: toNumber(get("ownerId")),
    owner: cleanString(get("owner")),
    departmentId: toNumber(get("departmentId")),
    department: cleanString(get("department")),
    vendorId: toNumber(get("vendorId")),
    vendor: cleanString(get("vendor")),
    purchaseDate: toDate(get("purchaseDate")),
    purchasePrice: toNumber(get("purchasePrice")),
    poNumber: cleanString(get("poNumber")),
    warrantyExpiry: toDate(get("warrantyExpiry")),
    usefulLifeMonths: toNumber(get("usefulLifeMonths")),
    salvageValue: toNumber(get("salvageValue")),
    notes: cleanString(get("notes")),
  };
}

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function mapByName(items, field = "name") {
  return new Map(items.map((item) => [normalizeKey(item[field]), item]));
}

function pickReference(value, byName, label) {
  if (!value) return { id: undefined };
  const item = byName.get(normalizeKey(value));
  if (item) return { id: item.id };
  return { error: `${label} "${value}" ไม่พบในระบบ` };
}

function findDefaultAssetType(refs) {
  return (
    refs.assetTypesByName.get("desktop") ||
    refs.assetTypesByName.get(normalizeKey("คอมพิวเตอร์")) ||
    refs.assetTypesByName.values().next().value
  );
}

function appendImportNote(data, text) {
  if (!text) return;
  data.notes = [data.notes, `[Import] ${text}`].filter(Boolean).join("\n");
}

function buildImportAsset(row, refs) {
  const errors = [];
  const data = {
    assetTag: row.assetTag || row.hostname,
    brand: row.brand || "Unknown",
    model: row.model || "Unknown",
    serialNo: row.serialNo,
    hostname: row.hostname,
    ipAddress: row.ipAddress,
    macAddress: row.macAddress,
    specification: row.specification,
    os: row.os,
    officeSuite: row.officeSuite,
    accountingAssetCode: row.accountingAssetCode,
    status: row.status,
    locationText: row.locationText,
    purchaseDate: row.purchaseDate,
    purchasePrice: row.purchasePrice,
    poNumber: row.poNumber,
    warrantyExpiry: row.warrantyExpiry,
    usefulLifeMonths: row.usefulLifeMonths ? Math.trunc(row.usefulLifeMonths) : undefined,
    salvageValue: row.salvageValue,
    notes: row.notes,
  };

  if (!data.assetTag) errors.push("กรุณาระบุ Asset ID");
  if (!data.brand) errors.push("กรุณาระบุยี่ห้อ");
  if (!data.model) errors.push("กรุณาระบุรุ่น");
  if (!data.status) errors.push("สถานะไม่ถูกต้อง");

  if (row.typeId) {
    if (refs.assetTypesById.has(row.typeId)) data.typeId = row.typeId;
    else errors.push(`ประเภท ID ${row.typeId} ไม่พบในระบบ`);
  } else if (row.type) {
    const ref = pickReference(row.type, refs.assetTypesByName, "ประเภท");
    if (ref.error) errors.push(ref.error);
    else data.typeId = ref.id;
  } else {
    data.typeId = findDefaultAssetType(refs)?.id;
  }
  if (!data.typeId) errors.push("กรุณาระบุประเภท");

  for (const [field, idField, byId, byName, label] of [
    ["department", "departmentId", refs.departmentsById, refs.departmentsByName, "แผนก"],
    ["vendor", "vendorId", refs.vendorsById, refs.vendorsByName, "ผู้จำหน่าย"],
    ["location", "locationId", refs.locationsById, refs.locationsByName, "สถานที่"],
  ]) {
    const idValue = row[idField];
    if (idValue) {
      if (byId.has(idValue)) data[idField] = idValue;
      else appendImportNote(data, `${label} ID from file: ${idValue}`);
    } else if (row[field]) {
      const ref = pickReference(row[field], byName, label);
      if (ref.error) appendImportNote(data, `${label} from file: ${row[field]}`);
      else data[idField] = ref.id;
    }
  }

  if (row.ownerId) {
    if (refs.usersById.has(row.ownerId)) data.ownerId = row.ownerId;
    else appendImportNote(data, `Owner ID from file: ${row.ownerId}`);
  } else if (row.owner) {
    const key = normalizeKey(row.owner);
    const owner = refs.usersByEmail.get(key) || refs.usersByName.get(key);
    if (owner) data.ownerId = owner.id;
    else appendImportNote(data, `Owner from file: ${row.owner}`);
  }

  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) delete data[key];
  });
  return { data, errors };
}

async function createAssignmentIfNeeded(db, asset, ownerId) {
  if (ownerId) await db.assetAssignment.create({ data: { assetId: asset.id, userId: ownerId } });
}

async function updateAssignmentIfNeeded(db, assetId, currentOwnerId, nextOwnerId) {
  if (nextOwnerId === undefined || nextOwnerId === currentOwnerId) return;
  await db.assetAssignment.updateMany({
    where: { assetId, returnedAt: null },
    data: { returnedAt: new Date() },
  });
  if (nextOwnerId) await db.assetAssignment.create({ data: { assetId, userId: nextOwnerId } });
}

function placeholderOwnerEmail(name) {
  const hash = crypto.createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 12);
  return `asset-owner-${hash}@asset-owner.local`;
}

async function findOrCreateOwnerByName(name) {
  const fullName = cleanString(name);
  if (!fullName) return undefined;
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { fullName: { equals: fullName, mode: "insensitive" } },
        { email: { equals: fullName, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const email = placeholderOwnerEmail(fullName);
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, isActive: true },
    create: { email, fullName, role: "USER", isActive: true, passwordHash: null },
    select: { id: true },
  });
  return user.id;
}

async function prepareAssetData(input) {
  const { ownerName, ...data } = input;
  if (!data.ownerId && cleanString(ownerName)) {
    data.ownerId = await findOrCreateOwnerByName(ownerName);
  }
  return data;
}

async function importAssets(req, rows, updateExisting) {
  const [assetTypes, departments, vendors, locations, users, existingAssets] = await Promise.all([
    prisma.assetType.findMany(),
    prisma.department.findMany(),
    prisma.vendor.findMany(),
    prisma.location.findMany(),
    prisma.user.findMany({ select: { id: true, fullName: true, email: true } }),
    prisma.asset.findMany({ select: { id: true, assetTag: true, ownerId: true } }),
  ]);

  const refs = {
    assetTypesById: mapById(assetTypes),
    assetTypesByName: mapByName(assetTypes),
    departmentsById: mapById(departments),
    departmentsByName: mapByName(departments),
    vendorsById: mapById(vendors),
    vendorsByName: mapByName(vendors),
    locationsById: mapById(locations),
    locationsByName: mapByName(locations),
    usersById: mapById(users),
    usersByName: new Map(users.map((user) => [normalizeKey(user.fullName), user])),
    usersByEmail: new Map(users.map((user) => [normalizeKey(user.email), user])),
  };
  const assetsByTag = new Map(existingAssets.map((asset) => [normalizeKey(asset.assetTag), asset]));
  const seenTags = new Set();
  const result = { total: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const writes = [];

  for (let i = 0; i < rows.length; i += 1) {
    const rowNo = i + 2;
    const raw = normalizeImportRow(rows[i]);
    if (Object.values(raw).every((value) => value === undefined)) continue;

    const { data, errors } = buildImportAsset(raw, refs);
    const tagKey = normalizeKey(data.assetTag);
    if (tagKey && seenTags.has(tagKey)) errors.push(`Asset ID "${data.assetTag}" ซ้ำในไฟล์`);

    if (errors.length) {
      result.failed += 1;
      result.errors.push({ row: rowNo, assetTag: data.assetTag || "", message: errors.join(", ") });
      continue;
    }
    seenTags.add(tagKey);

    const existing = assetsByTag.get(tagKey);
    if (existing && !updateExisting) {
      result.skipped += 1;
      result.errors.push({ row: rowNo, assetTag: data.assetTag, message: "Asset ID ซ้ำในระบบ จึงข้าม" });
      continue;
    }
    // ตรวจรูปแบบให้ครบทุกแถวก่อน แถวที่ผิดถูกรายงานและข้าม — ยังไม่เขียนอะไรลงฐานข้อมูล
    const check = assetSchema.safeParse(data);
    if (!check.success) {
      result.failed += 1;
      result.errors.push({ row: rowNo, assetTag: data.assetTag || "", message: check.error.issues?.[0]?.message || "ข้อมูลไม่ถูกต้อง" });
      continue;
    }
    writes.push({ rowNo, assetTag: data.assetTag, existing, parsed: check.data });
  }

  // เขียนทุกแถวที่ผ่านการตรวจใน transaction เดียว — ถ้าแถวใดบันทึกไม่ได้ ยกเลิกทั้งชุด ไม่เหลือข้อมูลครึ่ง ๆ กลาง ๆ
  let current = null;
  try {
    await prisma.$transaction(async (tx) => {
      for (const w of writes) {
        current = w;
        if (w.existing) {
          await updateAssignmentIfNeeded(tx, w.existing.id, w.existing.ownerId, w.parsed.ownerId);
          await tx.asset.update({ where: { id: w.existing.id }, data: w.parsed });
          result.updated += 1;
        } else {
          const asset = await tx.asset.create({ data: w.parsed, select: { id: true } });
          await createAssignmentIfNeeded(tx, asset, w.parsed.ownerId);
          result.created += 1;
        }
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  } catch (err) {
    const where = current ? `แถว ${current.rowNo} (${current.assetTag})` : "การบันทึก";
    // ไม่ส่งข้อความดิบของ Prisma กลับไป (มี path ไฟล์/stack) — ดึงเฉพาะเหตุผลจาก PostgreSQL ถ้ามี
    const pg = String(err.message || "").match(/message: "([^"]+)"/)?.[1];
    if (!err.code && !pg) console.error("[IMPORT]", err);
    const reason = err.code === "P2002"
      ? `ข้อมูลซ้ำกับที่มีในระบบ (${[].concat(err.meta?.target || []).join(", ")})`
      : pg ? `ฐานข้อมูลปฏิเสธข้อมูล (${pg})` : "ข้อมูลไม่ถูกต้องตามรูปแบบฐานข้อมูล";
    await audit(req, "IMPORT_ASSETS", "Asset", null, { file: req.file.originalname, rolledBack: true, row: current?.rowNo, error: String(reason).slice(0, 300) });
    throw Object.assign(new Error(`${where} บันทึกไม่สำเร็จ: ${reason} — ยกเลิกการนำเข้าทั้งหมด ยังไม่มีข้อมูลใดถูกบันทึก`), { status: 400, expose: true });
  }

  await audit(req, "IMPORT_ASSETS", "Asset", null, {
    file: req.file.originalname,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors.slice(0, 20),
  });
  return result;
}

// ─────────── POST /api/assets (AGENT/ADMIN) ───────────
router.post(
  "/",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const data = await prepareAssetData(assetSchema.parse(req.body));
    const asset = await prisma.asset.create({ data, include: assetInclude });

    // บันทึกประวัติการมอบหมายครั้งแรก
    if (data.ownerId) {
      await prisma.assetAssignment.create({ data: { assetId: asset.id, userId: data.ownerId } });
    }
    await audit(req, "CREATE_ASSET", "Asset", asset.id, { assetTag: asset.assetTag });
    res.status(201).json(asset);
  })
);

// ─────────── PATCH /api/assets/:id (AGENT/ADMIN) ───────────
router.post(
  "/import",
  requireRole("ADMIN", "AGENT"),
  importUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "กรุณาแนบไฟล์ CSV หรือ Excel" });
    const rows = parseImportFile(req.file).filter((row) => Object.values(row).some((value) => !isBlank(value)));
    if (!rows.length) return res.status(400).json({ error: "ไม่พบข้อมูลในไฟล์" });
    if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `นำเข้าได้สูงสุด ${MAX_IMPORT_ROWS} แถวต่อครั้ง` });

    const updateExisting = String(req.body.updateExisting || "").toLowerCase() === "true";
    const result = await importAssets(req, rows, updateExisting);
    res.status(201).json(result);
  })
);

router.patch(
  "/:id",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = await prepareAssetData(assetSchema.partial().parse(req.body));

    // ประวัติเจ้าของกับตัวทรัพย์สินต้องเปลี่ยนพร้อมกัน
    // เดิมเขียนประวัติก่อน update ถ้า update ล้มเหลว (เช่น Asset ID ซ้ำ) ประวัติจะแสดงเจ้าของใหม่ทั้งที่ของจริงยังไม่เปลี่ยน
    const asset = await inTransaction(async (tx) => {
      const existing = await tx.asset.findUnique({ where: { id } });
      if (!existing) throw httpError(404, "ไม่พบทรัพย์สิน");

      if (data.ownerId !== undefined && data.ownerId !== existing.ownerId) {
        await tx.assetAssignment.updateMany({
          where: { assetId: id, returnedAt: null },
          data: { returnedAt: new Date() },
        });
        if (data.ownerId) {
          await tx.assetAssignment.create({ data: { assetId: id, userId: data.ownerId } });
        }
      }
      return tx.asset.update({ where: { id }, data, include: assetInclude });
    });

    await audit(req, "UPDATE_ASSET", "Asset", id, { changes: data });
    res.json(asset);
  })
);

// ─────────── DELETE /api/assets/:id (ADMIN) ───────────
router.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const asset = await prisma.asset.findUnique({ where: { id }, select: { id: true, assetTag: true } });
    if (!asset) return res.status(404).json({ error: "ไม่พบทรัพย์สิน" });

    await prisma.$transaction([
      prisma.ticket.updateMany({ where: { assetId: id }, data: { assetId: null } }),
      prisma.asset.delete({ where: { id } }),
    ]);
    await audit(req, "DELETE_ASSET", "Asset", id, { assetTag: asset.assetTag, hardDelete: true });
    res.json({ ok: true });
  })
);

// ─────────── POST /api/assets/:id/attachments ───────────
router.post(
  "/:id/attachments",
  requireRole("ADMIN", "AGENT"),
  upload.single("file"),
  verifyUpload,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "กรุณาแนบไฟล์" });
    const att = await prisma.assetAttachment.create({
      data: {
        assetId: id,
        fileName: req.file.originalname,
        filePath: req.file.filename,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
    res.status(201).json(att);
  })
);

// ─────────── CMDB: ความสัมพันธ์ระหว่างทรัพย์สิน ───────────
const RELATION_TYPES = ["DEPENDS_ON", "CONNECTS_TO", "PART_OF", "INSTALLED_ON", "BACKUP_OF"];

router.post(
  "/:id/relations",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const sourceId = Number(req.params.id);
    const schema = z.object({ targetId: z.coerce.number().int(), type: z.enum(RELATION_TYPES).default("DEPENDS_ON"), note: z.string().optional() });
    const { targetId, type, note } = schema.parse(req.body);
    if (targetId === sourceId) return res.status(400).json({ error: "เชื่อมกับตัวเองไม่ได้" });
    const rel = await prisma.assetRelation.create({ data: { sourceId, targetId, type, note } });
    await audit(req, "ADD_ASSET_RELATION", "Asset", sourceId, { targetId, type });
    res.status(201).json(rel);
  })
);

router.delete(
  "/:id/relations/:relId",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const assetId = Number(req.params.id);
    // ลบได้เฉพาะความสัมพันธ์ที่ผูกกับทรัพย์สินตาม :id จริง ไม่ใช่ relation id ใดก็ได้
    const result = await prisma.assetRelation.deleteMany({
      where: { id: Number(req.params.relId), OR: [{ sourceId: assetId }, { targetId: assetId }] },
    });
    if (!result.count) return res.status(404).json({ error: "ไม่พบความสัมพันธ์นี้ของทรัพย์สิน" });
    await audit(req, "DELETE_ASSET_RELATION", "Asset", assetId, { relationId: Number(req.params.relId) });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/user-relations",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const assetId = Number(req.params.id);
    const schema = z.object({ userId: z.coerce.number().int(), note: z.string().optional() });
    const { userId, note } = schema.parse(req.body);
    const [asset, user] = await Promise.all([
      prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!asset) return res.status(404).json({ error: "ไม่พบทรัพย์สิน" });
    if (!user) return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });

    await prisma.assetAssignment.updateMany({
      where: { assetId, returnedAt: null },
      data: { returnedAt: new Date() },
    });
    const assignment = await prisma.assetAssignment.create({ data: { assetId, userId, note } });
    await prisma.asset.update({ where: { id: assetId }, data: { ownerId: userId } });
    await audit(req, "ADD_ASSET_USER_RELATION", "Asset", assetId, { userId });
    res.status(201).json(assignment);
  })
);

router.delete(
  "/:id/user-relations/:assignmentId",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const assetId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const assignment = await prisma.assetAssignment.findFirst({ where: { id: assignmentId, assetId } });
    if (!assignment) return res.status(404).json({ error: "ไม่พบความสัมพันธ์ผู้ใช้งาน" });

    await prisma.assetAssignment.update({ where: { id: assignmentId }, data: { returnedAt: new Date() } });
    await prisma.asset.updateMany({ where: { id: assetId, ownerId: assignment.userId }, data: { ownerId: null } });
    await audit(req, "REMOVE_ASSET_USER_RELATION", "Asset", assetId, { userId: assignment.userId, assignmentId });
    res.json({ ok: true });
  })
);

// ─────────── Stock-take: บันทึกว่าตรวจนับเจอแล้ว ───────────
router.post(
  "/:id/software-relations",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const assetId = Number(req.params.id);
    const schema = z.object({ licenseId: z.coerce.number().int(), note: z.string().optional() });
    const { licenseId, note } = schema.parse(req.body);
    const [asset, license] = await Promise.all([
      prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } }),
      prisma.softwareLicense.findUnique({ where: { id: licenseId }, select: { id: true, name: true } }),
    ]);
    if (!asset) return res.status(404).json({ error: "ไม่พบทรัพย์สิน" });
    if (!license) return res.status(404).json({ error: "ไม่พบ Software License" });

    try {
      const assignment = await prisma.assetSoftwareAssignment.create({ data: { assetId, licenseId, note } });
      await audit(req, "ADD_ASSET_SOFTWARE_RELATION", "Asset", assetId, { licenseId, licenseName: license.name });
      res.status(201).json(assignment);
    } catch (e) {
      if (e.code === "P2002") return res.status(409).json({ error: "Software License นี้ผูกกับทรัพย์สินนี้แล้ว" });
      throw e;
    }
  })
);

router.delete(
  "/:id/software-relations/:assignmentId",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const assetId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const assignment = await prisma.assetSoftwareAssignment.findFirst({
      where: { id: assignmentId, assetId },
      include: { license: { select: { id: true, name: true } } },
    });
    if (!assignment) return res.status(404).json({ error: "ไม่พบความสัมพันธ์ Software License" });

    await prisma.assetSoftwareAssignment.delete({ where: { id: assignmentId } });
    await audit(req, "REMOVE_ASSET_SOFTWARE_RELATION", "Asset", assetId, { licenseId: assignment.licenseId, licenseName: assignment.license?.name });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/seen",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const asset = await prisma.asset.update({ where: { id }, data: { lastSeenAt: new Date() }, include: assetInclude });
    await audit(req, "STOCKTAKE_SEEN", "Asset", id);
    res.json(asset);
  })
);

// ค้นหาด้วย assetTag (สำหรับสแกน barcode ตอนตรวจนับ)
router.get(
  "/by-tag/:tag",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const asset = await prisma.asset.findUnique({ where: { assetTag: req.params.tag }, include: assetInclude });
    if (!asset) return res.status(404).json({ error: "ไม่พบทรัพย์สินรหัสนี้" });
    res.json(asset);
  })
);

module.exports = router;
