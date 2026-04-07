# 域名配置步骤 - xinbingprint.top

## 第一步：DNS配置（必须完成）

登录你的域名管理后台（阿里云/腾讯云等），添加A记录：

**主记录：**
- 记录类型: A
- 主机记录: @ （代表根域名）
- 记录值: 39.104.59.201
- TTL: 600（10分钟）
- 状态: 启用

**可选：www子域名**
- 记录类型: A
- 主机记录: www
- 记录值: 39.104.59.201
- TTL: 600

保存后等待5-30分钟生效。

## 第二步：确认DNS生效

等待后，在本地执行检查：
```bash
nslookup xinbingprint.top 8.8.8.8

# 应该显示类似：
# Name:    xinbingprint.top
# Address: 39.104.59.201
```

如果看到Address: 39.104.59.201，说明DNS生效了。

## 第三步：执行证书申请（DNS生效后）

DNS生效后，我帮你自动申请SSL证书和配置Nginx。

**或者手动执行：**
```bash
# 登录服务器
ssh root@39.104.59.201

# 创建目录
mkdir -p /var/www/certbot

# 申请证书
certbot certonly --webroot -w /var/www/certbot -d xinbingprint.top --email 你的邮箱 --agree-tos --no-eff-email

# 测试并重载Nginx
nginx -t && nginx -s reload
```

## 第四步：更新客户端配置

申请证书成功后，将config.js中的域名改为xinbingprint.top：
```js
WS_URL: 'wss://xinbingprint.top/ws/printer'
```

---

**当前状态：**
- ✅ xinbingcloudprint.top 已配置好，立即可用
- ⏳ xinbingprint.top 等待DNS配置
- 📝 Nginx配置文件已准备好
- 📝 SSL证书申请脚本已准备好
