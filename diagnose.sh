#!/bin/bash
# 诊断脚本 - 在服务器上运行

echo "=== 检查文件是否存在 ==="
ls -la /opt/print-miniprogram-admin/src/utils.js 2>&1
ls -la /opt/print-miniprogram-admin/src/routes/public.js 2>&1

echo ""
echo "=== 检查目录结构 ==="
ls -la /opt/print-miniprogram-admin/src/

echo ""
echo "=== 检查文件内容（前5行）==="
head -5 /opt/print-miniprogram-admin/src/utils.js 2>&1

echo ""
echo "=== 检查权限 ==="
stat /opt/print-miniprogram-admin/src/utils.js 2>&1

echo ""
echo "=== 手动测试 require ==="
cd /opt/print-miniprogram-admin && node -e "console.log(require('./src/utils'))" 2>&1
