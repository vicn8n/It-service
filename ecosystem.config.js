// PM2 process config — รันด้วย: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: "it-service-desk",
      script: "src/server.js",
      instances: 1, // เพิ่มเป็น "max" เพื่อ cluster mode (ต้องไม่ใช้ in-memory state)
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3200,
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      time: true,
    },
  ],
};
