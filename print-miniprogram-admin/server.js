// server.js - 打印管理后台服务端（高并发版）
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const db = require('./src/db');
const cache = require('./src/cache');
const { hashPassword, verifyPassword, generateOrderNo, nowStr, generateToken, verifyToken, statusText } = require('./src/utils');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 中间件 =====
app.set('trust proxy', 1); // 信任Nginx代理，使用X-Forwarded-For获取真实IP
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// ===== 限流 =====
// 登录限流：每IP每15分钟10次
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: JSON.stringify({ code: 429, msg: '登录尝试过多' }),
});

// 小程序接口限流
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10000,
});

app.use('/api/', (req, res, next) => next()); // 通用接口不限流

// ===== JWT 认证中间件 =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' });

  try {
    req.admin = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ code: 401, msg: '登录已过期' });
  }
}

// ===== 获取配置（带缓存）=====
async function getConfig() {
  let config = await cache.get('config');
  if (config) return config;

  const rows = await db.query('SELECT `key`, `value` FROM config');
  config = {};
  rows.forEach(r => config[r.key] = r.value);

  await cache.set('config', config, 3600); // 缓存1小时
  return config;
}

// ===== API 路由 =====

// ---------- 登录 ----------
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ code: 400, msg: '请输入用户名和密码' });
    }

    const admin = await db.getOne('SELECT * FROM admins WHERE username = ?', [username]);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.json({ code: 401, msg: '用户名或密码错误' });
    }

    const token = generateToken({
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name,
    });

    res.json({
      code: 200,
      data: { token, username: admin.username, displayName: admin.display_name }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ code: 500, msg: '登录失败' });
  }
});

// ---------- 仪表盘 ----------
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    // 尝试从缓存获取（30秒）
    let data = await cache.get('dashboard');
    if (data) return res.json({ code: 200, data });

    // Asia/Shanghai 日期计算
    const shanghaiDate = (offset = 0) => {
      const d = new Date(Date.now() + offset * 86400000);
      return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    };
    const today = shanghaiDate();
    const yesterday = shanghaiDate(-1);
    const monthStart = today.substring(0, 7) + '-01';
    const yearStart = today.substring(0, 4) + '-01-01';

    const queryRevenue = async (where) => {
      const row = await db.getOne(
        `SELECT COALESCE(SUM(actual_pay),0) as revenue, COUNT(*) as count FROM orders WHERE ${where} AND status != 'cancelled'`
      );
      return { revenue: parseFloat(row.revenue).toFixed(2) * 1, count: row.count };
    };

    const [todayS, yesterdayS, monthS, yearS, allS] = await Promise.all([
      queryRevenue(`DATE(created_at) = '${today}'`),
      queryRevenue(`DATE(created_at) = '${yesterday}'`),
      queryRevenue(`created_at >= '${monthStart}'`),
      queryRevenue(`created_at >= '${yearStart}'`),
      queryRevenue('1=1'),
    ]);

    // 订单状态分布
    const statusDist = await db.query('SELECT status, COUNT(*) as count FROM orders GROUP BY status');

    // 最近7天趋势
    const trend = [];
    const trendPromises = [];
    for (let i = 6; i >= 0; i--) {
      const ds = shanghaiDate(-i);
      trendPromises.push(
        db.getOne(
          `SELECT COALESCE(SUM(actual_pay),0) as revenue, COUNT(*) as count FROM orders WHERE DATE(created_at) = ? AND status != 'cancelled'`,
          [ds]
        ).then(row => ({
          date: ds.substring(5),
          revenue: parseFloat(row.revenue).toFixed(2) * 1,
          count: row.count,
        }))
      );
    }
    const trendResults = await Promise.all(trendPromises);
    trend.push(...trendResults);

    // 用户/打印机统计
    const [userCount, printerStats] = await Promise.all([
      db.getOne('SELECT COUNT(*) as c FROM users'),
      db.query("SELECT status, COUNT(*) as c FROM printers GROUP BY status"),
    ]);

    const printers = { idle: 0, busy: 0, offline: 0 };
    printerStats.forEach(r => { printers[r.status] = r.c; });

    // 最近10个订单
    const recentOrders = await db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10');

    data = {
      revenue: { today: todayS, yesterday: yesterdayS, month: monthS, year: yearS, all: allS },
      trend,
      statusDist,
      userCount: userCount.c,
      printerStats: printers,
      recentOrders,
    };

    await cache.set('dashboard', data, 30); // 缓存30秒
    res.json({ code: 200, data });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.json({ code: 500, msg: '获取统计数据失败' });
  }
});

// ---------- 订单管理 ----------
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, status = '', orderType = '', keyword = '', dateFrom = '', dateTo = '' } = req.query;
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (orderType) { conditions.push('order_type = ?'); params.push(orderType); }
    if (keyword) { conditions.push('(order_no LIKE ? OR file_name LIKE ? OR openid LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const [countRow, list] = await Promise.all([
      db.getOne(`SELECT COUNT(*) as total FROM orders ${where}`, params),
      db.getPool().query(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(pageSize), offset]).then(([rows]) => rows),
    ]);

    res.json({
      code: 200,
      data: {
        list,
        total: countRow.total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(countRow.total / parseInt(pageSize)),
      }
    });
  } catch (err) {
    console.error('Orders error:', err);
    res.json({ code: 500, msg: '获取订单列表失败' });
  }
});

app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  res.json({ code: 200, data: order });
});

app.put('/api/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'paid', 'printing', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return res.json({ code: 400, msg: '无效状态' });

    const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.json({ code: 400, msg: '订单不存在' });

    await db.transaction(async (conn) => {
      const updates = { status };
      const now = nowStr();

      if (status === 'paid' && !order.pay_time) updates.pay_time = now;
      if (status === 'printing') {
        updates.print_start_time = order.print_start_time || now;
        if (order.printer_id) {
          await conn.query("UPDATE printers SET status = 'busy', total_jobs = total_jobs + 1, updated_at = ? WHERE id = ?", [now, order.printer_id]);
        }
      }
      if (status === 'completed') {
        updates.print_end_time = now;
        // 发放积分
        const configRows = await conn.query('SELECT `key`, `value` FROM config');
        const config = {};
        configRows[0].forEach(r => config[r.key] = r.value);

        if (config.enable_points === '1' && order.openid) {
          const pointsEarned = Math.floor(parseFloat(order.actual_pay));
          if (pointsEarned > 0) {
            const userRows = await conn.query('SELECT * FROM users WHERE openid = ?', [order.openid]);
            const user = userRows[0][0];
            if (user) {
              await conn.query('UPDATE users SET points = points + ?, order_count = order_count + 1, total_spent = total_spent + ?, updated_at = ? WHERE id = ?',
                [pointsEarned, parseFloat(order.actual_pay), now, user.id]);
              await conn.query(`INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (?, ?, 'earn', ?, ?, ?, ?)`,
                [user.id, order.openid, pointsEarned, `订单${order.order_no}消费奖励`, order.order_no, now]);
            }
          }
        }
        // 释放打印机
        if (order.printer_id) {
          await conn.query("UPDATE printers SET status = 'idle', updated_at = ? WHERE id = ?", [now, order.printer_id]);
        }
      }

      const setClauses = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
      const setValues = Object.values(updates);
      await conn.query(`UPDATE orders SET ${setClauses} WHERE id = ?`, [...setValues, req.params.id]);
    });

    // 清缓存
    await cache.del('dashboard');

    res.json({ code: 200, msg: '状态更新成功' });
  } catch (err) {
    console.error('Update order status error:', err);
    res.json({ code: 500, msg: '更新失败' });
  }
});

app.put('/api/orders/:id/assign-printer', authMiddleware, async (req, res) => {
  const { printerId } = req.body;
  const order = await db.getOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  const printer = await db.getOne("SELECT * FROM printers WHERE id = ? AND status = 'idle'", [printerId]);
  if (!printer) return res.json({ code: 400, msg: '打印机不可用' });

  await db.query('UPDATE orders SET printer_id = ? WHERE id = ?', [printerId, req.params.id]);
  res.json({ code: 200, msg: '分配成功' });
});

// 导出 CSV
app.get('/api/orders/export/csv', authMiddleware, async (req, res) => {
  const { status = '', dateFrom = '', dateTo = '' } = req.query;
  const conditions = [];
  const params = [];
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
  if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orders = await db.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params);

  const header = '订单号,文件名,页数,份数,颜色,打印费,服务费,实付金额,状态,创建时间\n';
  const rows = orders.map(o =>
    `${o.order_no},${o.file_name},${o.page_count},${o.copies},${o.color_mode === 'color' ? '彩色' : '黑白'},${o.print_fee},${o.service_fee},${o.actual_pay},${statusText(o.status)},${o.created_at}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.csv`);
  res.send('\uFEFF' + header + rows);
});

// ====== 批量重打（失败订单重新打印） ======
app.post('/api/orders/batch-reprint', authMiddleware, async (req, res) => {
  try {
    const { orderIds, printerId } = req.body;

    // 参数校验
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.json({ code: 400, msg: '请选择至少一个订单' });
    }
    if (!printerId) {
      return res.json({ code: 400, msg: '请选择打印机' });
    }

    // 查打印机
    const printer = await db.getOne('SELECT * FROM printers WHERE id = ?', [printerId]);
    if (!printer) {
      return res.json({ code: 400, msg: '打印机不存在' });
    }

    // 检查打印机是否在线（从WebSocket连接中查找）
    // 临时禁用：由于 WebSocket 连接问题（502错误），暂时跳过在线检查
    // TODO: 修复 WebSocket 连接后恢复此检查
    /*
    let printerOnline = false;
    printClients.forEach((client) => {
      if (client.clientId !== printer.client_id) return;
      client.printers.forEach(p => {
        if (p.name === printer.name) {
          printerOnline = true;
        }
      });
    });

    if (!printerOnline) {
      return res.json({ code: 400, msg: '指定的打印机当前不在线，请选择在线的打印机' });
    }
    */

    // 查这些订单，只允许重打 print_failed 状态的
    const placeholders = orderIds.map(() => '?').join(',');
    const orders = await db.query(
      `SELECT * FROM orders WHERE id IN (${placeholders})`,
      orderIds
    );

    const failedOrders = orders.filter(o => o.status === 'print_failed');
    const skippedOrders = orders.filter(o => o.status !== 'print_failed');

    if (failedOrders.length === 0) {
      return res.json({ code: 400, msg: '没有可重打的失败订单（只有打印失败的订单才能重打）' });
    }

    // 批量更新状态为 paid（等待重新打印）
    const failedIds = failedOrders.map(o => o.id);
    const idPlaceholders = failedIds.map(() => '?').join(',');
    const now = nowStr();

    await db.query(
      `UPDATE orders SET status = 'paid', printer_id = ?, print_tag = 'normal', updated_at = ? WHERE id IN (${idPlaceholders})`,
      [printerId, now, ...failedIds]
    );

    // 逐个推送给打印客户端
    let pushedCount = 0;
    for (const order of failedOrders) {
      const updatedOrder = await db.getOne('SELECT * FROM orders WHERE id = ?', [order.id]);
      const pushed = await assignAndPushOrder(updatedOrder);
      if (pushed) pushedCount++;
    }

    // 记录重打日志
    const operator = req.admin?.username || 'admin';
    console.log(`[重打] 管理员 ${operator} 批量重打 ${failedOrders.length} 个订单，推送成功 ${pushedCount} 个，打印机: ${printer.name}`);
    for (const order of failedOrders) {
      await db.query(
        'INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (0, ?, "admin_add", 0, ?, ?, NOW())',
        [order.openid, `管理员${operator}重打 → ${printer.name}`, order.order_no]
      );
    }

    await cache.del('dashboard');

    let msg = `重打完成：成功 ${pushedCount}/${failedOrders.length} 个`;
    if (skippedOrders.length > 0) {
      msg += `，跳过 ${skippedOrders.length} 个（非失败订单）`;
    }

    res.json({
      code: 200,
      msg,
      data: {
        total: orders.length,
        reprinted: failedOrders.length,
        pushed: pushedCount,
        skipped: skippedOrders.length,
        printerName: printer.name
      }
    });
  } catch (err) {
    console.error('Batch reprint error:', err);
    res.json({ code: 500, msg: '批量重打失败: ' + err.message });
  }
});

// ---------- 打印机管理 ----------
// 小程序入口列表
app.get('/api/entry-types', authMiddleware, async (req, res) => {
  res.json({
    code: 200,
    data: [
      { key: 'print', label: '文档打印', icon: '📄' },
      { key: 'idcard', label: '证件复印', icon: '🪪' },
      { key: 'photo', label: '照片打印', icon: '📸' },
      { key: 'factory', label: '工厂发货', icon: '🏭' },
    ]
  });
});

app.get('/api/printers', authMiddleware, async (req, res) => {
  const printers = await db.query('SELECT * FROM printers ORDER BY id ASC');
  // 合并 WebSocket 在线状态
  const onlineIds = new Set();
  printClients.forEach((client, clientId) => {
    client.printers.forEach(p => {
      onlineIds.add(`${clientId}::${p.name}`);
    });
  });
  const result = printers.map(p => ({
    ...p,
    online: onlineIds.has(`${p.client_id}::${p.name}`),
    tags: p.tags ? p.tags.split(',') : ['normal'],
    entry_types: p.entry_types ? p.entry_types.split(',') : ['print'],
    enabled: p.enabled !== undefined ? p.enabled : 1,
    custom_tags: p.custom_tags ? p.custom_tags.split(',').filter(Boolean) : [],
  }));
  res.json({ code: 200, data: result });
});

app.post('/api/printers', authMiddleware, async (req, res) => {
  const { name, port = '', description = '' } = req.body;
  if (!name) return res.json({ code: 400, msg: '请输入打印机名称' });

  const id = await db.insert(
    'INSERT INTO printers (name, port, description, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [name, port, description]
  );
  res.json({ code: 200, data: { id }, msg: '添加成功' });
});

app.put('/api/printers/:id', authMiddleware, async (req, res) => {
  const { name, status, port, description, entry_types, enabled, custom_tags } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (port !== undefined) { updates.push('port = ?'); params.push(port); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (entry_types !== undefined) { updates.push('entry_types = ?'); params.push(Array.isArray(entry_types) ? entry_types.join(',') : entry_types); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  if (custom_tags !== undefined) { updates.push('custom_tags = ?'); params.push(Array.isArray(custom_tags) ? custom_tags.join(',') : custom_tags); }
  updates.push('updated_at = NOW()');
  params.push(req.params.id);

  await db.query(`UPDATE printers SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ code: 200, msg: '更新成功' });
});

app.delete('/api/printers/:id', authMiddleware, async (req, res) => {
  const busy = await db.getOne("SELECT COUNT(*) as c FROM orders WHERE printer_id = ? AND status = 'printing'", [req.params.id]);
  if (busy.c > 0) return res.json({ code: 400, msg: '该打印机有进行中的任务，无法删除' });

  await db.query('DELETE FROM printers WHERE id = ?', [req.params.id]);
  res.json({ code: 200, msg: '删除成功' });
});

// ---------- 用户管理 ----------
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword = '' } = req.query;
    const conditions = [];
    const params = [];
    if (keyword) { conditions.push('(nickname LIKE ? OR openid LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const [countRow, list] = await Promise.all([
      db.getOne(`SELECT COUNT(*) as total FROM users ${where}`, params),
      db.getPool().query(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(pageSize), offset]).then(([rows]) => rows),
    ]);

    res.json({
      code: 200,
      data: { list, total: countRow.total, page: parseInt(page), pageSize: parseInt(pageSize), totalPages: Math.ceil(countRow.total / parseInt(pageSize)) }
    });
  } catch (err) {
    res.json({ code: 500, msg: '获取用户列表失败' });
  }
});

app.get('/api/users/:id', authMiddleware, async (req, res) => {
  const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.json({ code: 404, msg: '用户不存在' });

  const [orders, pointsRecords] = await Promise.all([
    db.query('SELECT * FROM orders WHERE openid = ? ORDER BY created_at DESC LIMIT 20', [user.openid]),
    db.query('SELECT * FROM points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]),
  ]);

  res.json({ code: 200, data: { ...user, orders, pointsRecords } });
});

app.post('/api/users/:id/points', authMiddleware, async (req, res) => {
  const { points, reason = '管理员调整' } = req.body;
  if (typeof points !== 'number' || points === 0) return res.json({ code: 400, msg: '请输入有效的积分数' });

  const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.json({ code: 404, msg: '用户不存在' });
  if (points < 0 && user.points + points < 0) return res.json({ code: 400, msg: `用户当前积分 ${user.points}，不足扣除` });

  await db.transaction(async (conn) => {
    await conn.query('UPDATE users SET points = points + ?, updated_at = NOW() WHERE id = ?', [points, req.params.id]);
    await conn.query(`INSERT INTO points_records (user_id, openid, type, points, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [user.id, user.openid, points > 0 ? 'admin_add' : 'admin_deduct', Math.abs(points), reason]);
  });

  res.json({ code: 200, msg: '积分调整成功' });
});

// ---------- 配置 ----------
app.get('/api/config', authMiddleware, async (req, res) => {
  const config = await getConfig();
  res.json({ code: 200, data: config });
});

app.put('/api/config', authMiddleware, async (req, res) => {
  const updates = req.body;
  await db.transaction(async (conn) => {
    for (const [key, value] of Object.entries(updates)) {
      await conn.query('INSERT INTO config (`key`, `value`, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = NOW()', [key, String(value)]);
    }
  });
  await cache.del('config');
  res.json({ code: 200, msg: '配置已保存' });
});

// 修改管理员密码
app.put('/api/admin/password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.json({ code: 400, msg: '请填写完整' });
  if (newPassword.length < 6) return res.json({ code: 400, msg: '新密码至少6位' });

  const admin = await db.getOne('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
  if (!verifyPassword(oldPassword, admin.password_hash)) return res.json({ code: 401, msg: '原密码错误' });

  const hash = hashPassword(newPassword);
  await db.query('UPDATE admins SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, req.admin.id]);
  res.json({ code: 200, msg: '密码修改成功' });
});

// ===== 小程序公开接口 =====
app.use('/api/public', publicLimiter);

// ===== 文件上传（重写版） =====
const fs = require('fs');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 安全文件名
function safeFileName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.txt', '.rtf'];
  const safeExt = allowed.includes(ext) ? ext : '.bin';
  return Date.now() + '_' + Math.random().toString(36).substr(2, 8) + safeExt;
}

// 检测PDF页数
function detectPdfPages(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const text = buf.toString('latin1');
    const allMarkers = text.match(/\/Type\s*\/Page[s]?/g) || [];
    const pageOnly = allMarkers.filter(m => !m.includes('Pages'));
    return pageOnly.length > 0 ? pageOnly.length : 1;
  } catch (e) {
    return 1;
  }
}

// 上传文件接口（手动处理 multipart，兼容性更好）
app.post('/api/public/upload', (req, res) => {
  const startTime = Date.now();
  const clientIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
  console.log(`[UPLOAD] 收到上传请求 from ${clientIp}, content-type: ${req.headers['content-type']}`);

  const contentType = req.headers['content-type'] || '';

  // 方式1: multipart/form-data（微信小程序 wx.uploadFile）
  if (contentType.includes('multipart/form-data')) {
    const boundaryMatch = contentType.match(/boundary=(.+)/i);
    if (!boundaryMatch) {
      console.log('[UPLOAD] 缺少 boundary');
      return res.json({ code: 400, msg: '请求格式错误（缺少boundary）' });
    }
    const boundary = boundaryMatch[1].trim();

    const chunks = [];
    let totalSize = 0;
    const maxSize = 50 * 1024 * 1024; // 50MB

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        console.log(`[UPLOAD] 文件过大: ${totalSize} bytes`);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        if (totalSize > maxSize) return; // 已经被 destroy 了

        const bodyBuf = Buffer.concat(chunks);
        console.log(`[UPLOAD] 收到数据: ${bodyBuf.length} bytes, boundary: ${boundary}`);

        // 解析 multipart
        const result = parseMultipart(bodyBuf, boundary);
        if (!result) {
          console.log('[UPLOAD] multipart 解析失败');
          return res.json({ code: 400, msg: '文件解析失败' });
        }

        console.log(`[UPLOAD] 解析成功: filename=${result.filename}, size=${result.data.length}`);

        // 保存文件
        const fileName = safeFileName(result.filename);
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, result.data);

        // 检测页数
        const ext = path.extname(result.filename).toLowerCase();
        let pageCount = 1;
        if (ext === '.pdf') {
          pageCount = detectPdfPages(filePath);
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
          pageCount = 1;
        }

        // 构建URL
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'xinbingcloudprint.top';
        const fileUrl = `${proto}://${host}/uploads/${fileName}`;

        console.log(`[UPLOAD] 保存成功: ${fileName}, pages=${pageCount}, 耗时=${Date.now() - startTime}ms`);

        res.json({
          code: 200,
          data: {
            url: fileUrl,
            name: result.filename,
            size: result.data.length,
            pageCount
          }
        });
      } catch (err) {
        console.error('[UPLOAD] 处理失败:', err.message);
        res.json({ code: 500, msg: '文件处理失败: ' + err.message });
      }
    });

    req.on('error', (err) => {
      console.error('[UPLOAD] 请求错误:', err.message);
      res.json({ code: 500, msg: '上传中断' });
    });

    req.on('close', () => {
      console.log(`[UPLOAD] 连接关闭, 已接收=${totalSize} bytes`);
    });

    return;
  }

  // 方式2: application/json（base64 上传，备用方案）
  if (contentType.includes('application/json')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.fileData || !data.fileName) {
          return res.json({ code: 400, msg: '缺少 fileData 或 fileName' });
        }

        const fileBuf = Buffer.from(data.fileData, 'base64');
        const fileName = safeFileName(data.fileName);
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, fileBuf);

        const ext = path.extname(data.fileName).toLowerCase();
        let pageCount = 1;
        if (ext === '.pdf') pageCount = detectPdfPages(filePath);

        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'xinbingcloudprint.top';
        const fileUrl = `${proto}://${host}/uploads/${fileName}`;

        console.log(`[UPLOAD] base64上传成功: ${data.fileName}, size=${fileBuf.length}, pages=${pageCount}`);

        res.json({
          code: 200,
          data: { url: fileUrl, name: data.fileName, size: fileBuf.length, pageCount }
        });
      } catch (err) {
        console.error('[UPLOAD] base64处理失败:', err.message);
        res.json({ code: 500, msg: '文件处理失败' });
      }
    });
    return;
  }

  // 不支持的格式
  console.log(`[UPLOAD] 不支持的 content-type: ${contentType}`);
  res.json({ code: 400, msg: '不支持的上传格式，请使用 multipart/form-data' });
});

// 手动解析 multipart/form-data
function parseMultipart(buf, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const endBuf = Buffer.from('--' + boundary + '--');

  // 找到第一个 boundary
  let pos = indexOf(buf, boundaryBuf, 0);
  if (pos === -1) return null;

  // 跳过 boundary + CRLF
  pos = pos + boundaryBuf.length;
  if (buf[pos] === 0x0D && buf[pos + 1] === 0x0A) pos += 2; // \r\n

  // 找到下一个 boundary（内容结束位置）
  const nextBoundary = indexOf(buf, boundaryBuf, pos);
  if (nextBoundary === -1) return null;

  // 内容区域 = [pos, nextBoundary - 2]（去掉末尾 \r\n）
  const contentArea = buf.slice(pos, nextBoundary);

  // 找到 header 和 body 的分界（\r\n\r\n）
  const headerEnd = indexOf(contentArea, Buffer.from('\r\n\r\n'), 0);
  if (headerEnd === -1) return null;

  const headerStr = contentArea.slice(0, headerEnd).toString('utf8');
  const bodyStart = headerEnd + 4; // 跳过 \r\n\r\n
  const bodyEnd = contentArea.length - (contentArea[contentArea.length - 2] === 0x0D ? 2 : 0); // 去掉末尾 \r\n
  const body = contentArea.slice(bodyStart, bodyEnd);

  // 解析 filename
  const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
  const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';

  return { filename, data: body };
}

// Buffer 中查找子 Buffer 的位置
function indexOf(buf, search, start) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

// 提供上传文件的静态访问
app.use('/uploads', express.static(uploadDir));

// 获取基础URL
function config_get_base_url() {
  return 'http://xinbingcloudprint.top';
}

// 微信登录（code 换 openid）
app.post('/api/public/wx-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.json({ code: 400, msg: '缺少登录code' });

    const appid = process.env.WX_APPID || 'wx749cd8c41284e88f';
    const appsecret = process.env.WX_APPSECRET || '';

    let openid = '';

    if (appsecret) {
      try {
        const https = require('https');
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${appsecret}&js_code=${code}&grant_type=authorization_code`;

        const wxRes = await new Promise((resolve, reject) => {
          https.get(url, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });

        if (wxRes.openid) {
          openid = wxRes.openid;
        } else {
          console.warn('微信登录返回异常:', wxRes);
          // code无效时生成临时openid，不阻断登录
          openid = 'temp_' + code.substring(0, 20) + '_' + Date.now();
        }
      } catch (wxErr) {
        console.error('调用微信API失败:', wxErr);
        openid = 'temp_' + code.substring(0, 20) + '_' + Date.now();
      }
    } else {
      // 未配置appsecret，使用临时openid
      openid = 'temp_' + code.substring(0, 20) + '_' + Date.now();
    }

    // 创建或更新用户
    await db.query('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [openid]);
    const user = await db.getOne('SELECT * FROM users WHERE openid = ?', [openid]);

    res.json({ code: 200, data: user });
  } catch (err) {
    console.error('Wx login error:', err);
    res.json({ code: 500, msg: '登录失败' });
  }
});

// 获取手机号（code换手机号）
app.post('/api/public/phone', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.json({ code: 400, msg: '缺少code' });

    const appid = process.env.WX_APPID || 'wx749cd8c41284e88f';
    const appsecret = process.env.WX_APPSECRET || '';

    if (!appsecret) return res.json({ code: 200, data: { phoneNumber: '' } });

    // 获取access_token
    const https = require('https');
    const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`;
    const tokenRes = await new Promise((resolve, reject) => {
      https.get(tokenUrl, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    if (!tokenRes.access_token) return res.json({ code: 200, data: { phoneNumber: '' } });

    // 获取手机号
    const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenRes.access_token}`;
    const postData = JSON.stringify({ code });

    const phoneRes = await new Promise((resolve, reject) => {
      const req2 = https.request(phoneUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve(JSON.parse(data)));
      });
      req2.on('error', reject);
      req2.write(postData);
      req2.end();
    });

    const phoneNumber = (phoneRes.phone_info && phoneRes.phone_info.phoneNumber) || '';
    res.json({ code: 200, data: { phoneNumber } });
  } catch (err) {
    console.error('Get phone error:', err);
    res.json({ code: 200, data: { phoneNumber: '' } });
  }
});

// 取消订单
app.put('/api/public/order/:orderNo/cancel', async (req, res) => {
  try {
    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [req.params.orderNo]);
    if (!order) return res.json({ code: 404, msg: '订单不存在' });
    if (order.status !== 'pending') return res.json({ code: 400, msg: '只能取消待支付的订单' });

    // 退还积分
    if (order.points_used > 0 && order.openid) {
      await db.transaction(async (conn) => {
        await conn.query('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', order.id]);
        await conn.query('UPDATE users SET points = points + ?, updated_at = NOW() WHERE openid = ?', [order.points_used, order.openid]);
        await conn.query(`INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at)
          SELECT id, openid, 'earn', ?, '取消订单退还', ?, NOW() FROM users WHERE openid = ?`, [order.points_used, order.order_no, order.openid]);
      });
    } else {
      await db.query('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', order.id]);
    }

    await cache.del('dashboard');
    res.json({ code: 200, msg: '订单已取消' });
  } catch (err) {
    console.error('Cancel order error:', err);
    res.json({ code: 500, msg: '取消失败' });
  }
});

app.get('/api/public/config', async (req, res) => {
  const config = await getConfig();
  const publicKeys = ['shop_name', 'price_bw', 'price_color', 'service_fee', 'enable_points',
    'points_earn_rate', 'points_deduct_rate', 'max_points_discount', 'enable_payment', 'enable_print'];
  const pub = {};
  publicKeys.forEach(k => { if (config[k] !== undefined) pub[k] = config[k]; });
  res.json({ code: 200, data: pub });
});

app.post('/api/public/order', async (req, res) => {
  try {
    const { openid, fileName, fileUrl = '', pageCount, copies, colorMode, paperSize, pointsUsed = 0, orderType = 'print', extraInfo = '', printTag = '' } = req.body;
    if (!openid || !fileName) return res.json({ code: 400, msg: '参数不完整' });

    const config = await getConfig();
    if (config.enable_print !== '1') return res.json({ code: 400, msg: '打印服务暂未开放' });

    // 推导打印标签
    let tag = printTag;
    if (!tag) {
      if (orderType === 'photo' || orderType === 'photo_print') tag = 'photo';
      else if (orderType === 'idcard' || orderType === 'idcard_copy') tag = 'idcard';
      else if (colorMode === 'color') tag = 'color';
      else tag = 'normal';
    }

    const pricePerPage = colorMode === 'color' ? parseFloat(config.price_color) : parseFloat(config.price_bw);
    const printFee = pageCount * copies * pricePerPage;
    const serviceFee = parseFloat(config.service_fee);
    const totalFee = printFee + serviceFee;
    const maxDiscount = Math.min(parseFloat(config.max_points_discount), printFee);
    const pointsDiscount = Math.min(pointsUsed / parseInt(config.points_deduct_rate), maxDiscount);
    const actualPay = Math.max(totalFee - pointsDiscount, 0.01);
    const orderNo = generateOrderNo();

    await db.transaction(async (conn) => {
      // 创建用户（如不存在）
      await conn.query('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [openid]);

      // 扣除积分
      if (pointsUsed > 0) {
        const userRows = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
        const user = userRows[0][0];
        if (user && user.points >= pointsUsed) {
          await conn.query('UPDATE users SET points = points - ?, updated_at = NOW() WHERE openid = ?', [pointsUsed, openid]);
          await conn.query(`INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (?, ?, 'deduct', ?, '订单抵扣', ?, NOW())`,
            [user.id, openid, pointsUsed, orderNo]);
        }
      }

      await conn.query(`INSERT INTO orders (order_no, openid, file_name, file_url, page_count, copies, color_mode, paper_size,
        print_fee, service_fee, total_fee, points_used, points_discount, actual_pay, status, order_type, print_tag, extra_info, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW())`,
        [orderNo, openid, fileName, fileUrl, pageCount, copies, colorMode, paperSize,
          parseFloat(printFee.toFixed(2)), serviceFee, parseFloat(totalFee.toFixed(2)), pointsUsed, parseFloat(pointsDiscount.toFixed(2)), parseFloat(actualPay.toFixed(2)),
          orderType, tag, extraInfo]);
    });

    await cache.del('dashboard');
    res.json({ code: 200, data: { orderNo, actualPay: parseFloat(actualPay.toFixed(2)) } });
  } catch (err) {
    console.error('Create order error:', err);
    res.json({ code: 500, msg: '创建订单失败' });
  }
});

app.get('/api/public/order/:orderNo', async (req, res) => {
  const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [req.params.orderNo]);
  if (!order) return res.json({ code: 404, msg: '订单不存在' });
  res.json({ code: 200, data: order });
});

app.get('/api/public/user/:openid', async (req, res) => {
  let user = await db.getOne('SELECT * FROM users WHERE openid = ?', [req.params.openid]);
  if (!user) {
    await db.insert('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [req.params.openid]);
    user = await db.getOne('SELECT * FROM users WHERE openid = ?', [req.params.openid]);
  }
  res.json({ code: 200, data: user });
});

app.get('/api/public/user/:openid/orders', async (req, res) => {
  const { page = 1, pageSize = 20 } = req.query;
  const openid = req.params.openid;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const [totalRow, orders] = await Promise.all([
    db.getOne('SELECT COUNT(*) as c FROM orders WHERE openid = ?', [openid]),
    db.getPool().query('SELECT * FROM orders WHERE openid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [openid, parseInt(pageSize), offset]).then(([rows]) => rows),
  ]);

  res.json({ code: 200, data: { list: orders, total: totalRow.c, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

app.get('/api/public/queue-status', async (req, res) => {
  const [printers, queue] = await Promise.all([
    db.query("SELECT status, COUNT(*) as c FROM printers GROUP BY status"),
    db.query("SELECT status, COUNT(*) as c FROM orders WHERE status IN ('paid','printing') GROUP BY status"),
  ]);

  const p = { idle: 0, busy: 0, offline: 0 };
  printers.forEach(r => { p[r.status] = r.c; });
  const q = { waiting: 0, printing: 0 };
  queue.forEach(r => { q[r.status === 'paid' ? 'waiting' : 'printing'] = r.c; });

  res.json({ code: 200, data: { printers: p, queue: q } });
});

app.post('/api/public/pay-callback', async (req, res) => {
  try {
    const { orderNo } = req.body;
    if (!orderNo) return res.json({ code: 400, msg: '缺少订单号' });

    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo]);
    if (!order) return res.json({ code: 404, msg: '订单不存在' });
    if (order.status !== 'pending') return res.json({ code: 400, msg: '订单状态异常' });

    const printer = await db.getOne("SELECT * FROM printers WHERE status = 'idle' ORDER BY total_jobs ASC LIMIT 1");
    const now = nowStr();
    let printerId = null;
    let newStatus = 'paid';

    if (printer) {
      printerId = printer.id;
      await db.query("UPDATE printers SET status = 'busy', total_jobs = total_jobs + 1, updated_at = ? WHERE id = ?", [now, printer.id]);
      newStatus = 'printing';
      await db.query('UPDATE orders SET status = ?, printer_id = ?, pay_time = ?, print_start_time = ? WHERE id = ?',
        [newStatus, printerId, now, now, order.id]);
    } else {
      await db.query('UPDATE orders SET status = ?, pay_time = ? WHERE id = ?', [newStatus, now, order.id]);
    }

    // WebSocket 智能分配打印任务
    try {
      const updatedOrder = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo]);
      await assignAndPushOrder(updatedOrder);
    } catch (e) {
      console.error('分配打印任务失败:', e.message);
    }

    // 发放积分（支付成功即发放）
    try {
      const cfg = await getConfig();
      if (cfg.enable_points === '1' && order.openid) {
        var earnRate = parseInt(cfg.points_earn_rate) || 1;
        var pointsEarned = Math.floor(parseFloat(order.actual_pay) / earnRate);
        if (pointsEarned > 0) {
          await db.query('UPDATE users SET points = points + ?, total_spent = total_spent + ?, order_count = order_count + 1, updated_at = NOW() WHERE openid = ?',
            [pointsEarned, parseFloat(order.actual_pay), order.openid]);
          await db.query("INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) SELECT id, openid, 'earn', ?, ?, ?, NOW() FROM users WHERE openid = ?",
            [pointsEarned, '订单' + orderNo + '消费奖励', orderNo, order.openid]);
        }
      }
    } catch (pointsErr) {
      console.error('积分发放失败:', pointsErr);
    }

    await cache.del('dashboard');
    res.json({ code: 200, data: { orderNo, status: newStatus, printerId } });
  } catch (err) {
    console.error('Pay callback error:', err);
    res.json({ code: 500, msg: '处理失败' });
  }
});

// ===== 打印客户端接口 =====

// 打印机注册/心跳
app.post('/api/public/printer/register', async (req, res) => {
  try {
    const { clientId, clientName, printers: clientPrinters } = req.body;
    if (!clientId) return res.json({ code: 400, msg: '缺少clientId' });

    // 更新或插入打印机记录
    if (clientPrinters && clientPrinters.length > 0) {
      for (const p of clientPrinters) {
        const existing = await db.getOne(
          'SELECT id FROM printers WHERE name = ? AND client_id = ?',
          [p.name, clientId]
        );
        if (existing) {
          await db.query(
            'UPDATE printers SET status = ?, last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?',
            [p.isDefault ? 'idle' : 'idle', existing.id]
          );
        } else {
          await db.query(
            'INSERT INTO printers (name, port, description, client_id, status, last_heartbeat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
            [p.name, p.name, `${clientName || clientId} 的打印机`, clientId, 'idle']
          );
        }
      }
    }

    // 将离线超时的打印机设为 offline（5分钟无心跳）
    await db.query(
      "UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id != ? AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND status != 'offline'",
      [clientId]
    );

    res.json({ code: 200, msg: '注册成功' });
  } catch (err) {
    console.error('打印机注册失败:', err);
    res.json({ code: 500, msg: '注册失败' });
  }
});

// 心跳（更新打印机在线状态）
app.post('/api/public/printer/heartbeat', async (req, res) => {
  try {
    const { clientId } = req.body;
    if (!clientId) return res.json({ code: 400, msg: '缺少clientId' });

    await db.query(
      'UPDATE printers SET last_heartbeat = NOW(), updated_at = NOW() WHERE client_id = ?',
      [clientId]
    );

    res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    res.json({ code: 500, msg: '心跳失败' });
  }
});

// 获取待打印订单（状态为 paid）
app.get('/api/public/printer/pending', async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') ORDER BY created_at ASC LIMIT 10`
    );
    res.json({ code: 200, data: orders });
  } catch (err) {
    console.error('获取待打印订单失败:', err);
    res.json({ code: 500, msg: '获取失败' });
  }
});

// 更新打印状态
app.put('/api/public/order/:orderNo/print-status', async (req, res) => {
  try {
    const { orderNo } = req.params;
    const { status, clientId, error: printError, printedAt } = req.body;

    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo]);
    if (!order) return res.json({ code: 404, msg: '订单不存在' });

    const validStatuses = ['printing', 'printed', 'completed', 'print_failed'];
    if (!validStatuses.includes(status)) {
      return res.json({ code: 400, msg: '无效的状态' });
    }

    let sql = 'UPDATE orders SET status = ?, updated_at = NOW()';
    let params = [status];

    if (status === 'printing') {
      sql += ', print_start_time = NOW()';
    }
    if (status === 'printed' || status === 'completed') {
      sql += ', status = "completed", print_end_time = NOW()';
      params = ['completed'];
    }
    if (status === 'print_failed') {
      // 打印失败，标记为 print_failed 不再自动重试
      sql += ', status = "print_failed"';
      params = ['print_failed'];
    }

    sql += ' WHERE order_no = ?';
    params.push(orderNo);

    await db.query(sql, params);

    console.log(`[打印] 订单 ${orderNo} 状态更新: ${status}${clientId ? ' (客户端: ' + clientId + ')' : ''}${printError ? ' 错误: ' + printError : ''}`);

    res.json({ code: 200, msg: '更新成功' });
  } catch (err) {
    console.error('更新打印状态失败:', err);
    res.json({ code: 500, msg: '更新失败' });
  }
});

// ===== 健康检查 =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== SPA fallback =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== 全局错误处理 =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// ===== WebSocket 智能打印机分配系统 =====
const WebSocket = require('ws');
let wss = null;

// 在线客户端: clientId -> { ws, clientName, printers: [{name, tags[], status}] }
const printClients = new Map();

// 可用标签
const VALID_TAGS = ['normal', 'color', 'photo', 'idcard'];

// 从订单类型推导标签
function getOrderTag(orderType, extraInfo) {
  if (orderType === 'photo' || orderType === 'photo_print') return 'photo';
  if (orderType === 'idcard' || orderType === 'idcard_copy') return 'idcard';
  // 普通打印，看是否彩色
  if (extraInfo) {
    try {
      const info = typeof extraInfo === 'string' ? JSON.parse(extraInfo) : extraInfo;
      if (info.colorMode === 'color') return 'color';
    } catch (e) {}
  }
  return 'normal';
}

// 根据标签查找最佳打印机（空闲优先，负载最低）
function findPrinterByTag(tag) {
  let best = null;
  let bestLoad = Infinity;

  printClients.forEach((client, clientId) => {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN) return;

    client.printers.forEach(p => {
      if (p.status !== 'idle') return;
      if (!p.tags.includes(tag)) return;

      // 匹配成功，选负载最低的
      const load = p.totalJobs || 0;
      if (load < bestLoad) {
        bestLoad = load;
        best = { clientId, clientName: client.clientName, printer: p, ws: client.ws };
      }
    });
  });

  return best;
}

// 获取所有在线打印机（用于管理后台）
function getAllOnlinePrinters() {
  const result = [];
  printClients.forEach((client, clientId) => {
    client.printers.forEach(p => {
      result.push({
        clientId,
        clientName: client.clientName,
        name: p.name,
        tags: p.tags,
        status: p.status,
        totalJobs: p.totalJobs || 0,
      });
    });
  });
  return result;
}

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws/printer' });

  wss.on('connection', (ws, req) => {
    let clientId = null;

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);

        // ===== 客户端注册 =====
        if (msg.type === 'register') {
          clientId = msg.clientId;
          const clientName = msg.clientName || clientId;

          // 解析打印机和标签
          const printers = (msg.printers || []).map(p => ({
            name: p.name,
            tags: Array.isArray(p.tags) && p.tags.length > 0 ? p.tags : ['normal'],
            status: 'idle',
            totalJobs: 0,
          }));

          printClients.set(clientId, { ws, clientName, printers });
          console.log(`[WS] 客户端连接: ${clientId} (${printers.length}台打印机)`);

          // 同步打印机到数据库
          for (const p of printers) {
            const tagsStr = p.tags.join(',');
            const existing = await db.getOne(
              'SELECT id FROM printers WHERE name = ? AND client_id = ?', [p.name, clientId]
            );
            if (existing) {
              await db.query(
                'UPDATE printers SET tags = ?, status = ?, last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?',
                [tagsStr, 'idle', existing.id]
              );
            } else {
              await db.query(
                'INSERT INTO printers (name, port, description, client_id, tags, status, last_heartbeat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
                [p.name, p.name, `${clientName} 的打印机`, clientId, tagsStr, 'idle']
              );
            }
          }

          // 将该客户端的打印机设为在线，超时的其他打印机设为离线
          await db.query("UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id != ? AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND status != 'offline'", [clientId]);

          // 推送待打印订单（按标签匹配）
          for (const p of printers) {
            const pending = await db.query(
              "SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') AND print_tag IN (?) ORDER BY created_at ASC LIMIT 10",
              [p.tags]
            );
            if (pending.length > 0) {
              ws.send(JSON.stringify({ type: 'print_task', data: pending, targetPrinter: p.name }));
            }
          }

          ws.send(JSON.stringify({ type: 'registered', clientId, printerCount: printers.length }));
        }

        // ===== 心跳 =====
        if (msg.type === 'heartbeat') {
          if (clientId && printClients.has(clientId)) {
            const client = printClients.get(clientId);
            // 更新打印机状态
            if (msg.printers) {
              msg.printers.forEach(up => {
                const p = client.printers.find(cp => cp.name === up.name);
                if (p) p.status = up.status || 'idle';
              });
            }
            await db.query('UPDATE printers SET last_heartbeat = NOW() WHERE client_id = ?', [clientId]);
          }
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        }

        // ===== 打印状态回传 =====
        if (msg.type === 'print_status') {
          const { orderNo, status, printerName, error: printError } = msg;
          if (orderNo && status) {
            let sql, params;

            if (status === 'completed') {
              sql = "UPDATE orders SET status = 'completed', print_end_time = NOW(), updated_at = NOW() WHERE order_no = ?";
              params = [orderNo];
              // 释放打印机：重置该客户端所有busy的打印机
              if (clientId && printClients.has(clientId)) {
                const client = printClients.get(clientId);
                if (printerName) {
                  const p = client.printers.find(cp => cp.name === printerName);
                  if (p) { p.status = 'idle'; p.totalJobs = (p.totalJobs || 0) + 1; }
                }
                // 无论有没有printerName，都重置该客户端所有busy打印机
                client.printers.forEach(cp => { if (cp.status === 'busy') cp.status = 'idle'; });
              }
              await db.query("UPDATE printers SET status = 'idle', total_jobs = total_jobs + 1, updated_at = NOW() WHERE client_id = ? AND status = 'busy'", [clientId]);
            } else if (status === 'failed') {
              sql = "UPDATE orders SET status = 'print_failed', updated_at = NOW() WHERE order_no = ?";
              params = [orderNo];
              // 释放打印机：重置该客户端所有busy的打印机
              if (clientId && printClients.has(clientId)) {
                const client = printClients.get(clientId);
                client.printers.forEach(cp => { if (cp.status === 'busy') cp.status = 'idle'; });
              }
              await db.query("UPDATE printers SET status = 'idle', updated_at = NOW() WHERE client_id = ? AND status = 'busy'", [clientId]);
            } else if (status === 'printing') {
              sql = "UPDATE orders SET status = 'printing', print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?";
              params = [orderNo];
            } else {
              return;
            }

            await db.query(sql, params);
            console.log(`[WS] 订单 ${orderNo} → ${status} (${printerName || '-'})${printError ? ' 错误: ' + printError : ''}`);
            await cache.del('dashboard');
          }
        }
      } catch (e) {
        console.error('[WS] 消息处理错误:', e.message);
      }
    });

    ws.on('close', () => {
      if (clientId) {
        printClients.delete(clientId);
        console.log(`[WS] 客户端断开: ${clientId}`);
        // 标记打印机离线
        db.query("UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id = ?", [clientId]).catch(() => {});
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] 连接错误:', err.message);
    });
  });

  console.log(`   WebSocket: ws://0.0.0.0:${PORT}/ws/printer`);
}

// ===== 智能分配并推送打印任务 =====
async function assignAndPushOrder(order) {
  if (!wss) return false;

  // 优先检查是否有指定的 printer_id
  let target = null;
  let usedMethod = '';

  if (order.printer_id) {
    // 查找指定的打印机
    const printer = await db.getOne('SELECT * FROM printers WHERE id = ?', [order.printer_id]);
    if (printer) {
      // 在WebSocket连接中查找该打印机
      printClients.forEach(client => {
        if (client.clientId === printer.client_id) {
          client.printers.forEach(p => {
            if (p.name === printer.name && p.status === 'idle') {
              target = {
                ws: client.ws,
                printer: p,
                clientId: client.clientId,
                printerId: printer.id
              };
            }
          });
        }
      });
      if (target) usedMethod = '指定打印机';
    }
  }

  // 如果没有指定打印机或指定打印机未找到，根据 print_tag 匹配
  if (!target) {
    const tag = order.print_tag || getOrderTag(order.order_type, order.extra_info);
    target = findPrinterByTag(tag);
    if (target) usedMethod = `标签匹配(${tag})`;
  }

  if (target) {
    // 找到目标打印机，推送给对应客户端
    const msg = JSON.stringify({
      type: 'print_task',
      data: [order],
      targetPrinter: target.printer.name,
    });
    target.ws.send(msg);

    // 标记打印机忙碌
    target.printer.status = 'busy';
    await db.query("UPDATE printers SET status = 'busy', updated_at = NOW() WHERE name = ? AND client_id = ?",
      [target.printer.name, target.clientId]);
    await db.query("UPDATE orders SET status = 'printing', printer_id = (SELECT id FROM printers WHERE name = ? AND client_id = ? LIMIT 1), print_start_time = NOW(), updated_at = NOW() WHERE order_no = ?",
      [target.printer.name, target.clientId, order.order_no]);

    console.log(`[分配] 订单 ${order.order_no} (${usedMethod}) → ${target.printer.name} @ ${target.clientId}`);
    return true;
  }

  // 没有匹配打印机，广播给所有客户端（降级处理）
  const tag = order.print_tag || getOrderTag(order.order_type, order.extra_info);
  console.log(`[分配] 订单 ${order.order_no} (${tag}) → 无匹配打印机，广播`);
  const msg = JSON.stringify({ type: 'print_task', data: [order] });
  printClients.forEach((client) => {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  });
  return false;
}

// ===== 启动 =====
async function start() {
  try {
    // 测试数据库连接
    await db.query('SELECT 1');
    console.log('MySQL 连接成功');

    // 初始化缓存
    cache.init();

    // HTTP 服务器（监听 3000 端口，由 Nginx 反代到 443）
    const http = require('http');
    const server = http.createServer(app).listen(PORT, '127.0.0.1', () => {
      console.log(`\n🖨️  打印管理后台已启动`);
      console.log(`   地址: http://127.0.0.1:${PORT} (Nginx反代到 443)`);
      console.log(`   WebSocket: ws://127.0.0.1:${PORT}/ws/printer (Nginx反代到 wss://)`);
      console.log(`   账号: admin / admin123`);
      console.log(`   环境: ${process.env.NODE_ENV || 'development'}`);
    });

    // 初始化 WebSocket（绑定到 HTTP 服务器）
    initWebSocket(server);
  } catch (err) {
    console.error('启动失败:', err.message);
    console.error('请检查 MySQL 配置和 .env 文件');

    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM，正在关闭...');
  await db.close();
  await cache.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT，正在关闭...');
  await db.close();
  await cache.close();
  process.exit(0);
});

start();
