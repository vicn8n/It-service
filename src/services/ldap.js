// LDAP / Active Directory authentication (optional, config-driven)
// เปิดใช้ด้วย LDAP_ENABLED=true และตั้งค่า LDAP_* ใน .env
// ติดตั้ง dependency: npm install ldapjs
const prisma = require("../db");

const LDAP_ENABLED = process.env.LDAP_ENABLED === "true";

// lazy require — ไม่บังคับติดตั้ง ldapjs ถ้าไม่ได้เปิดใช้
let ldap = null;
if (LDAP_ENABLED) {
  try {
    ldap = require("ldapjs");
  } catch {
    console.error("[LDAP] เปิดใช้ LDAP แต่ยังไม่ได้ติดตั้ง ldapjs — รัน: npm install ldapjs");
  }
}

// bind ด้วย username/password กับ AD
function bind(dn, password) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({ url: process.env.LDAP_URL, timeout: 5000, connectTimeout: 5000 });
    client.on("error", reject);
    client.bind(dn, password, (err) => {
      client.unbind();
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// ลองยืนยันตัวตนกับ LDAP แล้ว upsert user ในระบบ
// คืน user object หรือ null ถ้าไม่ผ่าน
async function authenticate(email, password) {
  if (!LDAP_ENABLED || !ldap) return null;
  const domain = process.env.LDAP_DOMAIN || ""; // เช่น company.local
  const username = email.includes("@") ? email.split("@")[0] : email;
  const upn = email.includes("@") ? email : `${username}@${domain}`;

  try {
    await bind(upn, password); // AD รับ UPN เป็น bind DN ได้
  } catch {
    return null;
  }

  // upsert user — ผู้ใช้ LDAP ครั้งแรกจะถูกสร้างด้วย role USER
  const user = await prisma.user.upsert({
    where: { email: upn },
    update: { isActive: true },
    create: { email: upn, fullName: username, role: "USER", authProvider: "LDAP", passwordHash: null },
  });
  return user;
}

module.exports = { authenticate, LDAP_ENABLED };
