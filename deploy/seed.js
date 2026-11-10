// Seed ข้อมูลตั้งต้น — รันด้วย: npm run seed
// สร้าง: แผนก, หมวดหมู่, ประเภททรัพย์สิน, SLA, และผู้ใช้ admin เริ่มต้น
require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/db");

async function main() {
  console.log("🌱 เริ่ม seed ข้อมูลตั้งต้น...");

  // ─── แผนก ───
  const deptNames = ["IT", "HR", "บัญชี/การเงิน", "ฝ่ายขาย", "ฝ่ายผลิต", "ผู้บริหาร"];
  for (const name of deptNames) {
    await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
  }

  // ─── หมวดหมู่ปัญหา ───
  const categories = [
    { name: "Hardware", icon: "💻" },
    { name: "Software / OS", icon: "🪟" },
    { name: "Network / อินเทอร์เน็ต", icon: "🌐" },
    { name: "Printer / Scanner", icon: "🖨️" },
    { name: "Account / Password", icon: "🔑" },
    { name: "Email / Office365", icon: "📧" },
    { name: "Security", icon: "🔒" },
    { name: "อื่น ๆ", icon: "📦" },
  ];
  for (const c of categories) {
    await prisma.category.upsert({ where: { name: c.name }, update: { icon: c.icon }, create: c });
  }

  // ─── ประเภททรัพย์สิน ───
  const types = [
    { name: "Desktop", icon: "💻" },
    { name: "Notebook", icon: "💼" },
    { name: "Monitor", icon: "🖥️" },
    { name: "Printer", icon: "🖨️" },
    { name: "Scanner", icon: "📷" },
    { name: "Server", icon: "🖥️" },
    { name: "Network Equipment", icon: "🌐" },
    { name: "Mobile / Tablet", icon: "📱" },
    { name: "Software License", icon: "📄" },
    { name: "อื่น ๆ", icon: "🔌" },
  ];
  for (const t of types) {
    await prisma.assetType.upsert({ where: { name: t.name }, update: { icon: t.icon }, create: t });
  }

  // ─── SLA policies (รายระดับความสำคัญ, ไม่ผูก category) ───
  const sla = [
    { priority: "CRITICAL", responseMinutes: 15, resolveMinutes: 240 },
    { priority: "HIGH", responseMinutes: 30, resolveMinutes: 480 },
    { priority: "MEDIUM", responseMinutes: 60, resolveMinutes: 1440 },
    { priority: "LOW", responseMinutes: 240, resolveMinutes: 2880 },
  ];
  for (const s of sla) {
    const existing = await prisma.slaPolicy.findFirst({ where: { categoryId: null, priority: s.priority } });
    if (!existing) await prisma.slaPolicy.create({ data: s });
  }

  // ─── หมวดหมู่ Knowledge Base ───
  const kbCats = [
    { name: "เริ่มต้นใช้งาน", icon: "🚀" },
    { name: "อีเมล & Office", icon: "📧" },
    { name: "เครือข่าย & VPN", icon: "🌐" },
    { name: "ฮาร์ดแวร์", icon: "💻" },
    { name: "ความปลอดภัย", icon: "🔒" },
  ];
  for (const c of kbCats) {
    await prisma.kbCategory.upsert({ where: { name: c.name }, update: { icon: c.icon }, create: c });
  }

  // ─── Service Catalog ───
  const catalog = [
    { name: "ขอติดตั้งโปรแกรม", description: "ขอติดตั้งซอฟต์แวร์ที่ได้รับอนุญาต", icon: "📦", requiresApproval: false },
    { name: "ขอสิทธิ์เข้าระบบ", description: "ขอสิทธิ์เข้าถึงระบบ/โฟลเดอร์", icon: "🔑", requiresApproval: true },
    { name: "ขออุปกรณ์ใหม่", description: "ขอคอมพิวเตอร์/อุปกรณ์ IT ใหม่", icon: "🖥️", requiresApproval: true },
    { name: "ขอ Email/Account ใหม่", description: "สร้างบัญชีอีเมลพนักงานใหม่", icon: "📧", requiresApproval: true },
    { name: "รีเซ็ตรหัสผ่าน", description: "ขอรีเซ็ตรหัสผ่านระบบ", icon: "🔄", requiresApproval: false },
  ];
  for (const c of catalog) {
    const exists = await prisma.serviceCatalogItem.findFirst({ where: { name: c.name } });
    if (!exists) await prisma.serviceCatalogItem.create({ data: c });
  }

  // ─── สถานที่ (Location) ───
  const locations = ["สำนักงานใหญ่ (กรุงเทพ)", "โรงงานสมุทรปราการ", "คลังอะไหล่/สำรอง"];
  for (const name of locations) {
    const exists = await prisma.location.findFirst({ where: { name } });
    if (!exists) await prisma.location.create({ data: { name } });
  }

  // ─── เวลาทำการ (จ-ศ 08:30-17:30) ───
  for (let d = 0; d <= 6; d++) {
    const working = d >= 1 && d <= 5;
    await prisma.businessHours.upsert({
      where: { dayOfWeek: d },
      update: {},
      create: { dayOfWeek: d, startTime: "08:30", endTime: "17:30", isWorking: working },
    });
  }

  // ─── ผู้ใช้ admin เริ่มต้น ───
  const itDept = await prisma.department.findUnique({ where: { name: "IT" } });
  const adminEmail = "admin@company.local";
  const adminPass = "Admin@1234"; // ⚠️ เปลี่ยนทันทีหลัง login ครั้งแรก
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPass, 10),
      fullName: "ผู้ดูแลระบบ",
      role: "ADMIN",
      departmentId: itDept?.id,
    },
  });

  console.log("✅ Seed เสร็จสิ้น");
  console.log(`   Admin login: ${adminEmail} / ${adminPass}`);
  console.log("   ⚠️  กรุณาเปลี่ยนรหัสผ่าน admin ทันทีหลังเข้าระบบครั้งแรก");
}

main()
  .catch((e) => {
    console.error("❌ Seed ผิดพลาด:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
