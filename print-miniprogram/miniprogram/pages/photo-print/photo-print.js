// pages/photo-print/photo-print.js
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    // 照片类别
    categories: [
      { id: 'idphoto_direct', name: '证件照直接打印', desc: '有电子版直接打印', price_1: 0.5, price_2: 0.8 },
      { id: 'idphoto_bg', name: '换底色/拍照打印', desc: '上传照片换背景色', price_1: 1.0, price_2: 1.5 },
      { id: 'idphoto_suit', name: '换正装证件照', desc: 'AI智能换正装', price_1: 3.0, price_2: 5.0 },
      { id: 'life_5', name: '5寸生活照', desc: '127×89mm', price_1: 0.5, price_2: 0.5 },
      { id: 'life_6', name: '6寸生活照', desc: '152×102mm', price_1: 0.8, price_2: 0.8 },
    ],
    selectedCategory: 'idphoto_direct',
    photoSize: '1',   // 1寸 / 2寸
    copies: 1,
    bgColor: '',       // 底色: white/blue/red
    image: '',
    totalPrice: '0.50',
    loading: false,
    isLife: false
  },

  onLoad: function () { this.loadConfig() },

  // 从服务器加载照片打印价格
  loadConfig: function () {
    var self = this
    api.getConfig().then(function (res) {
      if (res.code === 200) {
        var c = res.data
        var cats = [
          { id: 'idphoto_direct', name: '证件照直接打印', desc: '有电子版直接打印',
            price_1: parseFloat(c.photo_direct_1_price) || 0.5,
            price_2: parseFloat(c.photo_direct_2_price) || 0.8 },
          { id: 'idphoto_bg', name: '换底色/拍照打印', desc: '上传照片换背景色',
            price_1: parseFloat(c.photo_bg_1_price) || 1.0,
            price_2: parseFloat(c.photo_bg_2_price) || 1.5 },
          { id: 'idphoto_suit', name: '换正装证件照', desc: 'AI智能换正装',
            price_1: parseFloat(c.photo_suit_1_price) || 3.0,
            price_2: parseFloat(c.photo_suit_2_price) || 5.0 },
          { id: 'life_5', name: '5寸生活照', desc: '127×89mm',
            price_1: parseFloat(c.photo_life_5_price) || 0.5,
            price_2: parseFloat(c.photo_life_5_price) || 0.5 },
          { id: 'life_6', name: '6寸生活照', desc: '152×102mm',
            price_1: parseFloat(c.photo_life_6_price) || 0.8,
            price_2: parseFloat(c.photo_life_6_price) || 0.8 },
        ]
        self.setData({ categories: cats })
        self.calculatePrice()
      }
    }).catch(function () {})
  },

  selectCategory: function (e) {
    var id = e.currentTarget.dataset.id
    this.setData({ selectedCategory: id, isLife: id.indexOf('life') === 0 })
    this.calculatePrice()
  },

  setSize: function (e) {
    this.setData({ photoSize: e.currentTarget.dataset.size })
    this.calculatePrice()
  },

  setBgColor: function (e) {
    this.setData({ bgColor: e.currentTarget.dataset.color })
  },

  chooseImage: function () {
    const self = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        self.setData({ image: res.tempFilePaths[0] })
        self.calculatePrice()
      }
    })
  },

  removeImage: function () { this.setData({ image: '' }); this.calculatePrice() },

  setCopies: function (e) {
    const val = parseInt(e.currentTarget.dataset.val) || 1
    this.setData({ copies: Math.max(1, val) })
    this.calculatePrice()
  },

  calculatePrice: function () {
    var self = this
    var cat = null
    for (var i = 0; i < this.data.categories.length; i++) {
      if (this.data.categories[i].id === this.data.selectedCategory) {
        cat = this.data.categories[i]
        break
      }
    }
    if (!cat) return
    var isLife = cat.id.indexOf('life') === 0
    var unitPrice = isLife ? cat.price_1 : (this.data.photoSize === '1' ? cat.price_1 : cat.price_2)
    var total = (unitPrice * this.data.copies).toFixed(2)
    this.setData({ totalPrice: total })
  },

  submitOrder: function () {
    const self = this
    if (!this.data.image) {
      wx.showToast({ title: '请上传照片', icon: 'none' })
      return
    }
    var identity = app.getOrderIdentity()
    var openid = identity.openid
    var deviceId = identity.deviceId

    this.setData({ loading: true })
    var cat = null
    for (var i = 0; i < this.data.categories.length; i++) {
      if (this.data.categories[i].id === this.data.selectedCategory) {
        cat = this.data.categories[i]
        break
      }
    }

    api.createOrder({
      openid: openid || null,
      deviceId: deviceId || null,
      fileName: '照片打印-' + cat.name,
      pageCount: 1,
      copies: this.data.copies,
      colorMode: 'color',
      paperSize: 'photo',
      pointsUsed: 0,
      orderType: 'photo_print',
      extraInfo: JSON.stringify({
        category: this.data.selectedCategory,
        photoSize: this.data.photoSize,
        bgColor: this.data.bgColor
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
