// app.js - 智能打印管理后台 前端逻辑（打印机标签管理版）
const { createApp, ref, reactive, computed, onMounted, watch, nextTick } = Vue;

createApp({
  setup() {
    // ===== 状态 =====
    const token = ref(localStorage.getItem('admin_token') || '');
    const adminName = ref(localStorage.getItem('admin_name') || '');
    const currentView = ref('dashboard');
    const currentTime = ref('');
    const loginLoading = ref(false);
    const loginError = ref('');
    const loginForm = reactive({ username: '', password: '' });

    const icons = {
      dashboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="14" y="10" width="7" height="11" rx="1.5"/><rect x="3" y="13" width="7" height="8" rx="1.5"/></svg>',
      orders: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',
      printer: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
      users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
      pricing: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
      settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
      logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
      search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      save: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
      key: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
      eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    };

    const menuItems = [
      { key: 'dashboard', label: '仪表盘', icon: icons.dashboard },
      { key: 'orders', label: '订单管理', icon: icons.orders },
      { key: 'printers', label: '打印机管理', icon: icons.printer },
      { key: 'users', label: '用户管理', icon: icons.users },
      { key: 'pricing', label: '价格设置', icon: icons.pricing },
      { key: 'settings', label: '系统设置', icon: icons.settings },
    ];

    const currentMenuLabel = computed(() => menuItems.find(m => m.key === currentView.value)?.label || '');

    // ===== 数据 =====
    const dash = reactive({ revenue: {}, trend: [], statusDist: [], recentOrders: [], userCount: 0, printerStats: {} });
    const orders = reactive({ list: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    const ordersFilter = reactive({ status: '', orderType: '', keyword: '', dateFrom: '', dateTo: '', page: 1 });
    const selectedOrderIds = ref([]); // 当前选中的订单ID（用于批量重打，支持所有状态）
    const printers = ref([]);
    const entryTypes = ref([]);
    const printerFilter = reactive({ entryType: '', status: '' });
    const users = reactive({ list: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    const usersFilter = reactive({ keyword: '', page: 1 });
    const config = reactive({});
    const passwordForm = reactive({ old: '', new: '', confirm: '' });

    const modal = reactive({ show: false, type: '', title: '', data: {} });
    const toast = reactive({ show: false, msg: '', type: 'success' });

    let revenueChartInstance = null;
    let statusChartInstance = null;

    // ===== 过滤后的打印机列表 =====
    const filteredPrinters = computed(() => {
      return printers.value.filter(p => {
        if (printerFilter.entryType && !(p.entry_types || []).includes(printerFilter.entryType)) return false;
        if (printerFilter.status && p.status !== printerFilter.status) return false;
        return true;
      });
    });

    // ===== API =====
    async function api(url, options = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (token.value) headers['Authorization'] = 'Bearer ' + token.value;
      try {
        const res = await fetch(url, { ...options, headers });
        const data = await res.json();
        if (data.code === 401) { token.value = ''; localStorage.removeItem('admin_token'); showToast('登录已过期', 'error'); }
        return data;
      } catch (err) { showToast('网络请求失败', 'error'); return { code: 500 }; }
    }

    function showToast(msg, type = 'success') {
      toast.msg = msg; toast.type = type; toast.show = true;
      setTimeout(() => { toast.show = false; }, 2500);
    }

    // ===== 登录 =====
    async function doLogin() {
      if (!loginForm.username || !loginForm.password) { loginError.value = '请输入用户名和密码'; return; }
      loginLoading.value = true; loginError.value = '';
      const res = await api('/api/login', { method: 'POST', body: JSON.stringify(loginForm) });
      loginLoading.value = false;
      if (res.code === 200) {
        token.value = res.data.token; adminName.value = res.data.displayName;
        localStorage.setItem('admin_token', res.data.token); localStorage.setItem('admin_name', res.data.displayName);
        loadDashboard();
      } else { loginError.value = res.msg || '登录失败'; }
    }

    function doLogout() { token.value = ''; adminName.value = ''; localStorage.removeItem('admin_token'); localStorage.removeItem('admin_name'); }

    function switchView(view) {
      currentView.value = view;
      if (view === 'dashboard') loadDashboard();
      if (view === 'orders') loadOrders();
      if (view === 'printers') { loadPrinters(); loadEntryTypes(); }
      if (view === 'users') loadUsers();
      if (view === 'pricing' || view === 'settings') loadConfig();
    }

    // ===== 仪表盘 =====
    async function loadDashboard() {
      const res = await api('/api/dashboard');
      if (res.code === 200) { Object.assign(dash, res.data); nextTick(() => renderCharts()); }
    }

    function renderCharts() {
      const trendCtx = document.getElementById('revenueChart');
      if (!trendCtx) return;
      if (revenueChartInstance) revenueChartInstance.destroy();
      revenueChartInstance = new Chart(trendCtx, {
        type: 'bar',
        data: {
          labels: dash.trend.map(t => t.date),
          datasets: [{ label: '收入(元)', data: dash.trend.map(t => t.revenue), backgroundColor: 'rgba(0,122,255,0.72)', borderRadius: 6, barPercentage: 0.55, order: 2 },
            { label: '订单数', data: dash.trend.map(t => t.count), type: 'line', borderColor: '#FF9500', fill: true, pointRadius: 4, yAxisID: 'y1', tension: 0.4, borderWidth: 2, order: 1 }]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } }
      });
      const statusCtx = document.getElementById('statusChart');
      if (!statusCtx) return;
      if (statusChartInstance) statusChartInstance.destroy();
      const sl = { pending: '待支付', paid: '已支付', printing: '打印中', completed: '已完成', cancelled: '已取消' };
      statusChartInstance = new Chart(statusCtx, {
        type: 'doughnut',
        data: { labels: dash.statusDist.map(s => sl[s.status] || s.status), datasets: [{ data: dash.statusDist.map(s => s.count), backgroundColor: ['#FF9500', '#007AFF', '#AF52DE', '#34C759', '#FF3B30'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
      });
    }

    // ===== 订单 =====
    async function loadOrders() {
      const p = new URLSearchParams();
      if (ordersFilter.status) p.set('status', ordersFilter.status);
      if (ordersFilter.orderType) p.set('orderType', ordersFilter.orderType);
      if (ordersFilter.keyword) p.set('keyword', ordersFilter.keyword);
      if (ordersFilter.dateFrom) p.set('dateFrom', ordersFilter.dateFrom);
      if (ordersFilter.dateTo) p.set('dateTo', ordersFilter.dateTo);
      p.set('page', ordersFilter.page); p.set('pageSize', '20');
      const res = await api('/api/orders?' + p);
      if (res.code === 200) Object.assign(orders, res.data);
    }

    function exportOrders() {
      const p = new URLSearchParams();
      if (ordersFilter.status) p.set('status', ordersFilter.status);
      if (ordersFilter.dateFrom) p.set('dateFrom', ordersFilter.dateFrom);
      if (ordersFilter.dateTo) p.set('dateTo', ordersFilter.dateTo);
      window.open('/api/orders/export/csv?' + p, '_blank');
    }

    async function assignPrinter(order) {
      if (printers.value.length === 0) await loadPrinters();
      modal.type = 'assignPrinter'; modal.title = '分配打印机';
      modal.data = { ...order, selectedPrinter: '' }; modal.show = true;
    }

    async function completeOrder(order) {
      if (!confirm('确认完成打印？')) return;
      const res = await api(`/api/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
      if (res.code === 200) { showToast('订单已完成'); loadOrders(); } else showToast(res.msg, 'error');
    }

    async function changeOrderStatus(order, status) {
      if (!status) return;
      if (!confirm(`确认更改为「${statusText(status)}」？`)) return;
      const res = await api(`/api/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      if (res.code === 200) { showToast('状态已更新'); loadOrders(); } else showToast(res.msg, 'error');
    }

    // ===== 批量重打 =====

    // 计算当前页有多少个可重打的订单（排除已取消和待支付）
    const failedOrderCount = computed(() => orders.list.filter(o => ['paid', 'printing', 'completed', 'print_failed'].includes(o.status)).length);

    // 当前选中的可重打订单ID列表（支持所有可重打状态）
    const selectedReprintOrders = computed(() => {
      const printableIds = orders.list.filter(o => ['paid', 'printing', 'completed', 'print_failed'].includes(o.status)).map(o => o.id);
      return selectedOrderIds.value.filter(id => printableIds.includes(id));
    });

    // 是否全选了
    const allFailedSelected = computed(() => {
      if (failedOrderCount.value === 0) return false;
      return selectedReprintOrders.value.length === failedOrderCount.value;
    });

    // 切换选中/取消
    function toggleOrderSelect(id) {
      const idx = selectedOrderIds.value.indexOf(id);
      if (idx > -1) selectedOrderIds.value.splice(idx, 1);
      else selectedOrderIds.value.push(id);
    }

    // 全选/取消全选（所有可重打的订单）
    function toggleAllFailed(e) {
      if (e.target.checked) {
        const printableIds = orders.list.filter(o => ['paid', 'printing', 'completed', 'print_failed'].includes(o.status)).map(o => o.id);
        // 合并去重
        const merged = new Set([...selectedOrderIds.value, ...printableIds]);
        selectedOrderIds.value = [...merged];
      } else {
        const printableIds = orders.list.filter(o => ['paid', 'printing', 'completed', 'print_failed'].includes(o.status)).map(o => o.id);
        selectedOrderIds.value = selectedOrderIds.value.filter(id => !printableIds.includes(id));
      }
    }

    // 打开批量重打弹窗（支持所有状态订单）
    async function showBatchReprint() {
      if (selectedReprintOrders.value.length === 0) {
        showToast('请先勾选要重打的订单', 'error');
        return;
      }
      // 加载打印机列表
      await loadPrinters();

      // 只显示在线的打印机
      const onlinePrinters = printers.value.filter(p => p.online);
      if (onlinePrinters.length === 0) {
        showToast('当前没有可用的在线打印机', 'error');
        return;
      }

      modal.type = 'batchReprint';
      modal.title = '批量重打';
      modal.data = {
        orderCount: selectedReprintOrders.value.length,
        availablePrinters: onlinePrinters, // 只显示在线打印机
        selectedPrinter: '',
        totalPrinters: printers.value.length,
        onlineCount: onlinePrinters.length
      };
      modal.show = true;
    }

    // 执行批量重打
    async function executeBatchReprint() {
      if (!modal.data.selectedPrinter) {
        showToast('请选择打印机', 'error');
        return;
      }
      const res = await api('/api/orders/batch-reprint', {
        method: 'POST',
        body: JSON.stringify({
          orderIds: selectedReprintOrders.value,
          printerId: modal.data.selectedPrinter
        })
      });
      if (res.code === 200) {
        showToast(res.msg || '重打成功');
        modal.show = false;
        selectedOrderIds.value = []; // 清空选中
        loadOrders(); // 刷新列表
      } else {
        showToast(res.msg || '重打失败', 'error');
      }
    }

    // ===== 打印机管理 =====
    async function loadPrinters() {
      const res = await api('/api/printers');
      if (res.code === 200) printers.value = res.data;
    }

    async function loadEntryTypes() {
      const res = await api('/api/entry-types');
      if (res.code === 200) entryTypes.value = res.data;
    }

    const selectedPrinterIds = ref([]);
    const allPrintersSelected = computed(() => {
      if (filteredPrinters.value.length === 0) return false;
      return filteredPrinters.value.every(p => selectedPrinterIds.value.includes(p.id));
    });

    function togglePrinterSelect(id) {
      const idx = selectedPrinterIds.value.indexOf(id);
      if (idx > -1) selectedPrinterIds.value.splice(idx, 1);
      else selectedPrinterIds.value.push(id);
    }

    function toggleAllPrinters(e) {
      if (e.target.checked) {
        const ids = filteredPrinters.value.map(p => p.id);
        selectedPrinterIds.value = [...new Set([...selectedPrinterIds.value, ...ids])];
      } else {
        const ids = filteredPrinters.value.map(p => p.id);
        selectedPrinterIds.value = selectedPrinterIds.value.filter(id => !ids.includes(id));
      }
    }

    function showBatchPrinterEdit() {
      modal.type = 'batchPrinterEdit';
      modal.title = '批量编辑打印机';
      modal.data = { count: selectedPrinterIds.value.length, entry_types: [], enabled: '' };
      modal.show = true;
    }

    function toggleBatchEntryType(key) {
      const idx = modal.data.entry_types.indexOf(key);
      if (idx > -1) modal.data.entry_types.splice(idx, 1);
      else modal.data.entry_types.push(key);
    }

    async function saveBatchPrinterEdit() {
      const body = {};
      if (modal.data.entry_types.length > 0) body.entry_types = modal.data.entry_types;
      if (modal.data.enabled !== '') body.enabled = modal.data.enabled === '1';
      if (Object.keys(body).length === 0) { showToast('请至少修改一项', 'error'); return; }

      let success = 0;
      for (const id of selectedPrinterIds.value) {
        const res = await api(`/api/printers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (res.code === 200) success++;
      }
      showToast(`批量完成：${success}/${selectedPrinterIds.value.length} 成功`);
      modal.show = false;
      selectedPrinterIds.value = [];
      loadPrinters();
    }

    const idlePrinters = computed(() => printers.value.filter(p => p.status === 'idle' && p.enabled !== 0));

    function showPrinterEdit(p) {
      modal.type = 'printerEdit'; modal.title = p ? '编辑打印机' : '添加打印机';
      modal.data = p ? { ...p, entry_types: [...(p.entry_types || ['print'])], enabled: p.enabled !== 0 } : { name: '', port: '', description: '', entry_types: ['print'], enabled: true, custom_tags: [] };
      modal.show = true;
    }

    function toggleEntryType(key) {
      const idx = modal.data.entry_types.indexOf(key);
      if (idx > -1) modal.data.entry_types.splice(idx, 1);
      else modal.data.entry_types.push(key);
      if (modal.data.entry_types.length === 0) modal.data.entry_types.push(key);
    }

    async function savePrinter() {
      const d = modal.data;
      if (!d.name) { showToast('请输入打印机名称', 'error'); return; }
      const body = { name: d.name, port: d.port || '', description: d.description || '', entry_types: d.entry_types, enabled: d.enabled, custom_tags: d.custom_tags || [] };
      const method = d.id ? 'PUT' : 'POST';
      const url = d.id ? `/api/printers/${d.id}` : '/api/printers';
      const res = await api(url, { method, body: JSON.stringify(body) });
      if (res.code === 200) { showToast(d.id ? '更新成功' : '添加成功'); modal.show = false; loadPrinters(); }
      else showToast(res.msg, 'error');
    }

    async function togglePrinterEnabled(p) {
      const res = await api(`/api/printers/${p.id}`, { method: 'PUT', body: JSON.stringify({ enabled: p.enabled === 0 ? 1 : 0 }) });
      if (res.code === 200) { showToast(p.enabled === 0 ? '已启用' : '已禁用'); loadPrinters(); }
    }

    async function deletePrinter(p) {
      if (!confirm(`确认删除「${p.name}」？`)) return;
      const res = await api(`/api/printers/${p.id}`, { method: 'DELETE' });
      if (res.code === 200) { showToast('删除成功'); loadPrinters(); } else showToast(res.msg, 'error');
    }

    async function showPrinterLogs(p) {
      const res = await api(`/api/printers/${p.id}/logs?pageSize=100`);
      modal.type = 'printerLogs'; modal.title = p.name + ' - 打印日志';
      modal.data = { logs: res.code === 200 ? res.data.list : [], printerName: p.name };
      modal.show = true;
    }

    // ===== 用户管理 =====
    async function loadUsers() {
      const p = new URLSearchParams();
      if (usersFilter.keyword) p.set('keyword', usersFilter.keyword);
      p.set('page', usersFilter.page); p.set('pageSize', '20');
      const res = await api('/api/users?' + p);
      if (res.code === 200) Object.assign(users, res.data);
    }

    async function showUserDetail(user) {
      const res = await api(`/api/users/${user.id}`);
      if (res.code === 200) { modal.type = 'userDetail'; modal.title = '用户详情'; modal.data = res.data; modal.show = true; }
    }

    function showAdjustPoints(user) {
      modal.type = 'adjustPoints'; modal.title = '调整积分';
      modal.data = { ...user, adjustAmount: 0, adjustReason: '' }; modal.show = true;
    }

    // ===== 配置 =====
    async function loadConfig() { const res = await api('/api/config'); if (res.code === 200) Object.assign(config, res.data); }

    async function saveConfig() {
      const res = await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
      if (res.code === 200) showToast('配置已保存'); else showToast(res.msg || '保存失败', 'error');
    }

    async function changePassword() {
      if (passwordForm.new !== passwordForm.confirm) { showToast('两次密码不一致', 'error'); return; }
      if (passwordForm.new.length < 6) { showToast('新密码至少6位', 'error'); return; }
      const res = await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ oldPassword: passwordForm.old, newPassword: passwordForm.new }) });
      if (res.code === 200) { showToast('密码修改成功'); setTimeout(doLogout, 1500); } else showToast(res.msg, 'error');
    }

    // ===== 弹窗确认 =====
    async function modalConfirm() {
      if (modal.type === 'assignPrinter') {
        if (!modal.data.selectedPrinter) { showToast('请选择打印机', 'error'); return; }
        const res = await api(`/api/orders/${modal.data.id}/assign-printer`, { method: 'PUT', body: JSON.stringify({ printerId: modal.data.selectedPrinter }) });
        if (res.code === 200) {
          await api(`/api/orders/${modal.data.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'printing' }) });
          showToast('已分配'); modal.show = false; loadOrders();
        } else showToast(res.msg, 'error');
      }
      if (modal.type === 'adjustPoints') {
        const amount = parseInt(modal.data.adjustAmount);
        if (!amount) { showToast('请输入积分数', 'error'); return; }
        const res = await api(`/api/users/${modal.data.id}/points`, { method: 'POST', body: JSON.stringify({ points: amount, reason: modal.data.adjustReason || '管理员调整' }) });
        if (res.code === 200) { showToast('调整成功'); modal.show = false; loadUsers(); } else showToast(res.msg, 'error');
      }
      if (modal.type === 'batchReprint') {
        await executeBatchReprint();
      }
    }

    // ===== 工具 =====
    function statusText(s) { return { pending: '待支付', paid: '已支付', printing: '打印中', completed: '已完成', cancelled: '已取消', print_failed: '打印失败' }[s] || s; }
    function orderTypeText(t) { return { print: '文档打印', idcard_copy: '证件复印', photo_print: '照片打印', factory: '工厂发货' }[t] || '文档打印'; }
    function entryTypeText(k) { return { print: '文档打印', photo: '照片打印', idcard: '证件复印', factory: '工厂发货' }[k] || k; }
    function formatDate(d) { return d ? d.replace('T', ' ').substring(0, 16) : '-'; }
    function formatLogTime(d) { return d ? d.replace('T', ' ').substring(0, 19) : '-'; }

    function updateClock() {
      const now = new Date();
      currentTime.value = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    onMounted(() => {
      updateClock(); setInterval(updateClock, 1000);
      if (token.value) loadDashboard();
    });

    return {
      icons, token, adminName, currentView, currentTime, menuItems, currentMenuLabel,
      loginForm, loginLoading, loginError, doLogin, doLogout,
      dash, orders, ordersFilter, printers, filteredPrinters, entryTypes, printerFilter, idlePrinters,
      users, usersFilter, config, passwordForm, modal, toast,
      selectedPrinterIds, allPrintersSelected,
      togglePrinterSelect, toggleAllPrinters, showBatchPrinterEdit, toggleBatchEntryType, saveBatchPrinterEdit,
      selectedOrderIds, failedOrderCount, selectedReprintOrders, allFailedSelected,
      toggleOrderSelect, toggleAllFailed, showBatchReprint,
      switchView, loadDashboard, loadOrders, exportOrders,
      assignPrinter, completeOrder, changeOrderStatus,
      loadPrinters, loadEntryTypes, showPrinterEdit, toggleEntryType, savePrinter, togglePrinterEnabled, deletePrinter, showPrinterLogs,
      loadUsers, showUserDetail, showAdjustPoints,
      loadConfig, saveConfig, changePassword,
      modalConfirm, statusText, orderTypeText, entryTypeText, formatDate, formatLogTime,
    };
  }
}).mount('#app');
