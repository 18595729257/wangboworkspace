module.exports = {
  apps: [{
    name: 'print-admin',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    exp_backoff_restart_delay: 100,   // 崩溃后指数退避重试
    max_memory_restart: '512M',
    watch: false,

    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    // 日志
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,

    // 进程管理
    kill_timeout: 5000,
    wait_ready: false,

    // 负载均衡探活（配合 Nginx health_check）
    instance_var: 'INSTANCE_ID',
  }],
}
