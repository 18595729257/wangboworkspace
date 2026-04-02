# 打印管理后台 - CentOS 7.9 部署指南

## 一、连接服务器
```bash
ssh root@你的服务器IP
```

## 二、安装 Node.js 20
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
node -v
npm -v
```

## 三、安装 MySQL 8.0
```bash
# 添加 MySQL 8.0 源
rpm -Uvh https://dev.mysql.com/get/mysql80-community-release-el7-9.noarch.rpm
yum install -y mysql-community-server --nogpgcheck

# 启动 MySQL
systemctl start mysqld
systemctl enable mysqld

# 获取初始密码
grep 'temporary password' /var/log/mysqld.log
```

## 四、配置 MySQL
```bash
mysql -u root -p
# 输入上面获取的初始密码

# 修改密码（把 YourNewPass123! 换成你自己的密码）
ALTER USER 'root'@'localhost' IDENTIFIED BY 'YourNewPass123!';

# 创建数据库和用户
CREATE DATABASE print_admin DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'printadmin'@'localhost' IDENTIFIED BY 'YourDbPass123!';
GRANT ALL PRIVILEGES ON print_admin.* TO 'printadmin'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 五、安装 Redis（可选但推荐）
```bash
yum install -y redis
systemctl start redis
systemctl enable redis
redis-cli ping
# 应该返回 PONG
```

## 六、安装 Nginx
```bash
yum install -y nginx
systemctl start nginx
systemctl enable nginx
```

## 七、上传项目代码

在你本地电脑执行（把项目传到服务器）：
```bash
# 打包项目（排除不需要的文件）
cd /Users/jjwang/.openclaw/workspace
tar --exclude='node_modules' --exclude='db' --exclude='logs' \
    -czf print-admin.tar.gz print-miniprogram-admin/

# 上传到服务器
scp print-admin.tar.gz root@你的服务器IP:/opt/
```

回到服务器执行：
```bash
cd /opt
tar -xzf print-admin.tar.gz
cd print-miniprogram-admin
npm install --production
```

## 八、配置环境变量
```bash
cat > .env << 'EOF'
PORT=3000
NODE_ENV=production
JWT_SECRET=改成一个随机字符串

# 微信小程序
WX_APPID=wx749cd8c41284e88f
WX_APPSECRET=你的小程序appsecret

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=printadmin
DB_PASSWORD=YourDbPass123!
DB_NAME=print_admin
DB_POOL_SIZE=20

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
EOF
```

## 九、初始化数据库
```bash
npm run setup
```

## 十、安装 PM2 并启动
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# 按提示执行输出的命令（开机自启）
```

## 十一、配置 Nginx 反向代理
```bash
cat > /etc/nginx/conf.d/print-admin.conf << 'EOF'
server {
    listen 80;
    server_name 你的域名或服务器IP;

    # 安全头
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    # 限制请求体大小（上传文件用）
    client_max_body_size 10m;

    # API 请求
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # 前端静态文件
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# 检查配置并重启
nginx -t
systemctl restart nginx
```

## 十二、开放防火墙端口
```bash
# 开放 80 端口（HTTP）
firewall-cmd --permanent --add-service=http
firewall-cmd --reload

# 如果需要 HTTPS（443），后面配证书再开
```

## 十三、验证部署
```bash
# 检查服务状态
pm2 status

# 检查端口
curl http://127.0.0.1:3000/health
# 应该返回 {"status":"ok",...}

# 浏览器访问
# http://你的服务器IP
# 账号 admin  密码 admin123
```

## 十四、修改小程序配置

编辑 miniprogram/utils/config.js：
```javascript
const BASE_URL = 'https://你的域名'  // 或 http://你的服务器IP
```

然后在微信公众平台添加服务器域名到 request合法域名。

## 十五、配置 HTTPS（推荐）

```bash
# 安装 certbot
yum install -y certbot python2-certbot-nginx

# 申请证书（需要先有域名且DNS已解析到这台服务器）
certbot --nginx -d yourdomain.com

# 自动续期
echo "0 0,12 * * * root python -c 'import random; import time; time.sleep(random.random() * 3600)' && certbot renew -q" | tee -a /etc/crontab > /dev/null
```

## 常用运维命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs print-admin

# 重启服务
pm2 restart print-admin

# 更新代码后重启
cd /opt/print-miniprogram-admin
git pull  # 或重新上传文件
npm install --production
pm2 restart print-admin

# 查看 MySQL 状态
systemctl status mysqld

# 查看 Redis 状态
systemctl status redis

# 查看 Nginx 状态
systemctl status nginx
```
