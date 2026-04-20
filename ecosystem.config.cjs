module.exports = {
  apps: [
    {
      name: "cloudflare-audit-watcher",
      script: "index.js",

      // process
      instances: 1,
      exec_mode: "fork",

      // lifecycle
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",

      // logging
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // env
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
