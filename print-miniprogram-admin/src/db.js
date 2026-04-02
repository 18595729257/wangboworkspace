// src/db.js - MySQL 连接池（支持高并发）
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'print_admin',
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 20,  // 连接池大小
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      // 超时设置
      connectTimeout: 10000,
      // 字符集
      charset: 'utf8mb4',
    });

    pool.on('connection', (conn) => {
      conn.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION'");
      conn.query("SET NAMES utf8mb4");
    });

    console.log('MySQL 连接池已创建，连接上限:', process.env.DB_POOL_SIZE || 20);
  }
  return pool;
}

// 执行查询（自动释放连接）
async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// 执行事务
async function transaction(callback) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// 获取单行
async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// 插入并返回ID
async function insert(sql, params = []) {
  const result = await query(sql, params);
  return result.insertId;
}

// 关闭连接池
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('MySQL 连接池已关闭');
  }
}

module.exports = { getPool, query, transaction, getOne, insert, close };
