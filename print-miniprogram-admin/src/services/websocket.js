// src/services/websocket.js - WebSocket 智能打印机分配系统
const WebSocket = require('ws')
const db = require('../db')
const cache = require('../cache')

let wss = null

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

// ===== 获取分配策略配置 =====
async function getAssignStrategy() {
  try {
    const rows = await db.query("SELECT `value` FROM config WHERE `key` = 'assign_strategy' LIMIT 1")
    return rows[0]?.value || 'by_orders'
  } catch {
    return 'by_orders'
  }
}

// 根据标签找最佳打印机（已支持按订单数/按页数）
function findPrinterByTag(tag, strategy, orderPages) {
  let best = null
  let bestScore = strategy === 'by_pages' ? Infinity : Infinity

  global.printClients.forEach((client, clientId) => {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN) return
    client.printers.forEach(p => {
      if (p.status !== 'idle') return
      if (!p.tags?.includes(tag)) return
      if (p.enabled !== 1 && p.enabled !== true) return

      // 负载分数：by_pages 用总页数，by_orders 用总任务数
      const score = strategy === 'by_pages'
        ? (p.totalPages || 0)
        : (p.totalJobs || 0)

      if (score < bestScore) {
        bestScore = score
        best = { clientId, clientName: client.clientName, printer: p, ws: client.ws }
      }
    })
  })

  return best
}

// 在所有在线空闲打印机中找最佳（按策略）
function findBestIdlePrinter(strategy, orderPages) {
  let best = null
  let bestScore = strategy === 'by_pages' ? Infinity : Infinity

  global.printClients.forEach((client, clientId) => {
    client.printers.forEach(p => {
      if (p.status !== 'idle') return
      if (p.enabled !== 1 && p.enabled !== true) return

      const score = strategy === 'by_pages'
        ? (p.totalPages || 0)
        : (p.totalJobs || 0)

      if (score < bestScore) {
        bestScore = score
        best = { ws: client.ws, printer: p, clientId }
      }
    })
  })

  return best
}

// 找指定打印机（在线且空闲且启用）
function findSpecificPrinter(dbPrinter) {
  let target = null
  global.printClients.forEach((client, _clientId) => {
    if (target) return
    client.printers.forEach(p => {
      if (target) return
      if (p.name === dbPrinter.name && p.status === 'idle' && (p.enabled === 1 || p.enabled === true)) {
        target = { ws: client.ws, printer: p, clientId: _clientId }
      }
    })
  })
  return target
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
        totalPages: p.totalPages || 0,
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
            totalPages: 0,
            enabled: 1,
          }))

          global.printClients.set(clientId, { ws, clientName, printers })
          console.log(`[WS] 客户端连接: ${clientId} (${printers.length}台打印机)`)

          // 同步数据库
          for (const p of printers) {
            const existing = await db.getOne(
              'SELECT id, tags, enabled, total_pages FROM printers WHERE name = ? AND client_id = ?',
              [p.name, clientId]
            )
            if (existing) {
              p.tags = existing.tags ? existing.tags.split(',') : ['normal']
              p.enabled = existing.enabled
              p.totalPages = existing.total_pages || 0
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

          // 标记超时离线
          await db.query(
            "UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id != ? AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND status != 'offline'",
            [clientId]
          )

          // 推送孤儿订单
          const clientPrinterIds = (await Promise.all(
            printers.map(p => db.getOne('SELECT id FROM printers WHERE name = ? AND client_id = ?', [p.name, clientId]))
          )).filter(Boolean).map(r => r.id)

          let orphanOrders = []
          if (clientPrinterIds.length > 0) {
            orphanOrders = await db.query(
              `SELECT * FROM orders WHERE status = 'printing' AND print_end_time IS NULL AND (file_url IS NOT NULL AND file_url != '') AND (printer_id IS NULL OR FIND_IN_SET(printer_id, ?) > 0) ORDER BY created_at ASC LIMIT 20`,
              [clientPrinterIds.join(',')]
            )
          } else {
            orphanOrders = await db.query(
              "SELECT * FROM orders WHERE status = 'printing' AND printer_id IS NULL AND print_end_time IS NULL AND (file_url IS NOT NULL AND file_url != '') ORDER BY created_at ASC LIMIT 20"
            )
          }

          if (orphanOrders.length > 0) {
            console.log(`[WS] 发现 ${orphanOrders.length} 个孤儿订单，补发给 ${clientId}`)
            const strategy = await getAssignStrategy()
            for (const order of orphanOrders) {
              const idlePrinter = printers.find(p => p.status === 'idle' && (p.enabled === 1 || p.enabled === true))
              if (idlePrinter) {
                ws.send(JSON.stringify({ type: 'print_task', data: [order], targetPrinter: idlePrinter.name }))
                idlePrinter.status = 'busy'
              }
            }
          }

          // 推送待打印订单
          for (const p of printers) {
            if (p.enabled !== 1 && p.enabled !== true) continue
            const tags = p.tags.join(',')
            const pending = await db.query(
              `SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') AND FIND_IN_SET(print_tag, ?) > 0 ORDER BY created_at ASC LIMIT 10`,
              [tags]
            )
            for (const order of pending) {
              let printFiles = [{ name: order.file_name, url: order.file_url, isCover: false }]
              try {
                printFiles = await getOrderPrintFiles(order)
              } catch (e) { console.error('[WS] 获取打印文件失败:', e.message) }
              const msg2 = { type: 'print_task', data: [order], printFiles, hasCover: printFiles.some(f => f.isCover), targetPrinter: p.name };
              ws.send(JSON.stringify(msg2))
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
          const { orderNo, status, printerName, error: printError, totalPages } = msg
          if (!orderNo || !status) return

          if (clientId && global.printClients.has(clientId)) {
            const client = global.printClients.get(clientId)
            if (printerName) {
              const p = client.printers.find(cp => cp.name === printerName)
              if (p) {
                p.status = 'idle'
                p.totalJobs = (p.totalJobs || 0) + 1
                // 累加页数（需求1：按页数分配）
                if (totalPages && totalPages > 0) {
                  p.totalPages = (p.totalPages || 0) + totalPages
                }
              }
            }
            // 其余本客户端打印机恢复空闲
            client.printers.forEach(cp => { if (cp.status === 'busy') cp.status = 'idle' })
          }

          if (status === 'completed') {
            await db.query("UPDATE orders SET status = 'completed', print_end_time = NOW(), updated_at = NOW() WHERE order_no = ?", [orderNo])
            await db.query(
              "UPDATE printers SET status = 'idle', total_jobs = total_jobs + 1, total_pages = total_pages + ? WHERE client_id = ? AND status = 'busy'",
              [totalPages || 0, clientId]
            )
          } else if (status === 'failed' || status === 'print_failed') {
            await db.query("UPDATE orders SET status = 'print_failed', updated_at = NOW() WHERE order_no = ?", [orderNo])
            await db.query("UPDATE printers SET status = 'idle', updated_at = NOW() WHERE client_id = ? AND status = 'busy'", [clientId])
          } else if (status === 'printing') {
            await db.query("UPDATE orders SET status = 'printing', print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?", [orderNo])
          } else {
            return
          }

          console.log(`[WS] 订单 ${orderNo} → ${status} (${printerName || '-'}) 页数: ${totalPages || '?'}${printError ? ' 错误: ' + printError : ''}`)
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

const { getOrderPrintFiles } = require('./cover')

// ===== 智能分配并推送打印任务（按策略）=====
async function allocatePrinter(order) {
  const strategy = await getAssignStrategy()
  const orderPages = parseInt(order.total_pages) || 1

  // 1. 指定打印机
  if (order.printer_id) {
    const dbPrinter = await db.getOne('SELECT name, client_id FROM printers WHERE id = ? AND enabled = 1', [order.printer_id])
    if (dbPrinter) {
      const target = findSpecificPrinter(dbPrinter)
      if (target) return { target, method: '指定打印机', strategy }
    }
  }

  // 2. 按标签匹配（支持按页数/按订单数策略）
  const tag = order.print_tag || getOrderTag(order.order_type, order.extra_info)
  const taggedTarget = findPrinterByTag(tag, strategy, orderPages)
  if (taggedTarget) return { target: taggedTarget, method: `标签匹配(${tag})`, strategy }

  // 3. 兜底：在所有在线空闲打印机中选最优（支持策略）
  const best = findBestIdlePrinter(strategy, orderPages)
  if (best) return { target: best, method: `策略(${strategy})`, strategy }
  return null
}

async function assignAndPushOrder(order) {
  if (!wss || wss.clients.size === 0) return false

  const result = await allocatePrinter(order)
  if (!result) {
    console.log(`[分配] 订单 ${order.order_no} → 无可用打印机`)
    return false
  }

  const { target, method, strategy } = result

  let printFiles = [{ name: order.file_name, url: order.file_url, isCover: false }]
  try {
    printFiles = await getOrderPrintFiles(order)
  } catch (e) {
    console.error('[WS] 获取打印文件失败:', e.message)
  }

  const msg = JSON.stringify({
    type: 'print_task',
    data: [order],
    printFiles,
    hasCover: printFiles.some(f => f.isCover),
    targetPrinter: target.printer.name,
  })
  target.ws.send(msg)
  target.printer.status = 'busy'

  await db.query("UPDATE printers SET status = 'busy', updated_at = NOW() WHERE name = ? AND client_id = ?",
    [target.printer.name, target.clientId])
  await db.query(
    "UPDATE orders SET status = 'printing', printer_id = (SELECT id FROM printers WHERE name = ? AND client_id = ? LIMIT 1), print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?",
    [target.printer.name, target.clientId, order.order_no]
  )

  console.log(`[分配] 订单 ${order.order_no} (${method}, ${strategy}, ${order.total_pages || 1}页) → ${target.printer.name} @ ${target.clientId}`)
  return true
}

global.assignAndPushOrder = assignAndPushOrder

module.exports = { init, getAllOnlinePrinters, wss: () => wss }
