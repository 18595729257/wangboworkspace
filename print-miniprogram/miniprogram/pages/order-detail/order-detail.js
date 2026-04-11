// pages/order-detail/order-detail.js - 【修复v2】：字段映射 + 打印完成显示取单号
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    orderNo: '',
    orderInfo: null,
    loading: false,
    pollingTimer: null,
    showPickupBanner: false
  },

  onLoad: function (options) {
    if (options.orderNo) {
      this.setData({ orderNo: options.orderNo })
      this.loadOrderDetail()
    }
  },

  onShow: function () { this.loadOrderDetail() },

  onUnload: function () {
    if (this.data.pollingTimer) clearInterval(this.data.pollingTimer)
  },

  // 将 API 蛇底命名字段映射为驼峰命名
  normalizeFields: function (raw) {
    if (!raw) return null
    const f = raw
    return {
      id:               f.id,
      orderNo:          f.order_no || f.orderNo,
      openid:           f.openid,
      deviceId:         f.device_id || f.deviceId,
      fileName:         f.file_name || f.fileName,
      fileUrl:          f.file_url || f.fileUrl,
      files:            f.files,
      pageCount:        f.page_count || f.pageCount || 1,
      copies:           f.copies || 1,
      colorMode:        f.color_mode || f.colorMode || 'bw',
      paperSize:        f.paper_size || f.paperSize || 'A4',
      duplex:           f.duplex || 'single',
      printFee:         parseFloat(f.print_fee || f.printFee || 0),
      serviceFee:       parseFloat(f.service_fee || f.serviceFee || 0),
      totalFee:         parseFloat(f.total_fee || f.totalFee || 0),
      pointsUsed:       f.points_used || f.pointsUsed || 0,
      pointsDiscount:   parseFloat(f.points_discount || f.pointsDiscount || 0),
      actualPay:        parseFloat(f.actual_pay || f.actualPay || 0),
      status:           f.status || '',
      orderType:        f.order_type || f.orderType || '',
      printTag:         f.print_tag || f.printTag || '',
      extraInfo:        f.extra_info || f.extraInfo || '',
      printerId:        f.printer_id || f.printerId || null,
      createdAt:        f.created_at || f.createTime || f.createdAt,
      createTime:       f.created_at || f.createTime || f.createdAt,
      payTime:          f.pay_time || f.payTime || null,
      printStartTime:   f.print_start_time || f.printStartTime || null,
      printEndTime:     f.print_end_time || f.printEndTime || null,
      orderSeq:         f.order_seq || null,
      printSeq:         f.print_seq || (f.order_seq ? String(f.order_seq).padStart(4, '0') : null),
      docSeqDate:       f.doc_seq_date || null,
      isDocOrder:       !!(f.order_seq && f.doc_seq_date) || !!(f.print_seq),
    }
  },

  loadOrderDetail: function () {
    const self = this
    api.getOrder(this.data.orderNo).then(function (res) {
      if (res.code === 200) {
        const order = self.normalizeFields(res.data)
        const showBanner = order.status === 'completed' && order.isDocOrder && order.printSeq
        self.setData({
          orderInfo: order,
          showPickupBanner: showBanner
        })
        if (order.status === 'printing' && !self.data.pollingTimer) {
          self.startPolling()
        }
      } else {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
      }
    })
  },

  startPolling: function () {
    const self = this
    const timer = setInterval(function () {
      api.getOrder(self.data.orderNo).then(function (res) {
        if (res.code === 200) {
          const order = self.normalizeFields(res.data)
          self.setData({
            orderInfo: order,
            showPickupBanner: order.status === 'completed' && order.isDocOrder && order.printSeq
          })
          if (order.status === 'completed') {
            clearInterval(timer)
            self.setData({ pollingTimer: null })
          }
        }
      })
    }, 5000)
    this.setData({ pollingTimer: timer })
  },

  payOrder: function () {
    wx.navigateTo({ url: `/pages/payment/payment?orderNo=${this.data.orderNo}` })
  },

  cancelOrder: function () {
    const self = this
    wx.showModal({
      title: '确认取消',
      content: '确定要取消这个订单吗？',
      success: function (res) {
        if (res.confirm) {
          api.cancelOrder(self.data.orderNo).then(function (res) {
            if (res.code === 200) {
              wx.showToast({ title: '取消成功', icon: 'success' })
              self.loadOrderDetail()
            } else {
              wx.showToast({ title: res.msg || '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  formatTime: function (dateStr) {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  },

  goBack: function () { wx.navigateBack() }
})
