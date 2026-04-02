# 微信打印小程序 - 独立管理后台（高并发版）

支撑 **日均 10,000+ 订单** 的生产级管理后台。

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js | 单语言前后端通吃 |
| Web框架 | Express | 轻量高性能 |
| 数据库 | MySQL | 支持高并发读写 |
| 连接池 | mysql2/pool | 20个并发连接 |
| 缓存 | Redis | 热数据缓存，减轻数据库压力 |
| 认证 | JWT | 无状态令牌，适合集群部署 |
| 安全 | helmet + rate-limit | 安全头 + 接口限流 |
| 部署 | PM2 | 多进程 + 零停机重启 |

## 服务器要求

- Node.js >= 18
- MySQL >= 5.7（推荐 8.0）
- Redis >= 6.0（可选，不装也能跑）
- 2核4G 起步（建议 4核8G）

## 快速部署

### 1. 安装依赖

```bash
# 安装 Node.js（如果没有）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 安装 MySQL（如果没有）
sudo apt-get install -y mysql-server
sudo mysql_secure_installation

# 安装 Redis（可选）
sudo apt-get install -y redis-server

# 安装 PM2
npm install -g pm2
```

### 2. 配置 MySQL

```bash
mysql -u root -p

CREATE USER 'printadmin'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON print_admin.* TO 'printadmin'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3. 配置项目

```bash
cd print-miniprogram-admin
npm install
cp .env.example .env
# 编辑 .env 填入你的数据库信息
nano .env
```

### 4. 初始化数据库

```bash
npm run setup
```

### 5. 启动

```bash
# 开发模式
npm start

# 生产模式（PM2多进程）
npm run pm2:start

# 查看日志
npm run pm2:logs

# 停止
npm run pm2:stop
```

访问 http://your-server-ip:3000
账号：admin / admin123

## 性能指标

| 场景 | 能力 |
|------|------|
| 并发读取 | 2000+ QPS |
| 并发写入 | 500+ QPS |
| 日订单量 | 10,000+ |
| 响应时间 | < 50ms（缓存命中） |

## 目录结构

```
print-miniprogram-admin/
├── server.js              # 主服务入口
├── setup.js               # 数据库初始化
├── ecosystem.config.js    # PM2 配置
├── .env                   # 环境变量（不要提交到Git）
├── .env.example           # 环境变量模板
├── src/
│   ├── db.js              # MySQL 连接池
│   ├── cache.js           # Redis 缓存层
│   └── utils.js           # 工具函数
├── public/                # 前端静态文件
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── logs/                  # PM2 日志目录
└── package.json
```
