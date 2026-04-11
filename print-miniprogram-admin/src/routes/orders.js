// src/routes/orders.js - 订单管理（升级版：支持所有状态重打 + 多文件）
const express = require('express')
const db = require('../db')
const cache = require('../cache')
const { ok, fail, notFound, statusText, shanghaiNow, shanghaiDate } = require('../utils')

const router = express.Router()
const VALID_STATUSES = ['pending', 'paid', 'printing', 'completed', 'cancelled', 'print_failed']

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const {
      page = 1, pageSize = 20,
      status = '', orderType = '', keyword = '',
      dateFrom = '', dateTo = ''
    } = req.query

    const conditions = [], params = []

    if (status)           { conditions.push('status = ?');       params.push(status) }
    if (orderType)        { conditions.push('order_type = ?');   params.push(orderType) }
    if (keyword) {
      conditions.push('(order_no LIKE ? OR file_name LIKE ? OR openid LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom) }
    if (dateTo)   { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59') }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const offset = (parseInt(page) - 1) * parseInt(pageSize)
    const limit = parseInt(pageSize)

    const [countRow, list] = await Promise.all([
      db.getOne(`SELECT COUNT(*) as total FROM orders ${where}`, params),
      db.getPool().query(
        `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ).then(([rows]) => rows),
    ])

    // 解析 files JSON 字段，补全 printSeq
    const ordersWithFiles = list.map(o => ({
      ...o,
      files: o.files ? (typeof o.files === 'string' ? JSON.parse(o.files) : o.files) : null,
      printSeq: o.order_seq ? String(o.order_seq).padStart(4, '0') : null,
    }))

    ok(res, {
      list: ordersWithFiles,
      total: countRow.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(countRow.total / parseInt(pageSize)),
    })
  } catch (err) {
    console.error('[Orders] List error:', err)
    fail(res, 500, '获取订单列表失败')
  }
})

// GET /api/orders/seq（必须在 /:id 之前！）
router.get('/seq', async (req, res) => {
  const today = shanghaiDate()
  const seq = await db.getOne('SELECT current_seq FROM order_sequences WHERE seq_date = ?', [today])
  ok(res, { date: today, currentSeq: seq?.current_seq || 0, nextSeq: (seq?.current_seq || 0) + 1 })
})

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!order) return notFound(res, '订单不存在')
  if (order.files) order.files = typeof order.files === 'string' ? JSON.parse(order.files) : order.files
  if (order.order_seq) order.printSeq = String(order.order_seq).padStart(4, '0')
  ok(res, order)
})

// PUT /api/orders/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    if (!VALID_STATUSES.includes(status)) return fail(res, 400, '无效状态')

    const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
    if (!order) return fail(res, 400, '订单不存在')

    await db.transaction(async (conn) => {
      const updates = { status }
      const now = shanghaiNow()

      if (status === 'paid' && !order.pay_time) updates.pay_time = now
      if (status === 'printing') {
        updates.print_start_time = order.print_start_time || now
        if (order.printer_id) {
          await conn.query(
            "UPDATE printers SET status = 'busy', total_jobs = total_jobs + 1, updated_at = ? WHERE id = ?",
            [now, order.printer_id]
          )
        }
      }
      if (status === 'completed') {
        updates.print_end_time = now
        const [configRows] = await conn.query('SELECT `key`, `value` FROM config')
        const config = {}
        configRows.forEach(r => { config[r.key] = r.value })

        if (config.enable_points === '1' && order.openid) {
          const pointsEarned = Math.floor(parseFloat(order.actual_pay))
          if (pointsEarned > 0) {
            const [userRows] = await conn.query('SELECT * FROM users WHERE openid = ?', [order.openid])
            const user = userRows[0]
            if (user) {
              await conn.query(
                'UPDATE users SET points = points + ?, order_count = order_count + 1, total_spent = total_spent + ?, updated_at = ? WHERE id = ?',
                [pointsEarned, parseFloat(order.actual_pay), now, user.id]
              )
              await conn.query(
                `INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (?, ?, 'earn', ?, ?, ?, ?)`,
                [user.id, order.openid, pointsEarned, `订单${order.order_no}消费奖励`, order.order_no, now]
              )
            }
          }
        }
        if (order.printer_id) {
          await conn.query("UPDATE printers SET status = 'idle', updated_at = ? WHERE id = ?", [now, order.printer_id])
        }
      }

      const setClauses = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ')
      await conn.query(`UPDATE orders SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id])
    })

    await cache.del('dashboard')

    // 当订单变成 printing 状态时，触发打印任务分配
    if (status === 'printing' && global.assignAndPushOrder) {
      try {
        const updated = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
        await global.assignAndPushOrder(updated)
      } catch (e) {
        console.error('[Orders] 手动改状态后分配任务失败:', e.message)
      }
    }

    ok(res, null, '状态更新成功')
  } catch (err) {
    console.error('[Orders] Update status error:', err)
    fail(res, 500, '更新失败')
  }
})

// PUT /api/orders/:id/assign-printer
router.put('/:id/assign-printer', async (req, res) => {
  const { printerId } = req.body
  const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!order) return notFound(res, '订单不存在')
  const printer = await db.getOne("SELECT * FROM printers WHERE id = ? AND status = 'idle'", [printerId])
  if (!printer) return fail(res, 400, '打印机不可用')

  await db.query('UPDATE orders SET printer_id = ? WHERE id = ?', [printerId, req.params.id])
  ok(res, null, '分配成功')
})

// GET /api/orders/export/csv
router.get('/export/csv', async (req, res) => {
  const { status = '', dateFrom = '', dateTo = '' } = req.query
  const conditions = [], params = []
  if (status)    { conditions.push('status = ?');       params.push(status) }
  if (dateFrom)  { conditions.push('created_at >= ?');  params.push(dateFrom) }
  if (dateTo)    { conditions.push('created_at <= ?');  params.push(dateTo + ' 23:59:59') }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const orders = await db.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params)

  const header = '订单号,文件名,页数,份数,颜色,打印费,服务费,实付金额,状态,序号,创建时间\n'
  const rows = orders.map(o =>
    `${o.order_no},${o.file_name},${o.page_count},${o.copies},` +
    `${o.color_mode === 'color' ? '彩色' : '黑白'},${o.print_fee},${o.service_fee},` +
    `${o.actual_pay},${statusText(o.status)},${o.order_seq || ''},${o.created_at}`
  ).join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.csv`)
  res.send('\uFEFF' + header + rows)
})

// ===== 【升级1】POST /api/orders/batch-reprint =====
// 支持所有状态订单重打：completed、print_failed、printing、paid、pending
router.post('/batch-reprint', async (req, res) => {
  try {
    const { orderIds, printerId } = req.body
    if (!orderIds?.length) return fail(res, 400, '请选择至少一个订单')
    if (!printerId) return fail(res, 400, '请选择打印机')

    const printer = await db.getOne('SELECT * FROM printers WHERE id = ?', [printerId])
    if (!printer) return fail(res, 400, '打印机不存在')

    const placeholders = orderIds.map(() => '?').join(',')
    const orders = await db.query(
      `SELECT * FROM orders WHERE id IN (${placeholders})`,
      orderIds
    )

    // 支持重打的状态：completed、print_failed、printing、paid
    // 不能重打的状态：cancelled（已取消）、pending（待支付）
    const reprintable = orders.filter(o =>
      ['completed', 'print_failed', 'printing', 'paid'].includes(o.status)
    )
    const skipped = orders.filter(o =>
      ['cancelled', 'pending'].includes(o.status)
    )

    if (reprintable.length === 0) {
      return fail(res, 400, '所选订单中没有可重打的订单（待支付、已取消的订单无法重打）')
    }

    const reprintIds = reprintable.map(o => o.id)
    const now = shanghaiNow()

    // 重置为 paid 状态（保持 printer_id），等待分配
    await db.query(
      `UPDATE orders SET status = 'paid', print_end_time = NULL, updated_at = ? WHERE id IN (${placeholders})`,
      [now, ...reprintIds]
    )

    // 推送任务
    let pushedCount = 0
    let failedCount = 0
    for (const order of reprintable) {
      try {
        const updated = await db.getOne('SELECT * FROM orders WHERE id = ?', [order.id])
        if (global.assignAndPushOrder) {
          const pushed = await global.assignAndPushOrder(updated)
          if (pushed) pushedCount++
          else failedCount++
        } else {
          failedCount++
        }
      } catch (e) {
        console.error('[Orders] 重打订单失败:', order.order_no, e.message)
        failedCount++
      }
    }

    const operator = req.admin?.username || 'admin'
    for (const order of reprintable) {
      await db.query(
        'INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (0, ?, "admin_add", 0, ?, ?, ?)',
        [order.openid, `管理员${operator}重打 → ${printer.name}`, order.order_no, now]
      )
    }

    await cache.del('dashboard')

    let msg = `重打完成：推送成功 ${pushedCount} 个`
    if (failedCount > 0) msg += `，失败 ${failedCount} 个`
    if (skipped.length > 0) msg += `，跳过 ${skipped.length} 个（待支付/已取消）`

    ok(res, {
      total: orders.length,
      reprinted: reprintable.length,
      pushed: pushedCount,
      failed: failedCount,
      skipped: skipped.length,
      printerName: printer.name
    }, msg)

  } catch (err) {
    console.error('[Orders] Batch reprint error:', err)
    fail(res, 500, '批量重打失败: ' + err.message)
  }
})



module.exports = router
