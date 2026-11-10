// ตั้งรหัสผ่าน admin ใหม่ (เรียกจาก install.ps1) — อ่านรหัสจาก env NEW_ADMIN_PASS
// ใช้นโยบายรหัสผ่านเดียวกับระบบ + bcrypt
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const prisma = require("../src/db");
const { passwordIssues } = require("../src/utils/password");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@company.local";

(async () => {
  const pw = process.env.NEW_ADMIN_PASS;
  if (!pw) {
    console.error("✗ ไม่พบ NEW_ADMIN_PASS");
    process.exit(1);
  }
  const issues = passwordIssues(pw);
  if (issues.length) {
    console.error("✗ รหัสผ่านไม่ผ่านนโยบาย: " + issues.join(", "));
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.error(`✗ ไม่พบผู้ใช้ ${ADMIN_EMAIL}`);
    process.exit(3);
  }
  await prisma.user.update({
    where: { id: user.id },
    // bump sessionVersion เพื่อเพิกถอน token เดิมทั้งหมด เหมือนการรีเซ็ตรหัสผ่านผ่านหน้าเว็บ
    data: { passwordHash: await bcrypt.hash(pw, 10), failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
  });
  console.log(`✓ ตั้งรหัสผ่าน ${ADMIN_EMAIL} ใหม่เรียบร้อย`);
  process.exit(0);
})().catch((e) => {
  console.error("✗ ผิดพลาด:", e.message);
  process.exit(1);
});
