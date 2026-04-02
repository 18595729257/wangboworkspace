# 智能打印小程序 - 完整部署指南

## 📋 项目概述

这是一个完整的微信打印小程序系统，包含用户端和店铺管理端。

### 功能特性
- ✅ 先支付后打印，未支付订单禁止提交
- ✅ 价格 = 打印费 + 0.1元服务费
- ✅ 积分系统：消费1元=1积分，100积分抵1元，上限5元
- ✅ 游客模式 + 登录模式
- ✅ 自动分配打印机，禁止拆分打印
- ✅ 实时打印状态更新

## 📁 项目结构

```
print-miniprogram/
├── cloudfunctions/           # 云函数（后端）
│   ├── payment/             # 支付相关
│   │   ├── index.js         # 支付主逻辑
│   │   └── package.json
│   ├── order/               # 订单管理
│   │   ├── index.js
│   │   └── package.json
│   ├── points/              # 积分系统
│   │   ├── index.js
│   │   └── package.json
│   ├── printer/             # 打印机管理
│   │   ├── index.js
│   │   └── package.json
│   ├── queue/               # 打印队列
│   │   ├── index.js
│   │   └── package.json
│   └── user/                # 用户管理
│       ├── index.js
│       └── package.json
├── miniprogram/             # 用户端小程序
│   ├── app.js               # 应用入口
│   ├── app.json             # 应用配置
│   ├── app.wxss             # 全局样式
│   └── pages/
│       ├── index/           # 首页
│       ├── upload/          # 上传文件
│       ├── payment/         # 支付
│       ├── order-detail/    # 订单详情
│       ├── order-history/   # 订单记录
│       ├── points/          # 积分中心
│       └── my/              # 我的
├── admin/                   # 店铺管理端
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   └── pages/
│       ├── dashboard/       # 仪表盘
│       ├── orders/          # 订单管理
│       ├── queue/           # 打印队列
│       └── printer/         # 打印机管理
├── project.config.json      # 项目配置
└── README.md                # 本文档
```

## 🚀 部署步骤

### 第一步：创建云开发环境

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 进入"开发" → "云开发"
3. 点击"开通"创建云开发环境
4. 记录你的 **环境ID**（形如 `cloud1-xxx`）

### 第二步：配置项目

#### 1. 修改 project.config.json
```json
{
  "appid": "你的小程序AppID",  // 替换这里
  ...
}
```

#### 2. 修改 miniprogram/app.js
```javascript
wx.cloud.init({
  env: '你的云开发环境ID',  // 替换这里
  traceUser: true,
})
```

#### 3. 修改 admin/app.js
```javascript
wx.cloud.init({
  env: '你的云开发环境ID',  // 替换这里
  traceUser: true,
})
```

#### 4. 配置微信支付（重要！）

在 `cloudfunctions/payment/index.js` 中：
```javascript
sub_mch_id: '你的子商户号',  // 替换这里
```

### 第三步：创建数据库集合

在云开发控制台 → 数据库中创建以下集合：

| 集合名 | 权限建议 | 说明 |
|--------|---------|------|
| users | 仅创建者可读写 | 用户表 |
| orders | 仅创建者可读写 | 订单表 |
| points_records | 仅创建者可读写 | 积分记录表 |
| printers | 所有用户可读 | 打印机表 |
| print_queue | 所有用户可读 | 打印队列表 |

### 第四步：部署云函数

1. 在微信开发者工具中
2. 右键点击 `cloudfunctions/payment` 目录
3. 选择"上传并部署：云端安装依赖"
4. 对其他5个云函数重复此操作

### 第五步：上传小程序

1. 点击工具栏"上传"按钮
2. 填写版本号（如 1.0.0）
3. 提交审核

## 📊 数据库表结构

### users - 用户表
```javascript
{
  openid: String,      // 微信openid
  nickName: String,    // 昵称
  avatarUrl: String,   // 头像
  points: Number,      // 积分余额
  totalSpent: Number,  // 总消费
  orderCount: Number,  // 订单数
  isLogin: Boolean,    // 是否已登录
  createTime: Date,
  updateTime: Date
}
```

### orders - 订单表
```javascript
{
  orderNo: String,         // 订单号（PR202401011200001234）
  openid: String,          // 用户openid
  fileUrl: String,         // 文件地址
  fileName: String,        // 文件名
  pageCount: Number,       // 页数
  copies: Number,          // 份数
  colorMode: String,       // 'bw'(黑白) 或 'color'(彩色)
  paperSize: String,       // 'A4', 'A3', 'B5'
  printFee: Number,        // 打印费用
  serviceFee: Number,      // 服务费（固定0.1元）
  pointsDiscount: Number,  // 积分抵扣金额
  pointsUsed: Number,      // 使用的积分数
  totalFee: Number,        // 总费用
  actualPay: Number,       // 实付金额
  status: String,          // pending/paid/printing/completed/cancelled
  createTime: Date,
  payTime: Date,
  printStartTime: Date,
  printEndTime: Date,
  printerId: String        // 打印机ID
}
```

### points_records - 积分记录表
```javascript
{
  openid: String,      // 用户openid
  type: String,        // 'earn'(获得), 'consume'(消费), 'refund'(退还)
  points: Number,      // 积分变动（正数为增加，负数为减少）
  reason: String,      // 原因
  orderNo: String,     // 关联订单号
  createTime: Date
}
```

### printers - 打印机表
```javascript
{
  name: String,        // 打印机名称
  model: String,       // 型号
  ip: String,          // IP地址
  port: Number,        // 端口号（默认9100）
  type: String,        // 'thermal'(热敏), 'inkjet'(喷墨), 'laser'(激光)
  status: String,      // 'idle'(空闲), 'busy'(忙碌), 'offline'(离线)
  currentJob: String,  // 当前任务订单号
  totalJobs: Number,   // 总任务数
  createTime: Date,
  updateTime: Date
}
```

### print_queue - 打印队列表
```javascript
{
  orderNo: String,     // 订单号
  openid: String,      // 用户openid
  status: String,      // 'waiting'(等待), 'printing'(打印中), 'completed'(已完成)
  priority: Number,    // 优先级
  printerId: String,   // 打印机ID
  createTime: Date,
  startTime: Date,
  endTime: Date
}
```

## 🔧 常见问题

### Q1: 支付功能不工作？
A: 需要：
1. 开通微信支付
2. 配置子商户号
3. 在云开发控制台配置支付回调

### Q2: 打印机无法连接？
A: 检查：
1. 打印机IP地址是否正确
2. 打印机端口是否开放（默认9100）
3. 网络是否互通

### Q3: 积分没有发放？
A: 积分在订单打印完成后自动发放，请确保：
1. 订单状态变为 `completed`
2. 用户已登录（有openid）

## 📞 技术支持

如有问题，请检查：
1. 云函数日志
2. 数据库数据
3. 网络连接

## 📝 更新日志

### v1.0.0 (2024-01-01)
- 初始版本发布
- 完整的用户端和管理端
- 支持微信支付
- 支持积分系统
- 支持打印队列管理
