// src/routes/auth.js - 认证相关路由
const express = require('express')
const rateLimit = require('express-rate-limit')
const db = require('../db')
const { hashPassword, verifyPassword, generateToken, ok, fail } = require('../utils')

const router = express.Router()

// 登录限流：每IP每15分钟10次
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, msg: '登录尝试过多，请15分钟后再试' },
})

// POST /api/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return fail(res, 400, '请输入用户名和密码')

    const admin = await db.getOne('SELECT * FROM admins WHERE username = ?', [username])
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return fail(res, 401, '用户名或密码错误')
    }

    const token = generateToken({
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name,
    })

    ok(res, { token, username: admin.username, displayName: admin.display_name })
  } catch (err) {
    console.error('[Auth] Login error:', err)
    fail(res, 500, '登录失败')
  }
})

// PUT /api/admin/password
router.put('/admin/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword) return fail(res, 400, '请填写完整')
    if (newPassword.length < 6) return fail(res, 400, '新密码至少6位')

    const admin = await db.getOne('SELECT * FROM admins WHERE id = ?', [req.admin.id])
    if (!admin || !verifyPassword(oldPassword, admin.password_hash)) {
      return fail(res, 401, '原密码错误')
    }

    await db.query(
      'UPDATE admins SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [hashPassword(newPassword), req.admin.id]
    )
    ok(res, null, '密码修改成功')
  } catch (err) {
    console.error('[Auth] Password change error:', err)
    fail(res, 500, '密码修改失败')
  }
})

module.exports = router
