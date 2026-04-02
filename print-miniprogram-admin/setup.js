// setup.js - MySQL 数据库初始化（含索引优化）
require('dotenv').config();
const mysql = require('mysql2/promise');
const { hashPassword } = require('./src/utils');

async function setup() {
  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };

  const dbName = process.env.DB_NAME || 'print_admin';

  console.log('正在连接 MySQL...');
  const conn = await mysql.createConnection(config);

  // 创建数据库
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  console.log(`数据库 ${dbName} 已就绪\n`);

  // ===== 建表 =====
  console.log('正在创建数据表...');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      password_hash VARCHAR(256) NOT NULL,
      display_name VARCHAR(128) DEFAULT '管理员',
      role VARCHAR(32) DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      openid VARCHAR(128) UNIQUE NOT NULL,
      nickname VARCHAR(128) DEFAULT '未命名用户',
      avatar_url VARCHAR(512) DEFAULT '',
      points INT DEFAULT 0,
      total_spent DECIMAL(10,2) DEFAULT 0,
      order_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_openid (openid),
      INDEX idx_points (points),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS printers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      status ENUM('idle','busy','offline') DEFAULT 'idle',
      port VARCHAR(64) DEFAULT '',
      description VARCHAR(256) DEFAULT '',
      client_id VARCHAR(128) DEFAULT '',
      last_heartbeat DATETIME DEFAULT NULL,
      total_jobs INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(32) UNIQUE NOT NULL,
      openid VARCHAR(128) DEFAULT '',
      file_name VARCHAR(256) DEFAULT '',
      file_url VARCHAR(512) DEFAULT '',
      page_count INT DEFAULT 1,
      copies INT DEFAULT 1,
      color_mode ENUM('bw','color') DEFAULT 'bw',
      paper_size VARCHAR(16) DEFAULT 'A4',
      print_fee DECIMAL(10,2) DEFAULT 0,
      service_fee DECIMAL(10,2) DEFAULT 0.10,
      total_fee DECIMAL(10,2) DEFAULT 0,
      points_used INT DEFAULT 0,
      points_discount DECIMAL(10,2) DEFAULT 0,
      actual_pay DECIMAL(10,2) DEFAULT 0,
      status ENUM('pending','paid','printing','completed','cancelled') DEFAULT 'pending',
      order_type VARCHAR(32) DEFAULT 'print',
      extra_info TEXT DEFAULT NULL,
      printer_id INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pay_time DATETIME DEFAULT NULL,
      print_start_time DATETIME DEFAULT NULL,
      print_end_time DATETIME DEFAULT NULL,
      INDEX idx_order_no (order_no),
      INDEX idx_openid (openid),
      INDEX idx_status (status),
      INDEX idx_created (created_at),
      INDEX idx_printer (printer_id),
      INDEX idx_status_created (status, created_at),
      INDEX idx_openid_created (openid, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS points_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      openid VARCHAR(128) DEFAULT '',
      type ENUM('earn','deduct','admin_add','admin_deduct') DEFAULT 'earn',
      points INT DEFAULT 0,
      reason VARCHAR(256) DEFAULT '',
      order_no VARCHAR(32) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_openid (openid),
      INDEX idx_created (created_at),
      INDEX idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS config (
      \`key\` VARCHAR(128) PRIMARY KEY,
      \`value\` TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('数据表创建完成 ✓');

  // ===== 数据库迁移：补充字段 =====
  const migrations = [
    "ALTER TABLE printers ADD COLUMN client_id VARCHAR(128) DEFAULT '' AFTER description",
    "ALTER TABLE printers ADD COLUMN last_heartbeat DATETIME DEFAULT NULL AFTER client_id",
    "ALTER TABLE printers ADD COLUMN tags VARCHAR(256) DEFAULT 'normal' AFTER last_heartbeat",
    "ALTER TABLE orders ADD COLUMN print_tag VARCHAR(32) DEFAULT 'normal' AFTER order_type",
    "ALTER TABLE orders ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    "ALTER TABLE orders MODIFY COLUMN status ENUM('pending','paid','printing','completed','cancelled','print_failed') DEFAULT 'pending'",
  ];

  for (const sql of migrations) {
    try {
      await conn.query(sql);
    } catch (e) {
      // 字段已存在时忽略
      if (!e.message.includes('Duplicate column')) {
        console.warn('迁移警告:', e.message.substring(0, 80));
      }
    }
  }
  console.log('数据库迁移完成 ✓');

  // ===== 创建默认管理员 =====
  const password = 'admin123';
  const hash = hashPassword(password);
  await conn.query(
    'INSERT IGNORE INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    ['admin', hash, '管理员', 'admin']
  );
  console.log('默认管理员: admin / admin123');

  // ===== 创建默认打印机 =====
  await conn.query(
    'INSERT IGNORE INTO printers (name, status, port, description) VALUES (?, ?, ?, ?)',
    ['打印机-01', 'idle', 'USB001', '前台打印机']
  );
  await conn.query(
    'INSERT IGNORE INTO printers (name, status, port, description) VALUES (?, ?, ?, ?)',
    ['打印机-02', 'idle', 'USB002', '后台打印机']
  );
  console.log('默认打印机已创建');

  // ===== 默认配置 =====
  const configs = [
    ['shop_name', '智能打印店'],
    ['shop_address', ''],
    ['shop_phone', ''],
    ['shop_notice', '营业时间 8:00-22:00 · 支持微信支付'],
    ['price_bw', '0.1'],
    ['price_color', '0.5'],
    ['service_fee', '0.1'],
    ['enable_points', '1'],
    ['points_earn_rate', '1'],
    ['points_deduct_rate', '100'],
    ['max_points_discount', '5'],
    ['enable_payment', '1'],
    ['enable_print', '1'],
    // 证件复印
    ['enable_idcard', '1'],
    ['idcard_bw_price', '0.5'],
    ['idcard_color_price', '1.0'],
    // 照片打印
    ['enable_photo', '1'],
    ['photo_direct_1_price', '0.5'],
    ['photo_direct_2_price', '0.8'],
    ['photo_bg_1_price', '1.0'],
    ['photo_bg_2_price', '1.5'],
    ['photo_suit_1_price', '3.0'],
    ['photo_suit_2_price', '5.0'],
    ['photo_life_5_price', '0.5'],
    ['photo_life_6_price', '0.8'],
    // 工厂发货
    ['enable_factory', '1'],
    ['factory_price', '0.05'],
    ['factory_deadline', '17:00'],
    ['factory_delivery_note', '每天17:00前订单当天发走，全国多地次日达'],
  ];

  for (const [key, value] of configs) {
    await conn.query(
      'INSERT IGNORE INTO config (`key`, `value`) VALUES (?, ?)',
      [key, value]
    );
  }
  console.log('默认配置已写入');

  await conn.end();
  console.log('\n✅ 初始化完成！运行 npm start 启动服务');
}

setup().catch(err => {
  console.error('初始化失败:', err.message);
  process.exit(1);
});
