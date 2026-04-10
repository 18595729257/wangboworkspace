// src/routes/dashboard.js - 仪表盘
const express = require('express')
const db = require('../db')
const cache = require('../cache')
const { ok, fail, shanghaiDate } = require('../utils')

const router = express.Router()

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    // 30秒缓存
    const cached = await cache.get('dashboard')
    if (cached) return ok(res, cached)

    const today = shanghaiDate()
    const yesterday = shanghaiDate(-1)
    const monthStart = today.substring(0, 7) + '-01'
    const yearStart = today.substring(0, 4) + '-01-01'

    const queryRevenue = async (where, params = []) => {
      const row = await db.getOne(
        `SELECT COALESCE(SUM(actual_pay),0) as revenue, COUNT(*) as count
         FROM orders WHERE ${where} AND status != 'cancelled'`,
        params
      )
      return { revenue: parseFloat(row.revenue).toFixed(2) * 1, count: row.count }
    }

    // 并行查询所有时间维度
    const [todayS, yesterdayS, monthS, yearS, allS] = await Promise.all([
      queryRevenue('DATE(created_at) = ?', [today]),
      queryRevenue('DATE(created_at) = ?', [yesterday]),
      queryRevenue('created_at >= ?', [monthStart]),
      queryRevenue('created_at >= ?', [yearStart]),
      queryRevenue('1=1'),
    ])

    // 并行查询状态分布 + 打印机统计 + 用户数 + 最近订单
    const [statusDist, userCount, printerStats, recentOrders] = await Promise.all([
      db.query('SELECT status, COUNT(*) as count FROM orders GROUP BY status'),
      db.getOne('SELECT COUNT(*) as c FROM users'),
      db.query("SELECT status, COUNT(*) as c FROM printers GROUP BY status"),
      db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10'),
    ])

    // 最近7天趋势
    const trendPromises = []
    for (let i = 6; i >= 0; i--) {
      const ds = shanghaiDate(-i)
      trendPromises.push(
        db.getOne(
          `SELECT COALESCE(SUM(actual_pay),0) as revenue, COUNT(*) as count
           FROM orders WHERE DATE(created_at) = ? AND status != 'cancelled'`,
          [ds]
        ).then(row => ({
          date: ds.substring(5),
          revenue: parseFloat(row.revenue).toFixed(2) * 1,
          count: row.count,
        }))
      )
    }
    const trend = await Promise.all(trendPromises)

    const printers = { idle: 0, busy: 0, offline: 0 }
    printerStats.forEach(r => { printers[r.status] = r.c })

    const data = {
      revenue: { today: todayS, yesterday: yesterdayS, month: monthS, year: yearS, all: allS },
      trend,
      statusDist,
      userCount: userCount.c,
      printerStats: printers,
      recentOrders,
    }

    await cache.set('dashboard', data, 30)
    ok(res, data)
  } catch (err) {
    console.error('[Dashboard] Error:', err)
    fail(res, 500, '获取统计数据失败')
  }
})

module.exports = router
