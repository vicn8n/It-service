const crypto = require("crypto");

// ───────── Base32 (RFC 4648) ─────────
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// สร้าง secret ใหม่ (base32)
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

// HOTP (RFC 4226)
function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// TOTP (RFC 6238) — step 30s
function totp(secretB32, t = Date.now()) {
  return hotp(secretB32, Math.floor(t / 1000 / 30));
}

// ตรวจ token โดยยอมรับ ±window ช่วงเวลา (กันนาฬิกาเหลื่อม)
function verifyTOTP(secretB32, token, window = 1) {
  if (!token || !/^\d{6}$/.test(String(token).trim())) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  const t = String(token).trim();
  for (let i = -window; i <= window; i++) {
    if (hotp(secretB32, step + i) === t) return true;
  }
  return false;
}

// otpauth:// URI สำหรับ authenticator app
function otpauthURL(secretB32, label, issuer = "IT Service Desk") {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`;
}

module.exports = { generateSecret, totp, verifyTOTP, otpauthURL, base32Decode, base32Encode };
