# 智能打印客户端 v3.0

自动从云端拉取打印任务，根据标签智能分配打印机。

## Windows 安装

```bash
# 1. 安装 Node.js（https://nodejs.org 下载 LTS 版本）
# 2. 安装依赖
npm install

# 3. 先运行一次，查看你的打印机名称
node client.js --verbose

# 4. 编辑 config.js，配置打印机标签
# 5. 再次运行
node client.js
```

## 打印机标签说明

| 标签 | 用途 | 小程序对应 |
|------|------|-----------|
| `normal` | 普通黑白文档 | 文档打印(黑白) |
| `color` | 彩色文档 | 文档打印(彩色) |
| `photo` | 照片打印 | 照片打印 |
| `idcard` | 证件复印 | 证件复印 |

一台打印机可以有多个标签，比如 `['normal', 'color']` 表示这台机器能打黑白也能打彩色。

## 配置示例（config.js）

```js
TAG_MAPPING: {
  'HP LaserJet Pro M404': ['normal'],           // 黑白打印机
  'HP Color LaserJet Pro': ['normal', 'color'],  // 彩色打印机
  'Canon PIXMA G6080': ['photo', 'color'],       // 照片打印机
}
```

## 工作流程

```
用户下单(选择类型) → 云端匹配标签 → 找到对应打印机 → 推送任务
                                              ↓
客户端接收 → 匹配本地打印机 → 打印 → 回传状态
```

## 常见问题

**Q: 怎么看我的打印机叫什么名字？**
A: 运行 `node client.js --verbose`，会列出所有检测到的打印机名称。

**Q: 一台电脑只有一种打印机怎么办？**
A: 配一个标签就行，比如 `['normal']`。其他类型的任务会推给别的电脑。

**Q: 断网了怎么办？**
A: WebSocket 断开后自动降级为轮询模式（每3秒查一次），重连后切回推送。

**Q: 想装成 Windows 服务开机自启？**
A: 用 `pm2` 或 `node-windows`：
```bash
npm install -g pm2
pm2 start client.js --name print-client
pm2 save
pm2 startup
```
