# 调试打印机在线状态问题

## 问题描述

用户点击批量重打时，提示"打印机不在线"，但实际打印机是在线的。

## 可能的原因

1. **WebSocket 客户端未连接成功** - 客户端尝试连接 `wss://xinbingcloudprint.top/ws/printer` 但失败了
2. **客户端未发送注册消息** - 即使连接了，客户端也没有发送 `register` 消息给服务器
3. **clientId 不匹配** - 客户端发送的 `clientId` 与数据库中存储的 `client_id` 不一致
4. **打印机名称不匹配** - 客户端注册的打印机名称与数据库中的名称不一致

## 调试步骤

### 1. 检查前端显示的打印机状态

在浏览器中打开前端页面（例如：https://xinbingcloudprint.top/printers），打开浏览器控制台，执行：

```javascript
// 获取打印机列表
fetch('https://xinbingcloudprint.top/api/printers')
  .then(r => r.json())
  .then(data => {
    console.log('打印机列表:');
    data.data.forEach(p => {
      console.log(`- ${p.name}: online=${p.online}, client_id=${p.client_id}, status=${p.status}`);
    });
  });
```

### 2. 检查客户端的 WebSocket 连接状态

查看 print-client 的控制台输出（终端日志），确认：
- WebSocket 是否成功连接
- 是否发送了 `register` 消息
- `clientId` 是什么
- `printers` 数组包含什么

### 3. 检查服务器的 WebSocket 连接状态

在服务器上执行：

```bash
ssh root@39.104.59.201
pm2 logs print-admin --lines 50
```

查找：
- `[WS] 新客户端连接` - 确认有客户端连接
- `[WS] 客户端注册` - 确认客户端发送了注册消息
- 注册的 `clientId` 和打印机列表

### 4. 对比数据库中的 client_id

在数据库中查询：

```bash
mysql -u root -e "USE print_admin; SELECT id, name, client_id FROM printers;"
```

确保客户端发送的 `clientId` 与数据库中的 `client_id` 匹配。

## 在线状态检查逻辑

### 前端显示的 `online` 字段

来源：`/api/printers` API

逻辑：
```javascript
// 遍历所有连接的 WebSocket 客户端
printClients.forEach((client, clientId) => {
  // 获取客户端注册的所有打印机
  client.printers.forEach(p => {
    // 将组合键加入在线集合
    onlineIds.add(`${clientId}::${p.name}`);
  });
});

// 标记打印机在线状态
const result = printers.map(p => ({
  ...p,
  online: onlineIds.has(`${p.client_id}::${p.name}`),
  // ...
}));
```

### 批量重打 API 的在线检查

逻辑：
```javascript
// 查询打印机
const printer = db.getOne('SELECT * FROM printers WHERE id = ?', [printerId]);

// 遍历所有连接的 WebSocket 客户端
let printerOnline = false;
printClients.forEach((client) => {
  // 检查 clientId 是否匹配
  if (client.clientId !== printer.client_id) return;

  // 检查打印机名称是否匹配
  client.printers.forEach(p => {
    if (p.name === printer.name) {
      printerOnline = true;
    }
  });
});

if (!printerOnline) {
  return res.json({ code: 400, msg: '打印机不在线' });
}
```

## 结论

前端和后端的在线检查逻辑是**一致的**，都基于 WebSocket 客户端的实时连接状态。

如果前端显示"在线"，但后端提示"不在线"，可能的原因是：

1. **前端缓存了旧的打印机列表** - 刷新页面重新获取
2. **打印机名称或 clientId 不匹配** - 检查数据和数据库
3. **WebSocket 连接断开又重连** - 等待客户端重新注册

## 临时解决方案

如果确认打印机在线但后端检查失败，可以在批量重打 API 中临时跳过在线检查（仅用于调试）：

```javascript
// 临时注释掉在线检查
// if (!printerOnline) {
//   return res.json({ code: 400, msg: '打印机不在线' });
// }
```

但这不是长期解决方案，应该找出根本原因。
