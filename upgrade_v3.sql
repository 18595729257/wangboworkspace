-- ============================================================
-- 小程序首页入口开关配置升级脚本
-- 运行方式: mysql -uroot -p print_admin < upgrade_v3.sql
-- ============================================================

-- 1. 添加/更新入口开关配置
INSERT INTO config (`key`, `value`, `updated_at`) VALUES
  ('enable_upload', '1', NOW()),      -- 文档&图片打印
  ('enable_idcard', '1', NOW()),      -- 证件复印
  ('enable_photo', '1', NOW()),       -- 照片打印
  ('enable_factory', '1', NOW())      -- 工厂发货
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = NOW();

-- 2. 确认配置存在
SELECT `key`, `value` FROM config WHERE `key` LIKE 'enable_%';
