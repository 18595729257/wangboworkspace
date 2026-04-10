// src/routes/users.js - 用户管理
const express = require('express')
const db = require('../db')
const { ok, fail, notFound } = require('../utils')

const router = express.Router()

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword = '' } = req.query
    const conditions = [], params = []
    if (keyword) {
      conditions.push('(nickname LIKE ? OR openid LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const offset = (parseInt(page) - 1) * parseInt(pageSize)
    const limit = parseInt(pageSize)

    const [countRow, list] = await Promise.all([
      db.getOne(`SELECT COUNT(*) as total FROM users ${where}`, params),
      db.getPool().query(
        `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ).then(([rows]) => rows),
    ])

    ok(res, {
      list,
      total: countRow.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(countRow.total / parseInt(pageSize)),
    })
  } catch (err) {
    console.error('[Users] List error:', err)
    fail(res, 500, '获取用户列表失败')
  }
})

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.params.id])
  if (!user) return notFound(res, '用户不存在')

  const [orders, pointsRecords] = await Promise.all([
    db.query('SELECT * FROM orders WHERE openid = ? ORDER BY created_at DESC LIMIT 20', [user.openid]),
    db.query('SELECT * FROM points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]),
  ])

  ok(res, { ...user, orders, pointsRecords })
})

// POST /api/users/:id/points
router.post('/:id/points', async (req, res) => {
  const { points, reason = '管理员调整' } = req.body
  if (typeof points !== 'number' || points === 0) return fail(res, 400, '请输入有效的积分数')

  const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.params.id])
  if (!user) return notFound(res, '用户不存在')
  if (points < 0 && user.points + points < 0) {
    return fail(res, 400, `用户当前积分 ${user.points}，不足扣除`)
  }

  await db.transaction(async (conn) => {
    await conn.query(
      'UPDATE users SET points = points + ?, updated_at = NOW() WHERE id = ?',
      [points, req.params.id]
    )
    await conn.query(
      `INSERT INTO points_records (user_id, openid, type, points, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [user.id, user.openid, points > 0 ? 'admin_add' : 'admin_deduct', Math.abs(points), reason]
    )
  })

  ok(res, null, '积分调整成功')
})

module.exports = router
