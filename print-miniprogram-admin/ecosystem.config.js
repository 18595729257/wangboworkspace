module.exports = {
  apps: [{
    name: 'print-admin',
    script: 'server.js',
    instances: 1,               // WebSocket 需要单进程
    exec_mode: 'fork',          // fork 模式，支持 WebSocket
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
};
