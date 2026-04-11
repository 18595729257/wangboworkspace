-- ============================================================
-- 三大功能升级：数据库迁移脚本
-- 运行方式: mysql -uroot print_admin < upgrade.sql
-- ============================================================

-- 1. orders 表新增字段：支持多文件和序号
ALTER TABLE orders
  ADD COLUMN files JSON DEFAULT NULL COMMENT '多文件JSON数组: [{name, url, size, pageCount}]' AFTER file_url,
  ADD COLUMN order_seq INT DEFAULT NULL COMMENT '每日序号(文档类打印专用)' AFTER files,
  ADD COLUMN doc_seq_date DATE DEFAULT NULL COMMENT '序号对应的日期(用于重置计数)' AFTER order_seq,
  MODIFY COLUMN status ENUM('pending','paid','printing','completed','cancelled','print_failed') DEFAULT 'pending';

-- 2. 创建序号序列表（分布式锁 + 序号管理）
CREATE TABLE IF NOT EXISTS order_sequences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seq_date DATE UNIQUE NOT NULL COMMENT '日期',
  current_seq INT DEFAULT 0 NOT NULL COMMENT '当前序号',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seq_date (seq_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 创建序号生成存储过程（原子操作，保证不重复）
DELIMITER //

DROP PROCEDURE IF EXISTS get_next_order_seq//
CREATE PROCEDURE get_next_order_seq(IN p_date DATE, OUT p_seq INT)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_seq = NULL;
  END;

  -- 尝试插入新日期记录
  INSERT IGNORE INTO order_sequences (seq_date, current_seq) VALUES (p_date, 0);

  -- 原子递增并返回
  UPDATE order_sequences SET current_seq = current_seq + 1 WHERE seq_date = p_date;
  SELECT current_seq INTO p_seq FROM order_sequences WHERE seq_date = p_date;
END//

DELIMITER ;

-- 4. 创建索引
CREATE INDEX idx_order_seq_date ON orders (doc_seq_date);
CREATE INDEX idx_order_seq ON orders (order_seq);
