// config.js - 生产环境配置
const os = require('os')

module.exports = {
  // 云端API地址（使用域名+HTTPS）
  API_URL: 'https://xinbingcloudprint.top',

  // WebSocket地址（使用域名+WSS）
  WS_URL: 'wss://xinbingcloudprint.top/ws/printer',

  // 下载目录
  DOWNLOAD_DIR: './downloads',

  // 打印后保留文件（调试用）
  KEEP_FILES: false,

  // 客户端标识（每台电脑不同）
  CLIENT_ID: `printer-${os.hostname()}-${os.userInfo().username}`,

  // 轮询间隔（毫秒）
  POLL_INTERVAL: 10000,

  // 详细日志
  VERBOSE: true,

  // 日志目录
  LOG_DIR: './logs',
}
