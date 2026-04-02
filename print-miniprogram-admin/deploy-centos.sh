#!/bin/bash
# deploy-centos.sh - CentOS 7.9 一键部署脚本
# 用法：chmod +x deploy-centos.sh && ./deploy-centos.sh

set -e

echo "========================================="
echo "  打印管理后台 - CentOS 7.9 自动部署"
echo "========================================="
echo ""

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. 安装 Node.js 20
echo -e "${YELLOW}[1/7] 安装 Node.js 20...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
fi
echo -e "${GREEN}Node.js: $(node -v) | npm: $(npm -v)${NC}"

# 2. 安装 MySQL 8.0
echo -e "${YELLOW}[2/7] 安装 MySQL 8.0...${NC}"
if ! command -v mysql &> /dev/null; then
    rpm -Uvh https://dev.mysql.com/get/mysql80-community-release-el7-9.noarch.rpm 2>/dev/null || true
    yum install -y mysql-community-server --nogpgcheck
    systemctl start mysqld
    systemctl enable mysqld
    echo -e "${GREEN}MySQL 已安装并启动${NC}"
    echo -e "${YELLOW}请运行以下命令查看初始密码并修改：${NC}"
    echo "  grep 'temporary password' /var/log/mysqld.log"
    echo "  mysql_secure_installation"
else
    echo -e "${GREEN}MySQL 已安装${NC}"
fi

# 3. 安装 Redis
echo -e "${YELLOW}[3/7] 安装 Redis...${NC}"
if ! command -v redis-cli &> /dev/null; then
    yum install -y redis
    systemctl start redis
    systemctl enable redis
fi
echo -e "${GREEN}Redis 已安装${NC}"

# 4. 安装 Nginx
echo -e "${YELLOW}[4/7] 安装 Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    yum install -y nginx
    systemctl start nginx
    systemctl enable nginx
fi
echo -e "${GREEN}Nginx 已安装${NC}"

# 5. 安装 PM2
echo -e "${YELLOW}[5/7] 安装 PM2...${NC}"
npm install -g pm2 2>/dev/null
echo -e "${GREEN}PM2 已安装${NC}"

# 6. 安装项目依赖
echo -e "${YELLOW}[6/7] 安装项目依赖...${NC}"
cd "$(dirname "$0")"
npm install --production
echo -e "${GREEN}依赖安装完成${NC}"

# 7. 提示配置
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  基础环境安装完成！${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "接下来需要手动执行："
echo ""
echo "1. 配置 MySQL："
echo "   mysql -u root -p"
echo "   ALTER USER 'root'@'localhost' IDENTIFIED BY '你的密码';"
echo "   CREATE DATABASE print_admin DEFAULT CHARACTER SET utf8mb4;"
echo "   CREATE USER 'printadmin'@'localhost' IDENTIFIED BY '数据库密码';"
echo "   GRANT ALL ON print_admin.* TO 'printadmin'@'localhost';"
echo "   FLUSH PRIVILEGES;"
echo ""
echo "2. 编辑 .env 文件："
echo "   nano .env"
echo "   （填入数据库密码、小程序AppSecret等）"
echo ""
echo "3. 初始化数据库："
echo "   npm run setup"
echo ""
echo "4. 启动服务："
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "5. 配置 Nginx（参考 DEPLOY.md）"
echo ""
