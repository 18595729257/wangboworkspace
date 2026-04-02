// src/cache.js - Redis 缓存层（可选，未配置则跳过）
const Redis = require('ioredis');

let redis = null;
let enabled = false;

function init() {
  const host = process.env.REDIS_HOST;
  if (!host) {
    console.log('Redis 未配置，缓存功能已跳过');
    return;
  }

  redis = new Redis({
    host,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
    retryStrategy(times) {
      if (times > 3) return null; // 重试3次后放弃
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  redis.on('connect', () => { enabled = true; console.log('Redis 已连接'); });
  redis.on('error', (err) => {
    if (enabled) console.error('Redis 错误:', err.message);
    enabled = false;
  });

  redis.connect().catch(() => {
    console.log('Redis 连接失败，缓存功能已跳过');
  });
}

// 获取缓存
async function get(key) {
  if (!enabled) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

// 设置缓存（TTL秒）
async function set(key, value, ttl = 300) {
  if (!enabled) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch {}
}

// 删除缓存
async function del(key) {
  if (!enabled) return;
  try { await redis.del(key); } catch {}
}

// 删除匹配的缓存
async function delPattern(pattern) {
  if (!enabled) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch {}
}

// 关闭
async function close() {
  if (redis) { await redis.quit(); redis = null; enabled = false; }
}

module.exports = { init, get, set, del, delPattern, close, isEnabled: () => enabled };
