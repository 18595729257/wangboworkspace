// src/utils.js - 工具函数
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const path = require('path')
const fs = require('fs')

const JWT_SECRET = process.env.JWT_SECRET || 'print-admin-secret-key-change-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

// 密码哈希（使用 scrypt，与历史数据兼容）
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const buf = Buffer.from(hash, 'hex')
  const derived = crypto.scryptSync(password, salt, 64)
  return buf.length === derived.length && crypto.timingSafeEqual(buf, derived)
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

function nowStr() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function generateOrderNo() {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const ts = now.replace(/[-: ]/g, '').substring(0, 14)
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `P${ts}${rand}`
}

const STATUS_TEXT = {
  pending: '待支付',
  paid: '已支付',
  printing: '打印中',
  completed: '已完成',
  cancelled: '已取消',
  print_failed: '打印失败',
}
function statusText(status) {
  return STATUS_TEXT[status] || status
}

// 统一响应格式
function ok(res, data, msg = '成功') {
  res.json({ code: 200, data, msg })
}
function fail(res, code, msg) {
  res.json({ code, msg })
}
function notFound(res, msg = '资源不存在') {
  res.json({ code: 404, msg })
}

// 安全文件名
function safeFileName(originalName) {
  const ext = path.extname(originalName).toLowerCase()
  const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.txt', '.rtf']
  const safeExt = allowed.includes(ext) ? ext : '.bin'
  return Date.now() + '_' + Math.random().toString(36).substr(2, 8) + safeExt
}

// 上海时区日期
function shanghaiDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

// 上海时区日期时间字符串
function shanghaiNow() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T')
}

// Buffer 中查找子 Buffer（multipart 解析用）
function indexOfBuf(buf, sub, start = 0) {
  outer:
  for (let i = start; i <= buf.length - sub.length; i++) {
    for (let j = 0; j < sub.length; j++) {
      if (buf[i + j] !== sub[j]) continue outer
    }
    return i
  }
  return -1
}

// 从 Buffer 中查找子 Buffer（兼容版）
function findInBuffer(buf, needle, start = 0) {
  const n = Buffer.from(needle)
  for (let i = start; i <= buf.length - n.length; i++) {
    let match = true
    for (let j = 0; j < n.length; j++) {
      if (buf[i + j] !== n[j]) { match = false; break }
    }
    if (match) return i
  }
  return -1
}

// 检测 PDF 页数
function detectPdfPages(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    const text = buf.toString('latin1')
    const matches = text.match(/\/Type\s*\/Page[^s]/g) || []
    return matches.length > 0 ? matches.length : 1
  } catch {
    return 1
  }
}

// 统一域名（避免证书问题）
function normalizeHost(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const forwardedHost = req.headers['x-forwarded-host'] || ''
  const isIpOnly = /^\d+\.\d+\.\d+\.\d+$/.test(forwardedHost)
  const host = (forwardedHost && !isIpOnly) ? forwardedHost : 'xinbingcloudprint.top'
  return { proto, host, url: (proto) + '://' + host }
}

module.exports = {
  hashPassword, verifyPassword, generateToken, verifyToken,
  nowStr, generateOrderNo, statusText,
  ok, fail, notFound,
  safeFileName, detectPdfPages, normalizeHost,
  shanghaiDate, shanghaiNow,
  indexOfBuf, findInBuffer,
}
