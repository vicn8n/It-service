// ข้อมูลตัวอย่างสำหรับ demo/preview — รันด้วย: node deploy/demo.js
// (ไม่ควรรันบน production จริง) — idempotent พอสมควร แต่ ticket จะเพิ่มซ้ำถ้ารันหลายครั้ง
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

// ── กันรันบน production โดยไม่ตั้งใจ (ข้อ 7 Go-Live) ──
// ถ้า NODE_ENV=production จะปฏิเสธ เว้นแต่ตั้ง ALLOW_DEMO_ON_PROD=true อย่างจงใจ
if ((process.env.NODE_ENV || "").toLowerCase() === "production" && process.env.ALLOW_DEMO_ON_PROD !== "true") {
  console.error("✗ ปฏิเสธ: ห้ามรัน demo.js บน production (NODE_ENV=production)");
  console.error("  ข้อมูลตัวอย่างจะปนกับข้อมูลจริง หากต้องการจริง ๆ ให้ตั้ง ALLOW_DEMO_ON_PROD=true");
  process.exit(1);
}
const bcrypt = require("bcryptjs");
const prisma = require("../src/db");
const { computeSlaDeadlines } = require("../src/services/sla");
const { nextTicketNo } = require("../src/utils/ticketNo");

async function main() {
  const dept = Object.fromEntries((await prisma.department.findMany()).map((d) => [d.name, d.id]));
  const cat = Object.fromEntries((await prisma.category.findMany()).map((c) => [c.name, c.id]));
  const type = Object.fromEntries((await prisma.assetType.findMany()).map((t) => [t.name, t.id]));
  const loc = Object.fromEntries((await prisma.location.findMany()).map((l) => [l.name, l.id]));
  const kbCat = Object.fromEntries((await prisma.kbCategory.findMany()).map((c) => [c.name, c.id]));
  const pw = await bcrypt.hash("Pass@1234", 10);

  // ── Vendors ──
  const vendors = [
    { name: "Dell Thailand", contactName: "ฝ่ายขายองค์กร", phone: "02-000-1111", email: "sales@dell.co.th" },
    { name: "iStudio by Comseven", phone: "02-000-2222" },
    { name: "SVOA Public Co.", phone: "02-000-3333" },
    { name: "Microsoft (Reseller)", email: "licensing@partner.co.th" },
  ];
  for (const v of vendors) await prisma.vendor.upsert({ where: { name: v.name }, update: {}, create: v });
  const V = Object.fromEntries((await prisma.vendor.findMany()).map((v) => [v.name, v.id]));

  // ── ผู้ใช้ตัวอย่าง (รวม MANAGER สำหรับ approval) ──
  const users = [
    { email: "wirat@company.local", fullName: "วิรัตน์ ผู้จัดการ", role: "MANAGER", departmentId: dept["ผู้บริหาร"], locationId: loc["สำนักงานใหญ่ (กรุงเทพ)"] },
    { email: "wichai@company.local", fullName: "วิชัย ช่าง", role: "AGENT", departmentId: dept["IT"] },
    { email: "somchai@company.local", fullName: "สมชาย IT", role: "AGENT", departmentId: dept["IT"] },
    { email: "somying@company.local", fullName: "สมหญิง วงษ์ดี", role: "USER", departmentId: dept["HR"] },
    { email: "manee@company.local", fullName: "มานี รักดี", role: "USER", departmentId: dept["บัญชี/การเงิน"] },
    { email: "prasit@company.local", fullName: "ประสิทธิ์ มั่นคง", role: "USER", departmentId: dept["ฝ่ายขาย"] },
  ];
  for (const u of users) await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash: pw } });
  const U = Object.fromEntries((await prisma.user.findMany()).map((u) => [u.email, u.id]));

  // กำหนดหัวหน้า (manager) ให้ user ทั่วไป → routing approval
  await prisma.user.updateMany({ where: { role: "USER" }, data: { managerId: U["wirat@company.local"] } });

  // ── ทรัพย์สินตัวอย่าง ──
  const assets = [
    { assetTag: "PC-HR-003", typeId: type["Desktop"], brand: "Dell", model: "OptiPlex 7090", serialNo: "DLTBX4321", hostname: "PC-HR-003", ipAddress: "192.168.1.103", os: "Windows 11 Pro", specification: "i5-11500, 16GB, SSD 512GB", status: "REPAIR", locationText: "ชั้น 2 ห้อง HR-201", ownerId: U["somying@company.local"], departmentId: dept["HR"], vendorId: V["Dell Thailand"], purchaseDate: new Date("2023-03-15"), purchasePrice: 28500, poNumber: "PO-2023-0142", warrantyExpiry: new Date("2026-03-15"), usefulLifeMonths: 60 },
    { assetTag: "NB-MGR-002", typeId: type["Notebook"], brand: "Apple", model: "MacBook Pro 14", serialNo: "C02XG2KJJGH5", hostname: "NB-MGR-002", os: "macOS Sonoma", specification: "M3 Pro, 18GB, SSD 512GB", status: "IN_USE", ownerId: U["wirat@company.local"], departmentId: dept["ผู้บริหาร"], vendorId: V["iStudio by Comseven"], purchaseDate: new Date("2023-06-10"), purchasePrice: 89900, warrantyExpiry: new Date("2026-06-22"), usefulLifeMonths: 48 },
    { assetTag: "PRN-ACC-01", typeId: type["Printer"], brand: "HP", model: "LaserJet Pro M428fdn", serialNo: "CNBJ239841", status: "IN_USE", departmentId: dept["บัญชี/การเงิน"], vendorId: V["SVOA Public Co."], purchaseDate: new Date("2022-01-01"), purchasePrice: 12900, warrantyExpiry: new Date("2024-12-31") },
    { assetTag: "SRV-001", typeId: type["Server"], brand: "Dell", model: "PowerEdge R750", serialNo: "7XYZABC1234", hostname: "SRV-PROD-01", ipAddress: "192.168.1.10", os: "Windows Server 2022", specification: "Xeon Silver, 64GB, 2TB RAID", status: "IN_USE", departmentId: dept["IT"], vendorId: V["Dell Thailand"], purchaseDate: new Date("2021-06-15"), purchasePrice: 185000, warrantyExpiry: new Date("2026-06-15"), usefulLifeMonths: 60 },
    { assetTag: "PC-FIN-007", typeId: type["Desktop"], brand: "HP", model: "EliteDesk 800 G6", serialNo: "HPED800712", hostname: "PC-FIN-007", ipAddress: "192.168.1.107", os: "Windows 11 Pro", status: "IN_USE", departmentId: dept["บัญชี/การเงิน"], purchaseDate: new Date("2023-08-01"), purchasePrice: 26000, warrantyExpiry: new Date("2026-06-28"), usefulLifeMonths: 60 },
    { assetTag: "MON-HR-003", typeId: type["Monitor"], brand: "Dell", model: 'P2422H 24"', serialNo: "DLMON2422", status: "IN_USE", departmentId: dept["HR"], purchaseDate: new Date("2023-03-15"), purchasePrice: 5900, warrantyExpiry: new Date("2027-03-15") },
    { assetTag: "SW-CORE-01", typeId: type["Network Equipment"], brand: "Cisco", model: "Catalyst 2960X", serialNo: "CSCO2960X1", ipAddress: "192.168.1.2", status: "IN_USE", departmentId: dept["IT"], purchaseDate: new Date("2022-05-20"), purchasePrice: 45000, warrantyExpiry: new Date("2027-05-20") },
    { assetTag: "NB-SALE-005", typeId: type["Notebook"], brand: "Lenovo", model: "ThinkPad E14", serialNo: "LNVE14005", hostname: "NB-SALE-005", os: "Windows 11 Pro", status: "IN_STOCK", locationText: "คลังอะไหล่", purchaseDate: new Date("2024-01-10"), purchasePrice: 24500, warrantyExpiry: new Date("2027-01-10") },
  ];
  for (const a of assets) await prisma.asset.upsert({ where: { assetTag: a.assetTag }, update: {}, create: a });
  const A = Object.fromEntries((await prisma.asset.findMany()).map((a) => [a.assetTag, a.id]));

  // ── Contracts ──
  const contracts = [
    { contractNo: "CT-2024-001", name: "MA Server PowerEdge", type: "MAINTENANCE", vendorId: V["Dell Thailand"], startDate: new Date("2024-06-15"), endDate: new Date("2025-06-15"), value: 35000 },
    { contractNo: "CT-2024-002", name: "Microsoft 365 Subscription", type: "SUBSCRIPTION", vendorId: V["Microsoft (Reseller)"], startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), value: 360000, autoRenew: true },
  ];
  for (const c of contracts) await prisma.contract.upsert({ where: { contractNo: c.contractNo }, update: {}, create: c });

  // ── Software Licenses ──
  const lics = [
    { name: "Microsoft 365 Business Standard", publisher: "Microsoft", vendorId: V["Microsoft (Reseller)"], totalSeats: 50, expiry: new Date("2026-12-31"), cost: 360000 },
    { name: "Adobe Acrobat Pro", publisher: "Adobe", totalSeats: 10, expiry: new Date("2026-09-30"), cost: 65000 },
    { name: "Windows 11 Pro (Volume)", publisher: "Microsoft", totalSeats: 100, cost: 0 },
  ];
  for (const l of lics) {
    const exists = await prisma.softwareLicense.findFirst({ where: { name: l.name } });
    if (!exists) {
      const created = await prisma.softwareLicense.create({ data: l });
      // มอบ seat ตัวอย่าง
      if (l.name.includes("365")) {
        for (const e of ["somying@company.local", "manee@company.local", "prasit@company.local", "wirat@company.local"]) {
          await prisma.licenseAssignment.create({ data: { licenseId: created.id, userId: U[e] } }).catch(() => {});
        }
      }
    }
  }

  // ── Knowledge Base ──
  const articles = [
    { title: "วิธีรีเซ็ตรหัสผ่าน Windows ด้วยตัวเอง", categoryId: kbCat["เริ่มต้นใช้งาน"], tags: "password,windows,login", summary: "ขั้นตอนรีเซ็ตรหัสผ่านเบื้องต้น", body: "1. ที่หน้า login คลิก 'ลืมรหัสผ่าน'\n2. ยืนยันตัวตนผ่านอีเมลองค์กร\n3. ตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัว มีตัวเลขและอักษรพิมพ์ใหญ่)\n4. หากยังเข้าไม่ได้ ติดต่อ IT ที่เบอร์ภายใน 1234" },
    { title: "ตั้งค่า VPN สำหรับทำงานจากบ้าน (WFH)", categoryId: kbCat["เครือข่าย & VPN"], tags: "vpn,wfh,remote", summary: "เชื่อมต่อ VPN องค์กรจากภายนอก", body: "1. ติดตั้งโปรแกรม FortiClient\n2. กรอก Gateway: vpn.company.local\n3. ใช้ username/password เดียวกับเข้าคอมฯ\n4. กด Connect — ไฟเขียวคือเชื่อมต่อสำเร็จ" },
    { title: "เพิ่มอีเมลองค์กรในมือถือ (Outlook)", categoryId: kbCat["อีเมล & Office"], tags: "email,outlook,mobile,office365", summary: "ตั้งค่า Outlook บนมือถือ", body: "1. ติดตั้งแอป Microsoft Outlook\n2. เพิ่มบัญชี → กรอกอีเมล @company.local\n3. ใส่รหัสผ่าน + ยืนยัน MFA\n4. รอ sync เมล" },
    { title: "ปริ้นเตอร์ไม่พิมพ์ — แก้ไขเบื้องต้น", categoryId: kbCat["ฮาร์ดแวร์"], tags: "printer,hardware", published: true, summary: "ตรวจสอบ 5 ขั้นก่อนแจ้งซ่อม", body: "1. ตรวจไฟและสาย\n2. เคลียร์งานค้างใน print queue\n3. ตรวจกระดาษ/หมึก\n4. restart เครื่องปริ้น\n5. ถ้ายังไม่ได้ แจ้งซ่อมผ่านระบบ พร้อมรหัส Asset" },
    { title: "นโยบายความปลอดภัยรหัสผ่าน", categoryId: kbCat["ความปลอดภัย"], tags: "security,policy", summary: "ข้อกำหนดรหัสผ่านองค์กร", body: "- อย่างน้อย 8 ตัวอักษร\n- ผสมตัวพิมพ์ใหญ่/เล็ก ตัวเลข อักขระพิเศษ\n- เปลี่ยนทุก 90 วัน\n- ห้ามใช้ซ้ำ 3 ครั้งล่าสุด\n- เปิด MFA ทุกบัญชี" },
  ];
  for (const a of articles) {
    const exists = await prisma.kbArticle.findFirst({ where: { title: a.title } });
    if (!exists) await prisma.kbArticle.create({ data: { ...a, published: a.published ?? true, authorId: U["somchai@company.local"] } });
  }

  // ── Tickets ตัวอย่าง (เพิ่มเฉพาะถ้ายังไม่มี) ──
  if ((await prisma.ticket.count()) === 0) {
    const catalogItems = Object.fromEntries((await prisma.serviceCatalogItem.findMany()).map((c) => [c.name, c]));
    const tickets = [
      { type: "INCIDENT", subject: "คอมพิวเตอร์เปิดไม่ติด", description: "กดปุ่มเปิดเครื่องแล้วไฟไม่ขึ้น ไม่มีเสียงพัดลม", priority: "HIGH", categoryId: cat["Hardware"], status: "IN_PROGRESS", requester: "somying@company.local", assignee: "wichai@company.local", asset: "PC-HR-003", breach: true },
      { type: "INCIDENT", subject: "ปริ้นเตอร์ไม่ยอม print เอกสาร", description: "งานค้างใน queue ไฟกระพริบสีส้ม", priority: "MEDIUM", categoryId: cat["Printer / Scanner"], status: "ASSIGNED", requester: "manee@company.local", assignee: "wichai@company.local", asset: "PRN-ACC-01" },
      { type: "INCIDENT", subject: "อินเทอร์เน็ตช้ามาก ใช้งานไม่ได้", description: "ทั้งชั้น 3 เน็ตช้าตั้งแต่เช้า", priority: "MEDIUM", categoryId: cat["Network / อินเทอร์เน็ต"], status: "NEW", requester: "prasit@company.local" },
      { type: "INCIDENT", subject: "ลืมรหัสผ่าน Windows", description: "เข้าเครื่องไม่ได้", priority: "LOW", categoryId: cat["Account / Password"], status: "RESOLVED", requester: "manee@company.local", assignee: "somchai@company.local", asset: "PC-FIN-007", sat: 5 },
      { type: "SERVICE_REQUEST", subject: "ขอสิทธิ์เข้าโฟลเดอร์ฝ่ายขาย", description: "ขอสิทธิ์อ่าน/เขียนโฟลเดอร์ Sales", priority: "MEDIUM", catalog: "ขอสิทธิ์เข้าระบบ", status: "AWAITING_APPROVAL", requester: "prasit@company.local", approval: true },
      { type: "SERVICE_REQUEST", subject: "ขอติดตั้งโปรแกรม Zoom", description: "ใช้ประชุมกับลูกค้า", priority: "LOW", catalog: "ขอติดตั้งโปรแกรม", status: "NEW", requester: "prasit@company.local" },
    ];

    for (const t of tickets) {
      const { responseDueAt, resolveDueAt } = await computeSlaDeadlines(t.priority, t.categoryId);
      const ci = t.catalog ? catalogItems[t.catalog] : null;
      await prisma.$transaction(async (tx) => {
        const ticketNo = await nextTicketNo(tx);
        const created = await tx.ticket.create({
          data: {
            ticketNo, type: t.type, subject: t.subject, description: t.description, priority: t.priority,
            categoryId: t.categoryId || null, catalogId: ci?.id || null, status: t.status,
            requesterId: U[t.requester], assigneeId: t.assignee ? U[t.assignee] : null,
            assetId: t.asset ? A[t.asset] : null, responseDueAt, resolveDueAt,
            slaBreached: t.breach || false,
            resolvedAt: ["RESOLVED", "CLOSED"].includes(t.status) ? new Date() : null,
            satisfaction: t.sat || null,
          },
        });
        if (t.assignee) await tx.ticketComment.create({ data: { ticketId: created.id, authorId: U[t.assignee], body: "รับเรื่องแล้ว กำลังตรวจสอบครับ" } });
        if (t.approval) await tx.approval.create({ data: { ticketId: created.id, approverId: U["wirat@company.local"] } });
      });
    }
  }

  const counts = {
    users: await prisma.user.count(), assets: await prisma.asset.count(), tickets: await prisma.ticket.count(),
    vendors: await prisma.vendor.count(), licenses: await prisma.softwareLicense.count(),
    contracts: await prisma.contract.count(), kb: await prisma.kbArticle.count(), approvals: await prisma.approval.count(),
  };
  console.log("✅ Demo data พร้อม:", counts);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
