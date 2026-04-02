// src/utils.js - 工具函数
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// 密码哈希
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// 密码验证
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const buf = Buffer.from(hash, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  return buf.length === derived.length && crypto.timingSafeEqual(buf, derived);
}

// 当前时间字符串（Asia/Shanghai）
function nowStr() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// 生成订单号（Asia/Shanghai时间）
function generateOrderNo() {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const ts = now.replace(/[-: ]/g, '').substring(0, 14);
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `P${ts}${rand}`;
}

// 生成 JWT Token
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

// 验证 JWT Token
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// 状态文本
function statusText(s) {
  const map = { pending: '待支付', paid: '已支付', printing: '打印中', completed: '已完成', cancelled: '已取消' };
  return map[s] || s;
}

module.exports = { hashPassword, verifyPassword, generateOrderNo, nowStr, generateToken, verifyToken, statusText, JWT_SECRET };
