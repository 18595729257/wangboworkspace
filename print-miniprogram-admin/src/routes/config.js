// src/routes/config.js - 配置管理
const express = require('express')
const db = require('../db')
const cache = require('../cache')
const { ok, fail } = require('../utils')

const router = express.Router()

async function getConfig() {
  let config = await cache.get('config')
  if (config) return config
  const rows = await db.query('SELECT `key`, `value` FROM config')
  config = {}
  rows.forEach(r => { config[r.key] = r.value })
  await cache.set('config', config, 3600)
  return config
}

// GET /api/config
router.get('/', async (req, res) => {
  try {
    const config = await getConfig()
    ok(res, config)
  } catch (err) {
    console.error('[Config] Get error:', err)
    fail(res, 500, '获取配置失败')
  }
})

// PUT /api/config
router.put('/', async (req, res) => {
  try {
    const updates = req.body
    await db.transaction(async (conn) => {
      for (const [key, value] of Object.entries(updates)) {
        await conn.query(
          'INSERT INTO config (`key`, `value`, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = NOW()',
          [key, String(value)]
        )
      }
    })
    await cache.del('config')
    ok(res, null, '配置已保存')
  } catch (err) {
    console.error('[Config] Save error:', err)
    fail(res, 500, '保存配置失败')
  }
})

module.exports = router
