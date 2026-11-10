const prisma = require("../db");

// รายการเมนู/ฟีเจอร์ที่ควบคุมสิทธิ์ได้ (key ตรงกับ data-route ใน index.html)
const MENU_ITEMS = [
  { key: "helpdesk", label: "Dashboard" },
  { key: "tickets", label: "รายการแจ้งซ่อม" },
  { key: "ticket-new", label: "แจ้งซ่อม / ขอบริการ" },
  { key: "catalog", label: "Service Catalog" },
  { key: "kb", label: "คลังความรู้" },
  { key: "assets-dash", label: "ภาพรวมทรัพย์สิน" },
  { key: "assets", label: "รายการทรัพย์สิน" },
  { key: "asset-new", label: "เพิ่มทรัพย์สิน" },
  { key: "stocktake", label: "ตรวจนับทรัพย์สิน" },
  { key: "licenses", label: "Software License" },
  { key: "vendors", label: "ผู้จำหน่าย" },
  { key: "contracts", label: "สัญญา/ประกัน" },
  { key: "depreciation", label: "รายงานค่าเสื่อม" },
  { key: "reports", label: "รายงาน & วิเคราะห์" },
  { key: "users", label: "ผู้ใช้งาน" },
  { key: "teams", label: "ทีม / คิวงาน" },
  { key: "settings", label: "ตั้งค่าระบบ" },
  { key: "audit", label: "Audit Log" },
  { key: "account", label: "บัญชีของฉัน" },
];

const ROLES = ["ADMIN", "MANAGER", "AGENT", "USER"];
const EDITABLE_ROLES = ["MANAGER", "AGENT", "USER"];

// ค่าเริ่มต้น (ตรงกับ data-roles เดิมใน index.html) — ถ้าไม่ระบุไว้ = ทุก role เข้าได้
const RESTRICTED_DEFAULTS = {
  "assets-dash": ["ADMIN", "AGENT"],
  assets: ["ADMIN", "AGENT"],
  "asset-new": ["ADMIN", "AGENT"],
  stocktake: ["ADMIN", "AGENT"],
  licenses: ["ADMIN", "AGENT"],
  vendors: ["ADMIN", "AGENT"],
  contracts: ["ADMIN", "AGENT"],
  depreciation: ["ADMIN", "AGENT"],
  users: ["ADMIN", "AGENT"],
  teams: ["ADMIN", "AGENT"],
  settings: ["ADMIN", "AGENT"],
  audit: ["ADMIN"],
};

function defaultAllowed(menuKey, role) {
  const allowedRoles = RESTRICTED_DEFAULTS[menuKey];
  return allowedRoles ? allowedRoles.includes(role) : true;
}

// คืน { menuKey: true/false } สำหรับ role ที่ระบุ — ใช้กรอง nav ของผู้ใช้
async function getPermissionsForRole(role) {
  if (role === "ADMIN") {
    const map = {};
    for (const m of MENU_ITEMS) map[m.key] = true; // ADMIN เข้าได้ทุกเมนูเสมอ กันล็อกตัวเองออก
    return map;
  }
  const overrides = await prisma.rolePermission.findMany({ where: { role } });
  const overrideMap = new Map(overrides.map((o) => [o.menuKey, o.allowed]));
  const map = {};
  for (const m of MENU_ITEMS) {
    map[m.key] = overrideMap.has(m.key) ? overrideMap.get(m.key) : defaultAllowed(m.key, role);
  }
  return map;
}

// คืน matrix เต็มสำหรับหน้าจัดการสิทธิ์ (ADMIN)
async function getFullMatrix() {
  const overrides = await prisma.rolePermission.findMany();
  const overrideMap = new Map(overrides.map((o) => [`${o.role}:${o.menuKey}`, o.allowed]));
  return MENU_ITEMS.map((m) => ({
    key: m.key,
    label: m.label,
    roles: Object.fromEntries(
      ROLES.map((r) => [
        r,
        r === "ADMIN" ? true : overrideMap.has(`${r}:${m.key}`) ? overrideMap.get(`${r}:${m.key}`) : defaultAllowed(m.key, r),
      ])
    ),
  }));
}

module.exports = { MENU_ITEMS, ROLES, EDITABLE_ROLES, getPermissionsForRole, getFullMatrix };
