// src/routes/printers.js - 打印机管理
const express = require('express')
const db = require('../db')
const { ok, fail, notFound } = require('../utils')

const router = express.Router()

// GET /api/printers
router.get('/', async (req, res) => {
  try {
    const printers = await db.query('SELECT * FROM printers ORDER BY id ASC')

    // 合并在线状态：优先用 WebSocket，否则用 HTTP 轮询的最后心跳
    const onlineIds = new Set()
    const httpActiveIds = new Set()
    
    // 1. WebSocket 在线
    if (global.printClients) {
      global.printClients.forEach((client) => {
        client.printers?.forEach(p => {
          onlineIds.add(`${client.clientId || ''}::${p.name}`)
        })
      })
    }
    
    // 2. HTTP 轮询活跃（5分钟内有心跳的也算在线）
    const httpActivePrinters = await db.query(
      "SELECT client_id, name FROM printers WHERE last_heartbeat > DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND client_id IS NOT NULL"
    )
    httpActivePrinters.forEach(p => {
      httpActiveIds.add(`${p.client_id}::${p.name}`)
    })

    const result = printers.map(p => {
      const key = `${p.client_id}::${p.name}`
      const isOnline = onlineIds.has(key) || httpActiveIds.has(key)
      return {
        ...p,
        online: isOnline,
        tags: p.tags ? p.tags.split(',') : ['normal'],
        entry_types: p.entry_types ? p.entry_types.split(',') : ['print'],
        enabled: p.enabled !== undefined ? p.enabled : 1,
        custom_tags: p.custom_tags ? p.custom_tags.split(',').filter(Boolean) : [],
      }
    })

    ok(res, result)
  } catch (err) {
    console.error('[Printers] List error:', err)
    fail(res, 500, '获取打印机列表失败')
  }
})

// GET /api/printers/online - 获取所有在线打印机（来自 WebSocket 连接）
router.get('/online', (req, res) => {
  if (!(global.printClients instanceof Map) || global.printClients.size === 0) {
    return ok(res, [])
  }
  const result = []
  global.printClients.forEach((client, clientId) => {
    client.printers?.forEach(p => {
      result.push({
        clientId,
        clientName: client.clientName,
        name: p.name,
        tags: p.tags || ['normal'],
        status: p.status || 'idle',
        totalJobs: p.totalJobs || 0,
        enabled: p.enabled !== undefined ? p.enabled : 1,
      })
    })
  })
  ok(res, result)
})

// POST /api/printers
router.post('/', async (req, res) => {
  const { name, port = '', description = '' } = req.body
  if (!name) return fail(res, 400, '请输入打印机名称')

  const id = await db.insert(
    'INSERT INTO printers (name, port, description, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [name, port, description]
  )
  ok(res, { id }, '添加成功')
})

// PUT /api/printers/:id
router.put('/:id', async (req, res) => {
  const { name, status, port, description, entry_types, enabled, custom_tags } = req.body
  const updates = [], params = []

  if (name !== undefined)          { updates.push('name = ?');          params.push(name) }
  if (status !== undefined)        { updates.push('status = ?');       params.push(status) }
  if (port !== undefined)          { updates.push('port = ?');          params.push(port) }
  if (description !== undefined)   { updates.push('description = ?');   params.push(description) }
  if (entry_types !== undefined)   {
    updates.push('entry_types = ?')
    params.push(Array.isArray(entry_types) ? entry_types.join(',') : entry_types)
  }
  if (enabled !== undefined)       { updates.push('enabled = ?');       params.push(enabled ? 1 : 0) }
  if (custom_tags !== undefined)   {
    updates.push('custom_tags = ?')
    params.push(Array.isArray(custom_tags) ? custom_tags.join(',') : custom_tags)
  }

  if (updates.length === 0) return fail(res, 400, '没有要更新的字段')

  updates.push('updated_at = NOW()')
  params.push(req.params.id)

  await db.query(`UPDATE printers SET ${updates.join(', ')} WHERE id = ?`, params)
  ok(res, null, '更新成功')
})

// DELETE /api/printers/:id
router.delete('/:id', async (req, res) => {
  const busy = await db.getOne(
    "SELECT COUNT(*) as c FROM orders WHERE printer_id = ? AND status = 'printing'",
    [req.params.id]
  )
  if (busy?.c > 0) return fail(res, 400, '该打印机有进行中的任务，无法删除')

  await db.query('DELETE FROM printers WHERE id = ?', [req.params.id])
  ok(res, null, '删除成功')
})

module.exports = router
