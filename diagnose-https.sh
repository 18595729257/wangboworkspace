#!/bin/bash
# 滴滴云印 HTTPS 问题诊断脚本
# 在服务器 39.104.59.201 上执行

echo "================================"
echo "滴滴云印 HTTPS 诊断报告"
echo "================================"
echo ""

echo "1. 检查 Nginx 配置"
echo "-------------------"
sudo nginx -t 2>&1 | head -20
echo ""

echo "2. Nginx SSL 配置片段"
echo "---------------------"
sudo grep -r "ssl_certificate" /etc/nginx/ 2>/dev/null | grep -v ".example"
echo ""

echo "3. 域名监听配置"
echo "---------------"
sudo grep -r "xinbingcloudprint.top" /etc/nginx/ 2>/dev/null | head -20
echo ""

echo "4. Nginx 错误日志（最近 10 行）"
echo "-------------------------------"
if [ -f /var/log/nginx/error.log ]; then
  sudo tail -10 /var/log/nginx/error.log
else
  echo "错误日志文件未找到"
fi
echo ""

echo "5. 证书文件检查"
echo "---------------"
CERT_PATH="/etc/nginx/ssl/xinbingcloudprint.top"
if [ -f "$CERT_PATH.crt" ] || [ -f "$CERT_PATH.pem" ]; then
  echo "证书文件存在"
  openssl x509 -in "$CERT_PATH.crt" 2>/dev/null | grep -E "Subject:|Issuer:" || openssl x509 -in "$CERT_PATH.pem" 2>/dev/null | grep -E "Subject:|Issuer:"
else
  echo "证书文件未找到: $CERT_PATH.{crt,pem}"
fi
echo ""

echo "6. 服务端口监听"
echo "--------------"
sudo netstat -tlnp | grep -E "443|3000" || sudo ss -tlnp | grep -E "443|3000"
echo ""

echo "================================"
echo "诊断完成"
echo "================================"
