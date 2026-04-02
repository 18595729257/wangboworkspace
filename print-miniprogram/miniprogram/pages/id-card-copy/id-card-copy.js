// pages/id-card-copy/id-card-copy.js
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    // 证件类型
    cardTypes: [
      { id: 'idcard', name: '身份证', price_bw: 0.5, price_color: 1.0 },
      { id: 'bankcard', name: '银行卡', price_bw: 0.5, price_color: 1.0 },
      { id: 'student', name: '学生证', price_bw: 0.5, price_color: 1.0 },
      { id: 'hukou', name: '户口本', price_bw: 0.5, price_color: 1.0 },
      { id: 'driver', name: '驾驶证', price_bw: 0.5, price_color: 1.0 },
      { id: 'passport', name: '护照', price_bw: 0.5, price_color: 1.0 },
    ],
    selectedType: 'idcard',
    colorMode: 'bw',      // bw / color
    layout: 'double',     // double / single
    copies: 1,
    frontImage: '',
    backImage: '',
    totalPrice: '0.50',
    loading: false
  },

  onLoad: function () { this.loadConfig() },

  // 从服务器加载证件复印价格
  loadConfig: function () {
    var self = this
    api.getConfig().then(function (res) {
      if (res.code === 200) {
        var c = res.data
        var bw = parseFloat(c.idcard_bw_price) || 0.5
        var color = parseFloat(c.idcard_color_price) || 1.0
        var types = self.data.cardTypes.map(function (t) {
          t.price_bw = bw
          t.price_color = color
          return t
        })
        self.setData({ cardTypes: types })
        self.calculatePrice()
      }
    }).catch(function () {})
  },

  // 选择证件类型
  selectType: function (e) {
    this.setData({ selectedType: e.currentTarget.dataset.type })
    this.calculatePrice()
  },

  // 选择颜色
  setColorMode: function (e) {
    this.setData({ colorMode: e.currentTarget.dataset.mode })
    this.calculatePrice()
  },

  // 选择排列
  setLayout: function (e) {
    this.setData({ layout: e.currentTarget.dataset.layout })
  },

  // 上传正面
  chooseFront: function () {
    const self = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        self.setData({ frontImage: res.tempFilePaths[0] })
        self.calculatePrice()
      }
    })
  },

  // 上传反面
  chooseBack: function () {
    const self = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        self.setData({ backImage: res.tempFilePaths[0] })
      }
    })
  },

  // 删除图片
  removeFront: function () { this.setData({ frontImage: '', backImage: '' }); this.calculatePrice() },
  removeBack: function () { this.setData({ backImage: '' }) },

  // 设置份数
  setCopies: function (e) {
    this.setData({ copies: Math.max(1, parseInt(e.detail.value) || 1) })
    this.calculatePrice()
  },

  // 计算价格
  calculatePrice: function () {
    const { cardTypes, selectedType, colorMode, copies } = this.data
    const card = cardTypes.find(function (c) { return c.id === selectedType })
    if (!card) return
    const price = colorMode === 'color' ? card.price_color : card.price_bw
    const total = (price * copies).toFixed(2)
    this.setData({ totalPrice: total })
  },

  // 提交订单
  submitOrder: function () {
    const self = this
    if (!this.data.frontImage) {
      wx.showToast({ title: '请上传证件正面', icon: 'none' })
      return
    }

    var openid = app.globalData.openid || ('anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6))

    this.setData({ loading: true })
    var selectedType = this.data.selectedType
    var card = null
    for (var i = 0; i < this.data.cardTypes.length; i++) {
      if (this.data.cardTypes[i].id === selectedType) {
        card = this.data.cardTypes[i]
        break
      }
    }

    api.createOrder({
      openid: openid,
      fileName: '证件复印-' + card.name,
      pageCount: 1,
      copies: this.data.copies,
      colorMode: this.data.colorMode,
      paperSize: 'A4',
      pointsUsed: 0,
      orderType: 'idcard_copy',
      extraInfo: JSON.stringify({
        cardType: this.data.selectedType,
        layout: this.data.layout
      })
    }).then(function (res) {
      if (res.code === 200) {
        api.payCallback(res.data.orderNo).then(function () {
          wx.showToast({ title: '下单成功', icon: 'success' })
          setTimeout(function () {
            wx.redirectTo({ url: '/pages/order-detail/order-detail?orderNo=' + res.data.orderNo })
          }, 1500)
        })
      } else {
        wx.showToast({ title: res.msg || '下单失败', icon: 'none' })
      }
    }).catch(function () {
      wx.showToast({ title: '下单失败', icon: 'none' })
    }).finally(function () {
      self.setData({ loading: false })
    })
  }
})
