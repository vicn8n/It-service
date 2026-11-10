const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const _uploadCfg = process.env.UPLOAD_DIR || "./uploads";
// resolve relative path จาก project root เพื่อไม่ผูกกับ cwd
const UPLOAD_DIR = path.isAbsolute(_uploadCfg) ? _uploadCfg : path.join(PROJECT_ROOT, _uploadCfg);
const MAX_MB = Number(process.env.MAX_FILE_SIZE_MB || 10);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ชนิดที่รองรับ — นามสกุลกำหนดจากฝั่งเรา ไม่รับจากชื่อไฟล์ที่ผู้ใช้ส่งมา
// และตรวจ magic bytes หลังเขียนไฟล์ เพราะ mimetype ที่ client ส่งมาปลอมได้
const ALLOWED = new Map([
  ["image/png", { ext: ".png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/jpeg", { ext: ".jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/gif", { ext: ".gif", check: (b) => b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a" }],
  ["image/webp", { ext: ".webp", check: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" }],
  ["application/pdf", { ext: ".pdf", check: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" }],
]);

const TYPE_ERROR = "รองรับเฉพาะ PNG, JPG, GIF, WEBP, PDF";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // นามสกุลมาจากชนิดที่อนุญาตเท่านั้น กันไฟล์ .html/.svg/.js ถูกเสิร์ฟเป็นสคริปต์
    const ext = ALLOWED.get(file.mimetype)?.ext || ".bin";
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error(TYPE_ERROR), { status: 400, expose: true }));
  },
});

function removeFile(file) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {});
}

// ตรวจเนื้อไฟล์จริงหลัง multer เขียนลงดิสก์ — ต่อท้าย upload.single(...) เสมอ
async function verifyUpload(req, res, next) {
  if (!req.file) return next();
  const spec = ALLOWED.get(req.file.mimetype);
  if (!spec) {
    removeFile(req.file);
    return res.status(400).json({ error: TYPE_ERROR });
  }
  let head;
  try {
    const fh = await fs.promises.open(req.file.path, "r");
    try {
      const buf = Buffer.alloc(12);
      const { bytesRead } = await fh.read(buf, 0, 12, 0);
      head = buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch (error) {
    removeFile(req.file);
    return next(error);
  }
  if (!spec.check(head)) {
    removeFile(req.file);
    return res.status(400).json({ error: "เนื้อไฟล์ไม่ตรงกับชนิดที่ระบุ" });
  }
  return next();
}

// ชนิดที่ปลอดภัยพอจะแสดง inline ในเบราว์เซอร์ ที่เหลือบังคับดาวน์โหลด
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// หา Content-Type จากนามสกุลที่เราตั้งเอง ไม่เชื่อค่าที่บันทึกไว้ตอนอัปโหลด
// (.jpeg เป็นนามสกุลจากไฟล์ยุคก่อนที่ยังใช้ชื่อเดิมของผู้ใช้)
const EXT_TO_TYPE = new Map([...[...ALLOWED].map(([type, spec]) => [spec.ext, type]), [".jpeg", "image/jpeg"]]);

module.exports = { upload, verifyUpload, UPLOAD_DIR, INLINE_TYPES, EXT_TO_TYPE, ALLOWED };
