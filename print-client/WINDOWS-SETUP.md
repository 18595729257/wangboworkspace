# 🖨️ Windows 打印客户端部署教程

> 零基础也能搞定，跟着步骤走就行。

---

## 第一步：安装 Node.js

1. 打开浏览器，访问 https://nodejs.org
2. 点击左边那个绿色按钮 **「LTS 推荐版本」** 下载
3. 双击安装包，一路 **Next** 直到完成
4. 验证安装：按 `Win + R`，输入 `cmd`，回车，输入：

```bash
node -v
```

看到类似 `v22.22.1` 就说明装好了。

---

## 第二步：把客户端文件拷到 Windows

把 `print-client` 整个文件夹拷到 Windows 电脑上，比如放到：

```
C:\print-client\
├── client.js
├── printer.js
├── config.js
├── config.example.js
├── package.json
├── README.md
└── downloads\        ← 运行后自动创建
```

可以用 U盘、微信传文件、或者直接从 Mac 拷贝都行。

---

## 第三步：安装依赖

1. 打开 `print-client` 文件夹
2. 在地址栏输入 `cmd` 然后回车（会在这个目录打开命令行）
3. 输入：

```bash
npm install
```

看到 `added 1 package` 就成功了。

---

## 第四步：查看你的打印机名称

在命令行里输入：

```bash
node client.js --verbose
```

会输出类似这样的信息：

```
[22:50:30] API: http://121.43.241.95
[22:50:30] 检测到 3 台打印机:
[22:50:30]   HP LaserJet Pro M404 [normal] idle
[22:50:30]   Microsoft Print to PDF [normal] idle
[22:50:30]   Canon PIXMA G6080 [normal] idle
```

**记下你打印机的名称**，下一步要用。

> 💡 也可以在 Windows 里查看：设置 → 设备 → 打印机和扫描仪

---

## 第五步：配置打印机标签

用记事本（或任意编辑器）打开 `config.js`，修改 `TAG_MAPPING`：

```js
TAG_MAPPING: {
  // 把下面改成你实际的打印机名称和标签

  'HP LaserJet Pro M404': ['normal'],              // 黑白打印机
  'Canon PIXMA G6080': ['color', 'photo'],         // 彩色+照片
  // '你的打印机名称': ['idcard'],                  // 证件打印机
},
```

**标签说明：**

| 标签 | 含义 | 接什么活 |
|------|------|---------|
| `normal` | 普通黑白 | 文档打印（黑白） |
| `color` | 彩色 | 文档打印（彩色） |
| `photo` | 照片 | 照片打印 |
| `idcard` | 证件 | 证件复印 |

**一台打印机可以有多个标签**，比如 `['normal', 'color']` 表示这台机器黑白彩色都能打。

**如果你只有一台打印机**，让它什么都接：
```js
TAG_MAPPING: {
  '你的打印机名称': ['normal', 'color', 'photo', 'idcard'],
},
```

---

## 第六步：测试运行

配置好后，再次运行：

```bash
node client.js
```

看到类似这样的输出就成功了：

```
╔══════════════════════════════════════╗
║     智能打印客户端 v3.0              ║
║     标签分配 + WebSocket推送          ║
╚══════════════════════════════════════╝

[22:52:00] API: http://121.43.241.95
[22:52:00] 检测到 2 台打印机:
[22:52:00]   HP LaserJet Pro M404 [normal] idle
[22:52:00]   Canon PIXMA G6080 [color,photo] idle
[22:52:00] ✅ 打印机已同步
[22:52:00] 连接 WebSocket: ws://121.43.241.95/ws/printer
[22:52:00] ✅ WebSocket 已连接
[22:52:00] ✅ 注册成功: printer-前台PC-admin (2台)
[22:52:00] 启动轮询降级模式（WebSocket断开时生效）
```

> ⚠️ 这个窗口不能关，关了就不接收打印任务了。

---

## 第七步：设置开机自启（推荐）

让电脑一开机就自动运行打印客户端，不用每次手动打开。

### 方法一：用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动客户端
pm2 start client.js --name print-client

# 设置开机自启
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行命令，复制那行命令再执行一次就行。

**常用命令：**
```bash
pm2 list              # 查看状态
pm2 logs print-client # 看日志
pm2 restart print-client  # 重启
pm2 stop print-client     # 停止
```

### 方法二：用 Windows 任务计划

1. 按 `Win + R`，输入 `taskschd.msc`，回车
2. 右边点 **「创建基本任务」**
3. 名称填 `打印客户端`
4. 触发器选 **「计算机启动时」**
5. 操作选 **「启动程序」**
6. 程序填：
   ```
   C:\Program Files\nodejs\node.exe
   ```
7. 参数填：
   ```
   client.js
   ```
8. 起始位置填：
   ```
   C:\print-client
   ```
9. 完成

---

## 常见问题

### Q: 报错"未检测到打印机"
A: 检查 Windows 设置 → 设备 → 打印机，确保打印机已安装并在线。

### Q: 报错"需要安装 ws 库"
A: 在 print-client 目录运行 `npm install`。

### Q: WebSocket 连接失败
A: 检查网络是否能访问 121.43.241.95，在浏览器打开 http://121.43.241.95 看看能不能看到管理后台。

### Q: 打印出来是乱码
A: 可能是文件格式不支持。目前支持 PDF 和常见图片格式（jpg/png）。

### Q: 打印速度很慢
A: 大文件下载需要时间，这是正常的。如果一直卡住，检查网络连接。

### Q: 想同时在多台电脑部署
A: 每台电脑都按这个教程装一遍就行。每台电脑的 `CLIENT_ID` 会自动生成不同，云端会自动区分。

### Q: 怎么改服务器地址
A: 编辑 `config.js`，修改 `API_URL` 那一行。

---

## 部署完成检查清单

- [ ] Node.js 已安装（`node -v` 能看到版本号）
- [ ] npm 依赖已安装（`npm install` 成功）
- [ ] 打印机已连接并被检测到
- [ ] `config.js` 已配置打印机标签
- [ ] 客户端能连接云端（看到 `✅ WebSocket 已连接`）
- [ ] 打印机已同步到云端（看到 `✅ 注册成功`）
- [ ] （推荐）已设置开机自启

---
