// 检查打印机数据的脚本
const Database = require('better-sqlite3');

const db = new Database('print.db');

// 查询所有打印机
const printers = db.prepare('SELECT id, name, port, description, client_id, enabled, status FROM printers').all();

console.log('打印机列表:');
console.table(printers);

// 检查 client_id 是否为空
const emptyClientId = printers.filter(p => !p.client_id || p.client_id === '');
if (emptyClientId.length > 0) {
  console.log('\n⚠️  以下打印机的 client_id 为空:');
  console.table(emptyClientId);
} else {
  console.log('\n✅ 所有打印机都有 client_id');
}

db.close();
