// config.example.js - Windows 配置示例
// 复制为 config.js 并修改
const os = require('os')

module.exports = {
  // 云端API地址
  API_URL: 'http://121.43.241.95',

  // 下载目录
  DOWNLOAD_DIR: './downloads',

  // 打印后保留文件（调试用）
  KEEP_FILES: false,

  // 客户端标识（每台电脑不同，会自动生成）
  CLIENT_ID: `printer-${os.hostname()}-${os.userInfo().username}`,

  // ===== 打印机标签映射 =====
  // 先运行一次查看打印机名称，然后配置标签
  // 可用标签:
  //   normal - 普通黑白文档
  //   color  - 彩色文档
  //   photo  - 照片打印
  //   idcard - 证件复印
  TAG_MAPPING: {
    // === 示例配置（改成你的实际打印机名称）===

    // 普通黑白打印机
    'HP LaserJet Pro M404': ['normal'],

    // 彩色打印机
    'HP Color LaserJet Pro': ['normal', 'color'],

    // 照片打印机
    'Canon PIXMA G6080': ['photo', 'color'],

    // 证件照打印机
    // '证件照专用': ['idcard', 'photo'],

    // 全能打印机（什么都接）
    // 'Epson L3250': ['normal', 'color', 'photo'],
  },

  // 详细日志
  VERBOSE: process.argv.includes('--verbose'),
}
