# 打印管理后台 print-miniprogram-admin

## 重构说明

本项目已从 1592 行单文件重构为模块化架构。

## 目录结构

```
src/
├── db.js              # MySQL 连接池
├── cache.js           # Redis 缓存层（可选）
├── utils.js           # 工具函数（统一响应、日志、日期等）
├── routes/
│   ├── auth.js        # 认证（登录、修改密码）
│   ├── dashboard.js   # 仪表盘统计
│   ├── orders.js      # 订单 CRUD + 批量重打
│   ├── printers.js    # 打印机管理
│   ├── users.js       # 用户管理 + 积分调整
│   ├── config.js      # 系统配置
│   └── public.js      # 小程序公开接口 + 文件上传
└── services/
    └── websocket.js   # WebSocket 智能打印机分配
```

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 复制环境配置
cp .env.example .env
# 编辑 .env 填入数据库和微信配置

# 3. 启动（开发）
npm run dev

# 4. 启动（生产）
pm2 start ecosystem.config.js
```

## 健康检查

```bash
curl https://xinbingcloudprint.top/health
curl https://xinbingcloudprint.top/ready
```

## 接口文档（需管理员 Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 登录 |
| GET | /api/dashboard | 仪表盘数据 |
| GET | /api/orders | 订单列表 |
| GET | /api/printers | 打印机列表 |
| GET | /api/users | 用户列表 |
| GET | /api/config | 系统配置 |
| PUT | /api/orders/:id/status | 更新订单状态 |
| POST | /api/orders/batch-reprint | 批量重打 |

## 详细文档

- [部署指南](../部署指南.md)
- [服务端部署](../docs/服务端部署.md)
- [回滚方案](../docs/回滚方案.md)
- [故障排查](../docs/故障排查.md)
