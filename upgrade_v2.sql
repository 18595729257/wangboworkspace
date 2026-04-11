-- ============================================================
-- 需求1+2 升级：数据库迁移脚本 v2
-- 运行方式: mysql -uroot -p print_admin < upgrade_v2.sql
-- ============================================================

-- 1. orders 表新增字段：device_id（游客订单归属）+ 取单号已存在则跳过
-- 注意：order_seq 和 doc_seq_date 已在 v1 中存在，此处确保字段完整

ALTER TABLE orders
  ADD COLUMN device_id VARCHAR(128) DEFAULT NULL COMMENT '设备唯一标识（游客模式用）' AFTER openid,
  ADD COLUMN print_seq VARCHAR(16) DEFAULT NULL COMMENT '取单号（展示用，如0001）' AFTER order_seq,
  MODIFY COLUMN order_seq INT DEFAULT NULL COMMENT '每日序号(文档类打印专用)' AFTER files,
  MODIFY COLUMN doc_seq_date DATE DEFAULT NULL COMMENT '序号对应的日期(用于重置计数)' AFTER order_seq;

-- 2. 确保 index 存在
CREATE INDEX idx_device_id ON orders (device_id) IF NOT EXISTS;
CREATE INDEX idx_doc_seq_date ON orders (doc_seq_date) IF NOT EXISTS;

-- 3. 更新 print_seq 字段（从 order_seq 同步，格式化为4位）
-- 已在 cover.js 的 processOrderFiles 中处理，此处提供兜底 SQL
UPDATE orders SET print_seq = LPAD(order_seq, 4, '0') WHERE order_seq IS NOT NULL AND print_seq IS NULL;
