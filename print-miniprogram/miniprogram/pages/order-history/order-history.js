// pages/order-history/order-history.js - 【修复v2】：字段映射 + 游客/账号隔离 + 取单号显示
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    orders: [],
    loading: false,
    page: 1,
    pageSize: 10,
    hasMore: true,
    status: '',
    isGuest: false,
    statusText: {
      '': '全部订单', 'pending': '待支付', 'paid': '已支付',
      'printing': '打印中', 'completed': '已完成', 'cancelled': '已取消', 'print_failed': '打印失败'
    }
  },

  onLoad: function (options) {
    if (options && options.status) this.setData({ status: options.status })
    if (app.globalData._filterStatus) {
      this.setData({ status: app.globalData._filterStatus })
      app.globalData._filterStatus = ''
    }
    this.loadOrders(true)
  },

  onShow: function () {
    this.loadOrders(true)
  },

  // 将 API 蛇底字段映射为驼峰
  normalizeOrder: function (raw) {
    if (!raw) return null
    return {
      id:             raw.id,
      orderNo:        raw.order_no || raw.orderNo,
      openid:         raw.openid,
      deviceId:       raw.device_id || raw.deviceId,
      fileName:       raw.file_name || raw.fileName,
      fileUrl:        raw.file_url || raw.fileUrl,
      files:          raw.files,
      pageCount:      raw.page_count || raw.pageCount || 1,
      copies:         raw.copies || 1,
      colorMode:      raw.color_mode || raw.colorMode || 'bw',
      paperSize:      raw.paper_size || raw.paperSize || 'A4',
      printFee:       parseFloat(raw.print_fee || raw.printFee || 0),
      serviceFee:     parseFloat(raw.service_fee || raw.serviceFee || 0),
      pointsUsed:     raw.points_used || raw.pointsUsed || 0,
      pointsDiscount: parseFloat(raw.points_discount || raw.pointsDiscount || 0),
      actualPay:      parseFloat(raw.actual_pay || raw.actualPay || 0),
      status:         raw.status || '',
      orderType:      raw.order_type || raw.orderType || '',
      createdAt:      raw.created_at || raw.createTime || raw.createdAt,
      createTime:     raw.created_at || raw.createTime || raw.createdAt,
      payTime:        raw.pay_time || raw.payTime || null,
      orderSeq:       raw.order_seq || null,
      printSeq:       raw.print_seq || (raw.order_seq ? String(raw.order_seq).padStart(4, '0') : null),
      docSeqDate:     raw.doc_seq_date || null,
      isDocOrder:     !!(raw.order_seq && raw.doc_seq_date) || !!(raw.print_seq),
    }
  },

  loadOrders: function (refresh) {
    const self = this
    if (this.data.loading) return
    const page = refresh ? 1 : this.data.page
    this.setData({ loading: true })

    // 【修复v2】获取当前登录/游客标识
    const { openid, deviceId } = app.getOrderIdentity()
    const isGuest = !openid
    this.setData({ isGuest })

    if (!openid && !deviceId) {
      this.setData({ orders: [], loading: false, hasMore: false })
      wx.stopPullDownRefresh()
      return
    }

    // 【修复v2】账号模式用 openid，游客模式用 deviceId，都传进去
    const params = isGuest
      ? { deviceId, page, pageSize: this.data.pageSize }
      : { openid, page, pageSize: this.data.pageSize }

    api.getMyOrders(page, this.data.pageSize, isGuest ? deviceId : null, isGuest ? null : openid)
      .then(function (res) {
        if (res.code === 200) {
          let newOrders = (res.data.list || []).map(o => self.normalizeOrder(o))
          if (self.data.status) {
            newOrders = newOrders.filter(o => o.status === self.data.status)
          }
          const orders = refresh ? newOrders : self.data.orders.concat(newOrders)
          self.setData({
            orders,
            page: page + 1,
            hasMore: (res.data.list || []).length >= self.data.pageSize
          })
        }
      }).catch(function (err) {
        console.error('[订单历史] 加载失败:', err)
      }).finally(function () {
        self.setData({ loading: false })
        wx.stopPullDownRefresh()
      })
  },

  switchStatus: function (e) {
    this.setData({ status: e.currentTarget.dataset.status })
    this.loadOrders(true)
  },

  viewOrder: function (e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?orderNo=${e.currentTarget.dataset.orderno}` })
  },

  payOrder: function (e) {
    wx.navigateTo({ url: `/pages/payment/payment?orderNo=${e.currentTarget.dataset.orderno}` })
  },

  cancelOrder: function (e) {
    const self = this
    const orderNo = e.currentTarget.dataset.orderno
    wx.showModal({
      title: '确认取消',
      content: '确定要取消这个订单吗？',
      success: function (res) {
        if (res.confirm) {
          api.cancelOrder(orderNo).then(function (res) {
            if (res.code === 200) {
              wx.showToast({ title: '取消成功', icon: 'success' })
              self.loadOrders(true)
            } else {
              wx.showToast({ title: res.msg || '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  formatTime: function (dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  },

  getStatusText: function (status) { return this.data.statusText[status] || status },
  getStatusClass: function (status) { return 'tag-' + status },

  onPullDownRefresh: function () { this.loadOrders(true) },
  onReachBottom: function () { if (this.data.hasMore && !this.data.loading) this.loadOrders() }
})
