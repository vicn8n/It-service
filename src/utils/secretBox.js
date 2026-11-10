// เข้ารหัส/ถอดรหัสค่าลับที่เก็บในฐานข้อมูล (AES-256-GCM) — คีย์สร้างจาก JWT_SECRET
const crypto = require("crypto");

const key = () => crypto.createHash("sha256").update(String(process.env.JWT_SECRET || "")).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

// คืน null ถ้าถอดรหัสไม่ได้ (เช่น JWT_SECRET เปลี่ยน)
function decrypt(payload) {
  try {
    const [iv, tag, enc] = String(payload).split(".").map((s) => Buffer.from(s, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
