// src/services/websocket.js - WebSocket 智能打印机分配系统
const WebSocket = require('ws')
const db = require('../db')
const cache = require('../cache')

let wss = null

// 在线客户端: clientId -> { ws, clientName, printers: [{name, tags[], status, totalJobs, enabled}] }
// 在线客户端 Map: clientId -> { ws, clientName, printers: [{name, tags, status, totalJobs, enabled}] }
if (!global.printClients) global.printClients = new Map()

// 根据订单类型推导标签
function getOrderTag(orderType, extraInfo) {
  if (orderType === 'photo' || orderType === 'photo_print') return 'photo'
  if (orderType === 'idcard' || orderType === 'idcard_copy') return 'idcard'
  try {
    const info = typeof extraInfo === 'string' ? JSON.parse(extraInfo) : extraInfo
    if (info?.colorMode === 'color') return 'color'
  } catch {}
  return 'normal'
}

// 根据标签 + 启用状态找到最佳打印机（空闲优先，负载最低）
function findPrinterByTag(tag) {
  let best = null
  let bestLoad = Infinity

  global.printClients.forEach((client, clientId) => {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN) return
    client.printers.forEach(p => {
      if (p.status !== 'idle') return
      if (!p.tags?.includes(tag)) return
      // 只选已启用的打印机
      if (p.enabled !== 1 && p.enabled !== true) return
      const load = p.totalJobs || 0
      if (load < bestLoad) {
        bestLoad = load
        best = { clientId, clientName: client.clientName, printer: p, ws: client.ws }
      }
    })
  })

  return best
}

// 获取所有在线打印机
function getAllOnlinePrinters() {
  const result = []
  global.printClients.forEach((client, clientId) => {
    client.printers?.forEach(p => {
      result.push({
        clientId,
        clientName: client.clientName,
        name: p.name,
        tags: p.tags,
        status: p.status,
        totalJobs: p.totalJobs || 0,
      })
    })
  })
  return result
}

function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws/printer' })

  wss.on('connection', (ws, req) => {
    let clientId = null

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data)

        // ===== 客户端注册 =====
        if (msg.type === 'register') {
          clientId = msg.clientId
          const clientName = msg.clientName || clientId

          const printers = (msg.printers || []).map(p => ({
            name: p.name,
            tags: Array.isArray(p.tags) && p.tags.length > 0 ? p.tags : ['normal'],
            status: 'idle',
            totalJobs: 0,
            enabled: 1,
          }))

          global.printClients.set(clientId, { ws, clientName, printers })
          console.log(`[WS] 客户端连接: ${clientId} (${printers.length}台打印机)`)

          // 同步到数据库
          for (const p of printers) {
            const existing = await db.getOne(
              'SELECT id, tags, enabled FROM printers WHERE name = ? AND client_id = ?',
              [p.name, clientId]
            )
            if (existing) {
              // 从数据库恢复标签和启用配置
              p.tags = existing.tags ? existing.tags.split(',') : ['normal']
              p.enabled = existing.enabled
              await db.query(
                'UPDATE printers SET status = ?, last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?',
                ['idle', existing.id]
              )
            } else {
              await db.query(
                'INSERT INTO printers (name, port, description, client_id, tags, status, enabled, last_heartbeat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
                [p.name, p.name, `${clientName} 的打印机`, clientId, 'normal', 'idle', 1]
              )
            }
          }

          // 标记超时的其他客户端打印机为离线
          await db.query(
            "UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id != ? AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND status != 'offline'",
            [clientId]
          )

          // 推送孤儿订单：
          // 1. printing 状态但无 printer_id（pay-callback 找不到打印机）
          // 2. printing 状态且有 printer_id，但该打印机是当前客户端的（之前 pay-callback 太早改成 printing）
          const clientPrinterIds = (await Promise.all(
            printers.map(p => db.getOne('SELECT id FROM printers WHERE name = ? AND client_id = ?', [p.name, clientId]))
          )).filter(Boolean).map(r => r.id)

          let orphanOrders = []
          if (clientPrinterIds.length > 0) {
            const ids = clientPrinterIds.join(',')
            orphanOrders = await db.query(
              `SELECT * FROM orders WHERE status = 'printing' AND print_end_time IS NULL AND (file_url IS NOT NULL AND file_url != '') AND (printer_id IS NULL OR FIND_IN_SET(printer_id, ?) > 0) ORDER BY created_at ASC LIMIT 20`,
              [ids]
            )
          } else {
            orphanOrders = await db.query(
              "SELECT * FROM orders WHERE status = 'printing' AND printer_id IS NULL AND print_end_time IS NULL AND (file_url IS NOT NULL AND file_url != '') ORDER BY created_at ASC LIMIT 20"
            )
          }

          if (orphanOrders.length > 0) {
            console.log(`[WS] 发现 ${orphanOrders.length} 个孤儿订单，补发给 ${clientId}`)
            // 为每个订单分配一台空闲打印机
            for (const order of orphanOrders) {
              const idlePrinter = printers.find(p => p.status === 'idle' && (p.enabled === 1 || p.enabled === true))
              if (idlePrinter) {
                ws.send(JSON.stringify({ type: 'print_task', data: [order], targetPrinter: idlePrinter.name }))
                idlePrinter.status = 'busy'
              }
            }
          }

          // 推送待打印订单（按标签匹配）
          for (const p of printers) {
            const tags = p.tags.join(',')
            const pending = await db.query(
              `SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') AND FIND_IN_SET(print_tag, ?) > 0 ORDER BY created_at ASC LIMIT 10`,
              [tags]
            )
            if (pending.length > 0) {
              ws.send(JSON.stringify({ type: 'print_task', data: pending, targetPrinter: p.name }))
            }
          }

          ws.send(JSON.stringify({ type: 'registered', clientId, printerCount: printers.length }))
          return
        }

        // ===== 心跳 =====
        if (msg.type === 'heartbeat') {
          if (clientId && global.printClients.has(clientId)) {
            const client = global.printClients.get(clientId)
            if (msg.printers) {
              msg.printers.forEach(up => {
                const p = client.printers.find(cp => cp.name === up.name)
                if (p) p.status = up.status || 'idle'
              })
            }
            await db.query('UPDATE printers SET last_heartbeat = NOW() WHERE client_id = ?', [clientId])
          }
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
          return
        }

        // ===== 打印状态回传 =====
        if (msg.type === 'print_status') {
          const { orderNo, status, printerName, error: printError } = msg
          if (!orderNo || !status) return

          if (status === 'completed') {
            await db.query("UPDATE orders SET status = 'completed', print_end_time = NOW(), updated_at = NOW() WHERE order_no = ?", [orderNo])
            if (clientId && global.printClients.has(clientId)) {
              const client = global.printClients.get(clientId)
              if (printerName) {
                const p = client.printers.find(cp => cp.name === printerName)
                if (p) { p.status = 'idle'; p.totalJobs = (p.totalJobs || 0) + 1 }
              }
              client.printers.forEach(cp => { if (cp.status === 'busy') cp.status = 'idle' })
            }
            await db.query("UPDATE printers SET status = 'idle', total_jobs = total_jobs + 1, updated_at = NOW() WHERE client_id = ? AND status = 'busy'", [clientId])
          } else if (status === 'failed') {
            await db.query("UPDATE orders SET status = 'print_failed', updated_at = NOW() WHERE order_no = ?", [orderNo])
            if (clientId && global.printClients.has(clientId)) {
              global.printClients.get(clientId).printers.forEach(cp => { if (cp.status === 'busy') cp.status = 'idle' })
            }
            await db.query("UPDATE printers SET status = 'idle', updated_at = NOW() WHERE client_id = ? AND status = 'busy'", [clientId])
          } else if (status === 'printing') {
            await db.query("UPDATE orders SET status = 'printing', print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?", [orderNo])
          } else {
            return
          }

          console.log(`[WS] 订单 ${orderNo} → ${status} (${printerName || '-'})${printError ? ' 错误: ' + printError : ''}`)
          await cache.del('dashboard')
          return
        }
      } catch (e) {
        console.error('[WS] 消息处理错误:', e.message)
      }
    })

    ws.on('close', () => {
      if (clientId) {
        global.printClients.delete(clientId)
        console.log(`[WS] 客户端断开: ${clientId}`)
        db.query("UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id = ?", [clientId]).catch(() => {})
      }
    })

    ws.on('error', err => {
      console.error('[WS] 连接错误:', err.message)
    })
  })

  console.log(`   WebSocket: ws://0.0.0.0:${process.env.PORT || 3000}/ws/printer`)
}

// ===== 智能分配并推送打印任务 =====
async function assignAndPushOrder(order) {
  if (!wss || wss.clients.size === 0) return false

  let target = null
  let usedMethod = ''

  // 优先：指定打印机
  if (order.printer_id) {
    const printer = await db.getOne('SELECT * FROM printers WHERE id = ?', [order.printer_id])
    if (printer) {
      global.printClients.forEach(client => {
        client.printers.forEach(p => {
          if (p.name === printer.name && p.status === 'idle' && (p.enabled === 1 || p.enabled === true)) {
            target = { ws: client.ws, printer: p, clientId: client.clientId }
          }
        })
      })
      if (target) usedMethod = '指定打印机'
    }
  }

  // 次优：按标签匹配
  if (!target) {
    const tag = order.print_tag || getOrderTag(order.order_type, order.extra_info)
    target = findPrinterByTag(tag)
    if (target) usedMethod = `标签匹配(${tag})`
  }

  if (target) {
    const msg = JSON.stringify({
      type: 'print_task',
      data: [order],
      targetPrinter: target.printer.name,
    })
    target.ws.send(msg)
    target.printer.status = 'busy'

    await db.query("UPDATE printers SET status = 'busy', updated_at = NOW() WHERE name = ? AND client_id = ?",
      [target.printer.name, target.clientId])
    // 打印任务已推送，更新数据库状态
    // 直接从订单的 printer_id 更新（如果是手动重打的，可能有指定打印机）
    if (order.printer_id) {
      await db.query(
        "UPDATE orders SET status = 'printing', print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?",
        [order.order_no]
      )
    } else {
      // 如果没有 printer_id，用打印机名称查找
      await db.query(
        "UPDATE orders SET status = 'printing', printer_id = (SELECT id FROM printers WHERE name = ? AND client_id = ? LIMIT 1), print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?",
        [target.printer.name, target.clientId, order.order_no]
      )
    }

    console.log(`[分配] 订单 ${order.order_no} (${usedMethod}) → ${target.printer.name} @ ${target.clientId}`)
    return true
  }

  // 无匹配：广播给所有客户端（降级）
  const tag = order.print_tag || getOrderTag(order.order_type, order.extra_info)
  console.log(`[分配] 订单 ${order.order_no} (${tag}) → 无匹配打印机，广播`)
  const msg = JSON.stringify({ type: 'print_task', data: [order] })
  global.printClients.forEach(client => {
    if (client.ws?.readyState === WebSocket.OPEN) client.ws.send(msg)
  })
  return false
}

// 暴露给外部
global.assignAndPushOrder = assignAndPushOrder

module.exports = { init, getAllOnlinePrinters, wss: () => wss }
