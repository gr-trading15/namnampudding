(function () {
  'use strict';

  var NN_CART_BUILD = '2026-07-18-schema-tier-config';
  console.log('[NamNamCart] script loaded', NN_CART_BUILD);

  var ROUTES = {
    cart: '/cart.js',
    add: '/cart/add.js',
    change: '/cart/change.js',
    update: '/cart/update.js'
  };
  var TIMER_KEY = 'nn_cart_timer_v3';
  var SESSION_KEY = 'nn_cart_opened_once';
  var QTY_SYNC_MS = 250;
  var NOTE_DEBOUNCE_MS = 500;
  var NEAR_MISS_LOUD = 150;
  var NEAR_TIER_PULSE = 150;
  var CART_STALE_MS = 2500;
  var UNDO_TOAST_MS = 4500;
  var FILL_ANIM_MS = 560;
  var COUNTER_ANIM_MS = 540;

  var _cartPrefetch = null;
  function prefetchCart() {
    _cartPrefetch = fetch(ROUTES.cart, {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
    return _cartPrefetch;
  }
  prefetchCart();

  function debounce(fn, wait) {
    var t;
    var lastCtx;
    var lastArgs;
    function debounced() {
      lastCtx = this;
      lastArgs = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(lastCtx, lastArgs);
      }, wait);
    }
    debounced.cancel = function () {
      clearTimeout(t);
      t = null;
    };
    return debounced;
  }

  function fetchJSON(url, options) {
    options = options || {};
    options.headers = Object.assign({
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }, options.headers || {});
    if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    return fetch(url, options).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error(data.description || data.message || 'Cart error');
          err.data = data;
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function addCartItem(item) {
    var payload = {
      id: item.id,
      quantity: item.quantity || 1
    };
    if (item.properties) payload.properties = item.properties;
    return fetchJSON(ROUTES.add, {
      method: 'POST',
      body: payload
    }).catch(function () {
      return fetchJSON(ROUTES.add, {
        method: 'POST',
        body: { items: [payload] }
      });
    });
  }

  function formatINR(paise) {
    var rupees = Math.round(paise) / 100;
    return '₹' + rupees.toLocaleString('en-IN', {
      maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
      minimumFractionDigits: 0
    });
  }

  function formatRupeesInt(rupees) {
    return '₹' + Math.max(0, Math.round(rupees)).toLocaleString('en-IN');
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function imgUrl(url, w) {
    if (!url) return '';
    var clean = url.replace(/([?&])width=\d+&?/g, '$1').replace(/[?&]$/, '');
    return clean + (clean.indexOf('?') === -1 ? '?' : '&') + 'width=' + w;
  }

  function toInt(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function haptic(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms || 30); } catch (e) {} }
  }

  function bounceCartIcon() {
    var bubbles = document.querySelectorAll('.cart-count-bubble, [data-cart-count-external]');
    bubbles.forEach(function (b) {
      var bubble = b.closest('a, button') || b;
      bubble.classList.remove('nn-cart-bounce');
      void bubble.offsetWidth;
      bubble.classList.add('nn-cart-bounce');
      setTimeout(function () { bubble.classList.remove('nn-cart-bounce'); }, 700);
    });
  }

  function showToast(text) {
    var toast = document.querySelector('[data-nn-toast]');
    if (!toast) return;
    var textEl = toast.querySelector('[data-nn-toast-text]');
    if (textEl) textEl.textContent = text || 'Added to Cart';
    toast.setAttribute('aria-hidden', 'false');
    if (toast._nnHideTimer) clearTimeout(toast._nnHideTimer);
    toast._nnHideTimer = setTimeout(function () {
      toast.setAttribute('aria-hidden', 'true');
    }, 2800);
    var viewBtn = toast.querySelector('[data-nn-toast-view]');
    if (viewBtn && !viewBtn._nnBound) {
      viewBtn._nnBound = true;
      viewBtn.addEventListener('click', function () {
        var d = document.getElementById('NamNamCart');
        if (d && typeof d.open === 'function') d.open();
        toast.setAttribute('aria-hidden', 'true');
      });
    }
  }

  var _atcLock = false;

  function handleATC(opts) {
    if (_atcLock) return Promise.reject(new Error('Locked'));
    _atcLock = true;
    var btn = opts.button;
    var originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.dataset.nnOriginalHtml = originalHTML;
      btn.innerHTML = '<span>Adding…</span>';
    }
    var fetchOpts = {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    };
    if (opts.formData) {
      fetchOpts.body = opts.formData;
    } else {
      fetchOpts.headers['Content-Type'] = 'application/json';
      var item = { id: opts.variantId, quantity: opts.quantity || 1 };
      if (opts.properties) item.properties = opts.properties;
      fetchOpts.body = JSON.stringify({ items: [item] });
    }
    return fetch(ROUTES.add, fetchOpts)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.description || res.data.message || 'Could not add');
        var addedVariantId = res.data.variant_id || (res.data.items && res.data.items[0] && res.data.items[0].variant_id) || opts.variantId;
        haptic(25);
        showToast('✓ Added to Cart');
        bounceCartIcon();
        prefetchCart();
        var d = document.getElementById('NamNamCart') || document.querySelector('cart-drawer');
        if (d && typeof d.refresh === 'function') {
          d._pendingHighlight = addedVariantId;
          d.refresh();
        }
        if (btn) {
          btn.innerHTML = '<span>✓ Added</span>';
          setTimeout(function () {
            btn.innerHTML = btn.dataset.nnOriginalHtml || originalHTML;
            btn.disabled = false;
          }, 1500);
        }
      })
      .catch(function (err) {
        console.warn('[NamNamCart] ATC error', err);
        if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
      })
      .finally(function () {
        setTimeout(function () { _atcLock = false; }, 300);
      });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || '';
    if (action.indexOf('/cart/add') === -1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    var btn = form.querySelector('[type="submit"], button[name="add"]');
    handleATC({ formData: new FormData(form), button: btn });
  }, true);

  document.addEventListener('click', function (e) {
    if (e.target.closest('.nn')) return;
    var btn = e.target.closest(
      'button[name="add"], ' +
      '[data-quick-add], ' +
      '[data-quick-add-submit], ' +
      'button[data-variant-id], ' +
      'a[data-variant-id], ' +
      '.quick-add__submit, ' +
      'product-form button[type="submit"], ' +
      'quick-add button[type="submit"]'
    );
    if (!btn) return;
    var parentForm = btn.closest('form[action*="/cart/add"]');
    if (parentForm) return;
    var variantId = btn.getAttribute('data-variant-id') ||
                    btn.getAttribute('data-product-id') ||
                    btn.getAttribute('data-id');
    if (!variantId) {
      var holder = btn.closest('[data-variant-id], [data-product-id]');
      if (holder) {
        variantId = holder.getAttribute('data-variant-id') ||
                    holder.getAttribute('data-product-id');
      }
    }
    var id = toInt(variantId);
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    handleATC({ variantId: id, quantity: 1, button: btn });
  }, true);

  class CartDrawer extends HTMLElement {
    static get observedAttributes() {
      return [
        'data-tier-1', 'data-tier-2', 'data-tier-3',
        'data-tier-1-label', 'data-tier-2-label', 'data-tier-3-label',
        'data-tier-1-type', 'data-tier-2-type', 'data-tier-3-type',
        'data-tier-1-code', 'data-tier-2-code', 'data-tier-3-code',
        'data-tier-1-gift-handle', 'data-tier-2-gift-handle', 'data-tier-3-gift-handle',
        'data-tier-1-gift-variant-id', 'data-tier-2-gift-variant-id', 'data-tier-3-gift-variant-id'
      ];
    }

    constructor() {
      super();
      this._initialized = false;
      this._connectBound = false;
      this._initRaf = null;
      this._cart = null;
      this._optimistic = {};
      this._lastHydrate = 0;
      this._open = false;
      this._sheetOpen = false;
      this._lastUnlocked = [false, false, false];
      this._qtyTimers = {};
      this._timerRaf = null;
      this._timerLastSec = -1;
      this._queue = Promise.resolve();
      this._giftBusyCount = 0;
      this._pendingHighlight = null;
      this._pendingRemove = null;
      this._undoTimer = null;
      this._tierJustUnlocked = -1;
      this._lastDiscountSyncSignature = null;

      // Animation state
      this._fillAnimRaf = null;
      this._currentFillPercent = null;
      this._counterRaf = null;
      this._counterValue = null;
      this._upsellRaf = null;
      this._nearTier = false;
      this._settingsReloadTimer = null;

      this._onKeydown = this._onKeydown.bind(this);
      this._onClick = this._onClick.bind(this);
      this._onNoteInput = this._onNoteInput.bind(this);
      this._saveNoteDebounced = debounce(this._saveNoteToServer.bind(this), NOTE_DEBOUNCE_MS);
      this._onUpsellScroll = this._onUpsellScroll.bind(this);
      this._onWrapToggle = this._onWrapToggle.bind(this);
      this._onWrapLabelClick = this._onWrapLabelClick.bind(this);
    }

    connectedCallback() {
      if (this._initialized) {
        this._bindConnectedListeners();
        return;
      }
      this._scheduleInit();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (!this._initialized || oldValue === newValue) return;
      clearTimeout(this._settingsReloadTimer);
      var self = this;
      this._settingsReloadTimer = setTimeout(function () {
        self._settingsReloadTimer = null;
        self._reloadTierSettings();
      }, 0);
    }

    _scheduleInit() {
      var self = this;
      if (this._initRaf) cancelAnimationFrame(this._initRaf);
      var attempt = function () {
        if (!self.isConnected || self._initialized) return;
        if (!self.querySelector('.nn__panel') || !self.querySelector('[data-cart-items]') || !self.querySelector('[data-note-sheet]')) {
          self._initRaf = requestAnimationFrame(attempt);
          return;
        }
        self._initRaf = null;
        self._initialize();
      };
      this._initRaf = requestAnimationFrame(attempt);
    }

    _readTierSettings() {
      var config = null;
      var configEl = this.querySelector('[data-nn-tier-config]');
      if (configEl) {
        try { config = JSON.parse(configEl.textContent || '{}'); }
        catch (err) { console.warn('[NamNamCart] invalid tier config', err); }
      }

      var configuredTiers = config && Array.isArray(config.tiers) ? config.tiers : null;
      if (configuredTiers && configuredTiers.length === 3) {
        this.tiers = configuredTiers.map(function (tier) { return toInt(tier.threshold); });
        this.tierLabels = configuredTiers.map(function (tier) { return String(tier.label || ''); });
        this.tierTypes = configuredTiers.map(function (tier) { return tier.type === 'free_product' ? 'free_product' : 'discount'; });
        this.tierCodes = configuredTiers.map(function (tier) { return String(tier.code || '').trim(); });
        this.tierGiftHandles = configuredTiers.map(function (tier) { return String(tier.giftHandle || '').trim(); });
        this.tierGiftVariantIds = configuredTiers.map(function (tier) { return toInt(tier.giftVariantId); });
      } else {
        // Compatibility fallback reads the section-rendered attributes only.
        // No fixed tier prices are kept in JavaScript.
        this.tiers = [toInt(this.dataset.tier1), toInt(this.dataset.tier2), toInt(this.dataset.tier3)];
        this.tierLabels = [this.dataset.tier1Label || '', this.dataset.tier2Label || '', this.dataset.tier3Label || ''];
        this.tierTypes = [this.dataset.tier1Type, this.dataset.tier2Type, this.dataset.tier3Type].map(function (type) {
          return type === 'free_product' ? 'free_product' : 'discount';
        });
        this.tierCodes = [this.dataset.tier1Code, this.dataset.tier2Code, this.dataset.tier3Code].map(function (code) {
          return String(code || '').trim();
        });
        this.tierGiftHandles = [this.dataset.tier1GiftHandle, this.dataset.tier2GiftHandle, this.dataset.tier3GiftHandle].map(function (handle) {
          return String(handle || '').trim();
        });
        this.tierGiftVariantIds = [
          toInt(this.dataset.tier1GiftVariantId),
          toInt(this.dataset.tier2GiftVariantId),
          toInt(this.dataset.tier3GiftVariantId)
        ];
      }

      for (var i = 0; i < this.tiers.length; i++) {
        if (this.tiers[i] == null || this.tiers[i] < 0) this.tiers[i] = 0;
      }
    }

    _reloadTierSettings() {
      if (!this._initialized || !this.isConnected) return;
      this._readTierSettings();
      this._giftVariantsPromise = null;
      this._lastDiscountSyncSignature = null;
      this._lastUnlocked = this.tiers.map(function () { return false; });
      this._tierJustUnlocked = -1;
      this._setTierLabels();
      this._setTierPositions();
      this._render();
      var self = this;
      this._enqueue(function () { return self._syncDerivedCartState(); });
    }

    _initialize() {
      this._readTierSettings();
      this.wrapProductHandle = (this.dataset.wrapProductHandle || '').trim();
      this.wrapVariantId = toInt(this.dataset.wrapVariantId);
      this.wrapPrice = (this.dataset.wrapPrice || '').trim();
      this.timerMinutes = toInt(this.dataset.timerMinutes) || 4;
      this.freeShipThreshold = toInt(this.dataset.freeShipThreshold) || 499;

      this._cacheElements();
      this._setTierLabels();
      this._setTierPositions();
      this._ensureCounter();
      this._prepareFill();
      this._reflectWrapPrice();
      this._ensureWrapPrice();

      this._bindConnectedListeners();

      if (this._els.wrapToggle && !this._els.wrapToggle._nnBoundWrapChange) {
        this._els.wrapToggle._nnBoundWrapChange = true;
        this._els.wrapToggle.addEventListener('change', this._onWrapToggle);
      }
      if (this._els.specialWrap && !this._els.specialWrap._nnBoundWrapClick) {
        this._els.specialWrap._nnBoundWrapClick = true;
        this._els.specialWrap.addEventListener('click', this._onWrapLabelClick);
      }
      if (this._els.noteInput) {
        if (!this._els.noteInput._nnBoundNoteInput) {
          this._els.noteInput._nnBoundNoteInput = true;
          this._els.noteInput.addEventListener('input', this._onNoteInput);
          this._els.noteInput.addEventListener('keyup', this._onNoteInput);
          this._els.noteInput.addEventListener('change', this._onNoteInput);
        }
      }

      var self = this;
      var sheet = this._els.sheet;
      if (sheet && !sheet._nnBoundSheetClick) {
        sheet._nnBoundSheetClick = true;
        sheet.addEventListener('click', function (e) {
          if (e.target.closest('[data-note-close]') || e.target.classList.contains('nn__sheet-backdrop')) {
            self._closeSheet();
          } else if (e.target.closest('[data-note-save]')) {
            self._saveNoteAndClose();
          } else if (e.target.closest('[data-note-clear]')) {
            self._clearNote();
          }
        });
      }

      if (this._els.upsellTrack && !this._els.upsellTrack._nnBoundUpsellScroll) {
        this._els.upsellTrack._nnBoundUpsellScroll = true;
        this._els.upsellTrack.addEventListener('scroll', this._onUpsellScroll, { passive: true });
      }

      var emptyAdds = this.querySelectorAll('[data-empty-add]');
      emptyAdds.forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.preventDefault();
          var id = toInt(b.getAttribute('data-variant-id'));
          if (!id) return;
          handleATC({ variantId: id, quantity: 1, button: b });
        });
      });

      if (this._els.nudgeCta) {
        this._els.nudgeCta.addEventListener('click', function () {
          if (self._els.upsell && !self._els.upsell.hidden) {
            self._els.upsell.scrollIntoView({ behavior: 'smooth', block: 'center' });
            self._els.upsell.classList.add('nn__upsell--pulse');
            setTimeout(function () { self._els.upsell.classList.remove('nn__upsell--pulse'); }, 1200);
          }
        });
      }

      if (this._els.undoBtn && !this._els.undoBtn._nnBound) {
        this._els.undoBtn._nnBound = true;
        this._els.undoBtn.addEventListener('click', function () { self._performUndo(); });
      }

      this._initialized = true;
      this.setAttribute('aria-hidden', 'true');
      this._hydrateFromPrefetch();
    }

    _bindConnectedListeners() {
      if (this._connectBound) return;
      this._connectBound = true;
      this.addEventListener('click', this._onClick);
      document.addEventListener('keydown', this._onKeydown);
    }

    _hydrateFromPrefetch() {
      var self = this;
      var p = _cartPrefetch || prefetchCart();
      p.then(function (cart) {
        if (!cart) return self.refresh();
        self._applyServerCart(cart);
        return self._enqueue(function () { return self._syncDerivedCartState(); });
      }).catch(function (err) {
        console.warn('[NamNamCart] hydrate failed:', err);
        self.refresh();
      });
    }

    disconnectedCallback() {
      if (this._settingsReloadTimer) {
        clearTimeout(this._settingsReloadTimer);
        this._settingsReloadTimer = null;
      }
      if (this._initRaf) {
        cancelAnimationFrame(this._initRaf);
        this._initRaf = null;
      }
      if (this._fillAnimRaf) {
        cancelAnimationFrame(this._fillAnimRaf);
        this._fillAnimRaf = null;
      }
      if (this._counterRaf) {
        cancelAnimationFrame(this._counterRaf);
        this._counterRaf = null;
      }
      if (this._upsellRaf) {
        cancelAnimationFrame(this._upsellRaf);
        this._upsellRaf = null;
      }
      if (this._connectBound) {
        this.removeEventListener('click', this._onClick);
        document.removeEventListener('keydown', this._onKeydown);
        this._connectBound = false;
      }
      if (this._open) {
        this._open = false;
        document.body.classList.remove('nn-cart-open');
      }
      this._stopTimer();
    }

    _cacheElements() {
      var self = this;
      function q(sel) { return self.querySelector(sel) || document.querySelector(sel); }
      function qa(sel) {
        var r = self.querySelectorAll(sel);
        return r.length ? r : document.querySelectorAll(sel);
      }
      this._els = {
        backdrop: q('.nn__backdrop'),
        panel: q('.nn__panel'),
        body: q('[data-cart-body]'),
        items: q('[data-cart-items]'),
        empty: q('[data-cart-empty]'),
        gifts: q('[data-cart-gifts]'),
        specialWrap: q('[data-special-wrap]'),
        wrapToggle: q('[data-wrap-toggle]'),
        wrapPriceText: q('[data-wrap-price-text]'),
        openNoteBtn: q('[data-open-note-sheet]'),
        noteStatus: q('[data-note-status]'),
        noteInput: q('[data-gift-note]'),
        noteCount: q('[data-gift-count]'),
        sheet: q('[data-note-sheet]'),
        footer: q('[data-cart-footer]'),
        upsell: q('[data-cart-upsell]'),
        upsellTrack: q('[data-upsell-track]'),
        upsellPrev: q('[data-upsell-prev]'),
        upsellNext: q('[data-upsell-next]'),
        progress: q('[data-cart-progress]'),
        progressFill: q('[data-progress-fill]'),
        progressTrack: q('[data-progress-track]'),
        progressMarkers: qa('.nn__progress-marker'),
        progressMsgText: q('[data-progress-message] .nn__progress-msg-text'),
        progressMsgIco: q('[data-progress-message] .nn__progress-msg-ico'),
        progressMessage: q('[data-progress-message]'),
        progressTiers: qa('[data-progress-tier]'),
        timer: q('[data-cart-timer]'),
        timerText: q('[data-cart-timer-text]'),
        count: q('[data-cart-count]'),
        subtotal: q('[data-cart-subtotal]'),
        originalTotal: q('[data-cart-original]'),
        percent: q('[data-cart-percent]'),
        checkoutAmount: q('[data-checkout-amount]'),
        savings: q('[data-cart-savings]'),
        savingsText: q('[data-savings-text]'),
        savingsAmount: q('[data-savings-amount]'),
        confetti: q('[data-confetti]'),
        nudge: q('[data-cart-nudge]'),
        nudgeText: q('[data-nudge-text]'),
        nudgeCta: q('[data-nudge-cta]'),
        perkShipping: q('[data-perk-shipping]'),
        perkShippingText: q('[data-perk-shipping-text]'),
        perkDot: q('[data-perk-dot]'),
        undoToast: document.querySelector('[data-nn-undo]'),
        undoText: document.querySelector('[data-nn-undo-text]'),
        undoBtn: document.querySelector('[data-nn-undo-action]'),
        counter: null,
        counterCurrent: null,
        counterMax: null
      };
      if (this._els.openNoteBtn && !this._els.openNoteBtn._nnBound) {
        var self2 = this;
        this._els.openNoteBtn._nnBound = true;
        this._els.openNoteBtn.addEventListener('click', function (e) {
          e.preventDefault();
          self2._openSheet();
        });
      }
    }

    _setTierLabels() {
      var amtEls = this.querySelectorAll('[data-progress-tier] [data-tier-amount]');
      var lblEls = this.querySelectorAll('[data-progress-tier] [data-tier-label]');
      if (!amtEls.length) {
        amtEls = document.querySelectorAll('[data-progress-tier] [data-tier-amount]');
        lblEls = document.querySelectorAll('[data-progress-tier] [data-tier-label]');
      }
      for (var i = 0; i < amtEls.length; i++) {
        amtEls[i].textContent = '₹' + this.tiers[i].toLocaleString('en-IN');
        if (lblEls[i]) lblEls[i].textContent = this.tierLabels[i];
      }
    }

    // === EQUIDISTANT TIER POSITIONS ===
    // Each tier sits at proportional intervals across the bar (33.3% / 66.6% / 100%
    // for 3 tiers). Looks balanced regardless of how close the actual rupee values
    // are. Markers AND the tier icon groups are positioned here so they always
    // match no matter what the Liquid template did.
    _setTierPositions() {
      var track = this._els && this._els.progressTrack;
      if (!track || !this.tiers.length) return;
      var tierEls = this._els && this._els.progressTiers ? this._els.progressTiers : [];
      var markers = track.querySelectorAll('.nn__progress-marker');
      if (this._els) this._els.progressMarkers = markers;

      for (var i = 0; i < this.tiers.length; i++) {
        var pos = this._getTierPositionPercent(i);
        var shift = pos <= 0 ? '0%' : (pos >= 100 ? '-100%' : '-50%');
        if (markers[i]) {
          markers[i].style.left = pos + '%';
          markers[i].style.setProperty('--nn-marker-shift', shift);
        }
        if (tierEls[i]) {
          tierEls[i].style.left = pos + '%';
          tierEls[i].style.setProperty('--nn-tier-shift', shift);
        }
      }
    }

    // Equidistant: tier i sits at ((i+1) / n) * 100%
    _getTierPositionPercent(index) {
      if (!this.tiers.length || !this.tiers[index]) return 0;
      return ((index + 1) / this.tiers.length) * 100;
    }

    // === SEGMENT-BASED FILL PERCENT ===
    // The bar is divided into N equal visual segments (one per tier). Within each
    // segment, the fill grows linearly with rupees toward the NEXT tier. So the
    // fill always lands exactly on a tier marker when that reward unlocks, and
    // every rupee added "feels like" the same amount of progress.
    _getProgressPercent(amountRupees) {
      if (!this.tiers.length) return 0;
      var n = this.tiers.length;
      var segmentSize = 100 / n;
      if (amountRupees >= this.tiers[n - 1]) return 100;
      if (amountRupees <= 0) return 0;
      if (amountRupees < this.tiers[0]) {
        return (amountRupees / this.tiers[0]) * segmentSize;
      }
      for (var i = 0; i < n - 1; i++) {
        if (amountRupees >= this.tiers[i] && amountRupees < this.tiers[i + 1]) {
          var segmentStart = (i + 1) * segmentSize;
          var rupeesInSegment = this.tiers[i + 1] - this.tiers[i];
          var progressInSegment = (amountRupees - this.tiers[i]) / rupeesInSegment;
          return segmentStart + (progressInSegment * segmentSize);
        }
      }
      return 100;
    }

    // === FILL ANIMATION (GPU-accelerated scaleX via rAF) ===
    _prepareFill() {
      var fill = this._els && this._els.progressFill;
      if (!fill) return;
      // Override any !important transition coming from the legacy stylesheet
      fill.style.setProperty('transition', 'none', 'important');
      fill.style.setProperty('transform-origin', 'left center', 'important');
      // Start collapsed; first render will set to actual value instantly
      fill.style.setProperty('transform', 'scaleX(0)', 'important');
      // Remove any width override so transform is the only driver
      fill.style.removeProperty('width');
    }

    _animateFill(targetPercent) {
      var fill = this._els && this._els.progressFill;
      if (!fill) return;
      if (this._fillAnimRaf) cancelAnimationFrame(this._fillAnimRaf);

      var to = Math.max(0, Math.min(100, targetPercent));

      // First-ever render: snap to position without animation
      if (this._currentFillPercent == null) {
        var snapScale = (to / 100).toFixed(5);
        fill.style.setProperty('transform', 'scaleX(' + snapScale + ')', 'important');
        this._currentFillPercent = to;
        return;
      }

      var from = this._currentFillPercent;
      var delta = to - from;
      if (Math.abs(delta) < 0.05) {
        fill.style.setProperty('transform', 'scaleX(' + (to / 100).toFixed(5) + ')', 'important');
        this._currentFillPercent = to;
        return;
      }

      var start = performance.now();
      var self = this;
      var tick = function (now) {
        var elapsed = now - start;
        var progress = Math.min(1, elapsed / FILL_ANIM_MS);
        var eased = easeOutCubic(progress);
        var current = from + (delta * eased);
        fill.style.setProperty('transform', 'scaleX(' + (current / 100).toFixed(5) + ')', 'important');
        self._currentFillPercent = current;
        if (progress < 1) {
          self._fillAnimRaf = requestAnimationFrame(tick);
        } else {
          fill.style.setProperty('transform', 'scaleX(' + (to / 100).toFixed(5) + ')', 'important');
          self._currentFillPercent = to;
          self._fillAnimRaf = null;
        }
      };
      this._fillAnimRaf = requestAnimationFrame(tick);
    }

    // === LIVE RUPEE COUNTER ===
    _ensureCounter() {
      if (this._els.counter) return;
      var parent = this._els.progressMessage;
      if (!parent) return;
      var maxRupees = this.tiers[this.tiers.length - 1];
      var counter = document.createElement('span');
      counter.className = 'nn__progress-counter';
      counter.setAttribute('data-progress-counter', '');
      counter.innerHTML =
        '<span class="nn__progress-counter-current" data-counter-current>₹0</span>' +
        '<span class="nn__progress-counter-sep">/</span>' +
        '<span class="nn__progress-counter-max" data-counter-max>₹' +
          maxRupees.toLocaleString('en-IN') +
        '</span>';
      parent.appendChild(counter);
      this._els.counter = counter;
      this._els.counterCurrent = counter.querySelector('[data-counter-current]');
      this._els.counterMax = counter.querySelector('[data-counter-max]');
    }

    _animateCounter(amountRupees) {
      this._ensureCounter();
      if (!this._els.counterCurrent || !this._els.counter) return;

      var maxRupees = this.tiers[this.tiers.length - 1];
      var to = Math.max(0, Math.round(amountRupees));
      var unlocked = to >= maxRupees;

      // Reflect "all unlocked" state visually
      this._els.counter.classList.toggle('nn__progress-counter--unlocked', unlocked);

      // First render — snap, no ticker
      if (this._counterValue == null) {
        this._counterValue = to;
        this._els.counterCurrent.textContent = formatRupeesInt(to);
        return;
      }

      var from = this._counterValue;
      if (from === to) {
        this._els.counterCurrent.textContent = formatRupeesInt(to);
        return;
      }

      if (this._counterRaf) cancelAnimationFrame(this._counterRaf);

      var delta = to - from;
      var start = performance.now();
      var self = this;
      var tick = function (now) {
        var elapsed = now - start;
        var progress = Math.min(1, elapsed / COUNTER_ANIM_MS);
        var eased = easeOutCubic(progress);
        var current = Math.round(from + delta * eased);
        self._els.counterCurrent.textContent = formatRupeesInt(current);
        if (progress < 1) {
          self._counterRaf = requestAnimationFrame(tick);
        } else {
          self._els.counterCurrent.textContent = formatRupeesInt(to);
          self._counterValue = to;
          self._counterRaf = null;
        }
      };
      this._counterValue = from;
      this._counterRaf = requestAnimationFrame(tick);
    }

    // === NEAR-TIER PULSE ===
    // Toggle a CSS class on the fill when within ₹150 of any LOCKED tier.
    // The class drives a soft pulsing glow — gives a "you're almost there" feel.
    _reflectFillNearMiss(amountRupees) {
      var fill = this._els && this._els.progressFill;
      if (!fill) return;
      var near = false;
      for (var i = 0; i < this.tiers.length; i++) {
        var diff = this.tiers[i] - amountRupees;
        if (diff > 0 && diff <= NEAR_TIER_PULSE) {
          near = true;
          break;
        }
      }
      if (near !== this._nearTier) {
        this._nearTier = near;
        fill.classList.toggle('nn__progress-fill--near', near);
      }
    }

    _getCartLevelDiscountTotal(cart) {
      if (!cart) return 0;
      if (typeof cart.items_subtotal_price === 'number' && typeof cart.total_price === 'number') {
        return Math.max(0, cart.items_subtotal_price - cart.total_price);
      }
      var applications = Array.isArray(cart.cart_level_discount_applications) ? cart.cart_level_discount_applications : [];
      return applications.reduce(function (sum, application) {
        return sum + (toInt(application.total_allocated_amount) || 0);
      }, 0);
    }

    _getAppliedCartDiscountTitles(cart) {
      if (!cart || !Array.isArray(cart.cart_level_discount_applications)) return [];
      return cart.cart_level_discount_applications
        .map(function (application) { return (application.title || '').trim(); })
        .filter(Boolean);
    }

    _getActiveTierDiscount(amountRupees) {
      for (var i = this.tiers.length - 1; i >= 0; i--) {
        if (this.tierTypes[i] === 'discount' && amountRupees >= this.tiers[i] && this.tierCodes[i]) {
          return {
            index: i,
            code: this.tierCodes[i],
            label: this.tierLabels[i],
            threshold: this.tiers[i]
          };
        }
      }
      return null;
    }

    _getHighestUnlockedTierIndex(amountRupees) {
      for (var i = this.tiers.length - 1; i >= 0; i--) {
        if (amountRupees >= this.tiers[i]) return i;
      }
      return -1;
    }

    _getNextGiftTierIndex(amountRupees) {
      for (var i = 0; i < this.tiers.length; i++) {
        if (this.tierTypes[i] === 'free_product' && this.tierGiftVariantIds[i] && amountRupees < this.tiers[i]) {
          return i;
        }
      }
      return -1;
    }

    _extractRewardAmount(label) {
      var match = String(label || '').match(/(\d[\d,]*)/);
      if (!match) return null;
      var value = parseInt(match[1].replace(/,/g, ''), 10);
      return isNaN(value) ? null : value;
    }

    _getSavingsRibbonMessage(unlockedTierIndex, fallbackSavings) {
      var unlockedGiftCount = 0;
      for (var i = 0; i <= unlockedTierIndex; i++) {
        if (this.tierTypes[i] === 'free_product' && this.tierGiftVariantIds[i]) unlockedGiftCount++;
      }
      if (unlockedGiftCount > 0 && this.tierTypes[unlockedTierIndex] === 'free_product') {
        return unlockedGiftCount === 1
          ? "You've earned a <strong>FREE gift</strong>!"
          : "You've earned <strong>" + unlockedGiftCount + " FREE gifts</strong>!";
      }
      if (unlockedTierIndex >= 0 && this.tierTypes[unlockedTierIndex] === 'discount') {
        var rewardAmount = this._extractRewardAmount(this.tierLabels[unlockedTierIndex]);
        if (rewardAmount != null) {
          return "Congrats, you've saved <strong>" + formatINR(rewardAmount * 100) + "</strong> so far!";
        }
      }
      if (fallbackSavings > 0) {
        return "You've saved <strong>" + formatINR(fallbackSavings) + "</strong> so far!";
      }
      return '';
    }

    _applyTierDiscountCode(code) {
      return fetchJSON(ROUTES.update, {
        method: 'POST',
        body: { discount: code || '' }
      });
    }

    _resolveProductVariantId(handle) {
      if (!handle) return Promise.resolve(null);
      return fetch('/products/' + encodeURIComponent(handle) + '.js', {
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (product) {
          if (!product || !product.variants || !product.variants.length) return null;
          var available = product.variants.filter(function (variant) { return variant && variant.available; })[0];
          var chosen = available || product.variants[0];
          return chosen && chosen.id ? toInt(chosen.id) : null;
        })
        .catch(function () { return null; });
    }

    _resolveVariantDataById(variantId) {
      if (!variantId) return Promise.resolve(null);
      return fetch('/variants/' + encodeURIComponent(variantId) + '.js', {
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }

    _ensureTierGiftVariantIds() {
      var self = this;
      if (this._giftVariantsPromise) return this._giftVariantsPromise;
      var tasks = this.tierTypes.map(function (type, index) {
        if (type !== 'free_product' || self.tierGiftVariantIds[index]) {
          return Promise.resolve(self.tierGiftVariantIds[index]);
        }
        return self._resolveProductVariantId(self.tierGiftHandles[index]).then(function (id) {
          if (id) self.tierGiftVariantIds[index] = id;
          return self.tierGiftVariantIds[index];
        });
      });
      this._giftVariantsPromise = Promise.all(tasks).then(function (ids) {
        self._giftVariantsPromise = null;
        return ids;
      });
      return this._giftVariantsPromise;
    }

    _ensureWrapVariantId() {
      var self = this;
      if (this.wrapVariantId) return Promise.resolve(this.wrapVariantId);
      var existingWrap = this._findWrapLine();
      if (existingWrap && existingWrap.variant_id) {
        this.wrapVariantId = toInt(existingWrap.variant_id);
        return Promise.resolve(this.wrapVariantId);
      }
      if (!this.wrapProductHandle) return Promise.resolve(null);
      if (this._wrapVariantPromise) return this._wrapVariantPromise;
      this._wrapVariantPromise = this._resolveProductVariantId(this.wrapProductHandle).then(function (id) {
        if (id) self.wrapVariantId = id;
        self._wrapVariantPromise = null;
        return self.wrapVariantId;
      });
      return this._wrapVariantPromise;
    }

    _ensureWrapPrice() {
      var self = this;
      if (this.wrapPrice) return Promise.resolve(this.wrapPrice);
      if (this._syncWrapPriceFromCart()) return Promise.resolve(this.wrapPrice);
      if (!this.wrapVariantId) return Promise.resolve('');
      if (this._wrapPricePromise) return this._wrapPricePromise;
      this._wrapPricePromise = this._resolveVariantDataById(this.wrapVariantId).then(function (variant) {
        if (variant && typeof variant.price === 'number') {
          self.wrapPrice = formatINR(variant.price);
          self._reflectWrapPrice();
        }
        self._wrapPricePromise = null;
        return self.wrapPrice || '';
      });
      return this._wrapPricePromise;
    }

    _syncWrapPriceFromCart() {
      if (!this._cart) return false;
      var wrapLine = this._findWrapLine();
      if (!wrapLine) return false;
      if (!this.wrapVariantId && wrapLine.variant_id) this.wrapVariantId = toInt(wrapLine.variant_id);
      var paise = typeof wrapLine.original_price === 'number' ? wrapLine.original_price : wrapLine.final_price;
      if (typeof paise !== 'number') return false;
      this.wrapPrice = formatINR(paise);
      this._reflectWrapPrice();
      return true;
    }

    _isWrapLine(item) {
      if (!item) return false;
      if (this.wrapVariantId && item.variant_id === this.wrapVariantId) return true;
      var props = item.properties || {};
      return props._gift_wrap === 'true' || props._gift_wrap === true;
    }

    _isGiftLine(item) {
      if (!item) return false;
      var props = item.properties || {};
      return props._free_gift === 'true' || props._free_gift === true;
    }

    _getGiftLineTierIndex(item) {
      if (!item) return -1;
      var props = item.properties || {};
      var propertyTier = toInt(props._free_gift_tier);
      if (propertyTier && propertyTier >= 1 && propertyTier <= this.tiers.length) return propertyTier - 1;
      return this.tierGiftVariantIds.indexOf(item.variant_id);
    }

    _setGiftBusy(isBusy) {
      this._giftBusyCount = Math.max(0, this._giftBusyCount + (isBusy ? 1 : -1));
      if (this._giftBusyCount > 0) {
        this.setAttribute('data-gift-busy', 'true');
      } else {
        this.removeAttribute('data-gift-busy');
      }
    }

    _withGiftBusy(task) {
      var self = this;
      this._setGiftBusy(true);
      return Promise.resolve()
        .then(task)
        .finally(function () {
          self._setGiftBusy(false);
        });
    }

    _findWrapLine() {
      if (!this._cart || !Array.isArray(this._cart.items)) return null;
      for (var i = 0; i < this._cart.items.length; i++) {
        if (this._isWrapLine(this._cart.items[i])) return this._cart.items[i];
      }
      return null;
    }

    _reflectWrapPrice() {
      if (!this._els || !this._els.wrapPriceText) return;
      if (this.wrapPrice) {
        this._els.wrapPriceText.hidden = false;
        this._els.wrapPriceText.textContent = ' for ' + this.wrapPrice;
      } else {
        this._els.wrapPriceText.textContent = '';
        this._els.wrapPriceText.hidden = true;
      }
    }

    _replaceTierDiscountCode(code) {
      var nextCode = code || '';
      var self = this;
      var appliedTitles = this._getAppliedCartDiscountTitles(this._cart);
      if (!appliedTitles.length) {
        return this._applyTierDiscountCode(nextCode);
      }
      return this._applyTierDiscountCode('')
        .then(function (cart) {
          self._applyServerCart(cart);
          if (!nextCode) return cart;
          return self._applyTierDiscountCode(nextCode);
        });
    }

    _syncLatestTierDiscount() {
      if (!this._cart) return Promise.resolve();

      var self = this;
      var progressSubtotal = 0;
      (this._cart.items || []).forEach(function (item) {
        if (self._isGiftLine(item)) return;
        if (self._isWrapLine(item)) return;
        progressSubtotal += item.final_line_price;
      });

      var latest = this._getActiveTierDiscount(progressSubtotal / 100);
      var targetCode = latest && latest.code ? latest.code : '';
      var appliedTitles = this._getAppliedCartDiscountTitles(this._cart);
      if ((targetCode && appliedTitles.length === 1 && appliedTitles[0] === targetCode) || (!targetCode && appliedTitles.length === 0)) {
        this._lastDiscountSyncSignature = null;
        return Promise.resolve();
      }

      var signature = (targetCode || '__none__') + '|' + progressSubtotal + '|' + ((this._cart && this._cart.item_count) || 0);
      if (this._lastDiscountSyncSignature === signature) return Promise.resolve();
      this._lastDiscountSyncSignature = signature;

      return this._replaceTierDiscountCode(targetCode)
        .then(function (cart) {
          self._applyServerCart(cart);
          var updatedTitles = self._getAppliedCartDiscountTitles(cart);
          if ((targetCode && updatedTitles.length === 1 && updatedTitles[0] === targetCode) || (!targetCode && updatedTitles.length === 0)) {
            self._lastDiscountSyncSignature = null;
          }
        })
        .catch(function (err) {
          console.warn('[NamNamCart] tier discount sync error', err);
        });
    }

    _syncDerivedCartState() {
      var self = this;
      return this._reconcileGift().then(function () {
        return self._syncLatestTierDiscount();
      });
    }

    open() {
      if (this._open) return;
      this._open = true;
      this._lastActive = document.activeElement;
      this.setAttribute('aria-hidden', 'false');
      document.body.classList.add('nn-cart-open');
      try {
        if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, '1');
        else this.classList.add('nn-fast-open');
      } catch (e) {}
      if (!this._cart || (Date.now() - this._lastHydrate) > CART_STALE_MS) {
        this.refresh();
      }
      this._startTimerIfNeeded();
      var self = this;
      requestAnimationFrame(function () {
        var close = self.querySelector('.nn__close');
        if (close) close.focus();
      });
    }

    close() {
      if (!this._open) return;
      if (this._sheetOpen) { this._closeSheet(); return; }
      this._open = false;
      this.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('nn-cart-open');
      this._stopTimer();
      if (this._lastActive && this._lastActive.focus) this._lastActive.focus();
    }

    _onKeydown(e) {
      if (!this._open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this._sheetOpen) this._closeSheet();
        else this.close();
      }
    }

    _onClick(e) {
      var t = e.target;
      if (t.closest('[data-cart-close]')) { this.close(); return; }
      if (t.closest('[data-cart-checkout]')) { e.preventDefault(); this._goToCheckout(); return; }
      if (t.closest('[data-upsell-prev]')) { e.preventDefault(); this._scrollUpsell(-1); return; }
      if (t.closest('[data-upsell-next]')) { e.preventDefault(); this._scrollUpsell(1); return; }
      var upAdd = t.closest('[data-upsell-add]');
      if (upAdd) { e.preventDefault(); this._addFromUpsell(upAdd); return; }
      var inc = t.closest('[data-qty-increase]');
      var dec = t.closest('[data-qty-decrease]');
      if (inc || dec) {
        var row = t.closest('[data-cart-item]');
        if (!row) return;
        var key = row.dataset.lineKey;
        var item = this._findItem(key);
        if (!item) return;
        var current = this._optimistic[key] != null ? this._optimistic[key] : item.quantity;
        var next = inc ? current + 1 : Math.max(0, current - 1);
        if (next > current) haptic(15);
        this._setQty(key, next);
        return;
      }
      if (t.closest('[data-item-remove]')) {
        var row2 = t.closest('[data-cart-item]');
        if (!row2) return;
        var key2 = row2.dataset.lineKey;
        var item2 = this._findItem(key2);
        if (!item2) return;
        row2.classList.add('is-leaving');
        this._stageRemove(key2, item2);
        return;
      }
    }

    _stageRemove(key, item) {
      var self = this;
      this._pendingRemove = { key: key, snapshot: { id: item.variant_id, quantity: item.quantity, properties: item.properties || {} } };
      this._setQty(key, 0);
      this._showUndoToast('Removed ' + (item.product_title || 'item'));
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(function () {
        self._hideUndoToast();
        self._pendingRemove = null;
      }, UNDO_TOAST_MS);
    }

    _performUndo() {
      var self = this;
      var pending = this._pendingRemove;
      if (!pending) return;
      this._hideUndoToast();
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._pendingRemove = null;
      this._enqueue(function () {
        return addCartItem({
          id: pending.snapshot.id,
          quantity: pending.snapshot.quantity,
          properties: pending.snapshot.properties
        })
          .then(function () { return fetchJSON(ROUTES.cart); })
          .then(function (cart) { self._applyServerCart(cart); return self._syncDerivedCartState(); });
      });
    }

    _showUndoToast(text) {
      if (!this._els.undoToast) return;
      if (this._els.undoText) this._els.undoText.textContent = text;
      this._els.undoToast.setAttribute('aria-hidden', 'false');
    }

    _hideUndoToast() {
      if (!this._els.undoToast) return;
      this._els.undoToast.setAttribute('aria-hidden', 'true');
    }

    _setBusy(busy) {
      if (busy) {
        this.setAttribute('data-nn-busy', '');
      } else {
        this.removeAttribute('data-nn-busy');
      }
    }

    _enqueue(fn) {
      var self = this;
      // Capture the promise BEFORE extending the chain so we can detect
      // when THIS specific enqueue is the last one still pending.
      var p = this._queue.then(function () {
        self._setBusy(true);
        return Promise.resolve(fn()).catch(function (err) {
          console.warn('[NamNamCart] queue error', err);
        });
      });
      this._queue = p;
      // Clear busy only when no later item has extended the queue past us.
      p.then(function () {
        if (self._queue === p) self._setBusy(false);
      });
      return p;
    }

    refresh() {
      var self = this;
      this._setBusy(true);
      return fetchJSON(ROUTES.cart).then(function (cart) {
        self._applyServerCart(cart);
        return self._enqueue(function () { return self._syncDerivedCartState(); });
      }).catch(function (err) {
        console.error('[NamNamCart] refresh failed:', err);
        self._setBusy(false);
      });
    }

    _setQty(key, qty) {
      if (!key) return;
      if (!this._els || !this._els.items) this._cacheElements();
      this._optimistic[key] = qty;
      this._render();
      if (this._qtyTimers[key]) clearTimeout(this._qtyTimers[key]);
      var self = this;
      this._qtyTimers[key] = setTimeout(function () {
        delete self._qtyTimers[key];
        var finalQty = self._optimistic[key];
        if (finalQty == null) return;
        self._enqueue(function () {
          return fetchJSON(ROUTES.change, { method: 'POST', body: { id: key, quantity: finalQty } })
            .then(function (cart) {
              delete self._optimistic[key];
              self._applyServerCart(cart);
              return self._syncDerivedCartState();
            })
            .catch(function (err) {
              console.warn('[NamNamCart] qty sync error', err);
              delete self._optimistic[key];
              return fetchJSON(ROUTES.cart).then(function (c) { self._applyServerCart(c); });
            });
        });
      }, QTY_SYNC_MS);
    }

    _applyServerCart(cart) {
      this._cart = cart;
      this._lastHydrate = Date.now();
      var keys = (cart.items || []).map(function (i) { return i.key; });
      var opt = this._optimistic;
      Object.keys(opt).forEach(function (k) {
        if (keys.indexOf(k) === -1) delete opt[k];
      });
      this._syncWrapPriceFromCart();
      this._render();
      this._reflectNoteState();
      this._reflectWrapToggle();
    }

    _reconcileGift() {
      var self = this;
      if (!this._cart) return Promise.resolve();
      return this._ensureTierGiftVariantIds().then(function () {
        var items = self._cart.items || [];
        var nonGiftSubtotal = 0;
        items.forEach(function (item) {
          if (self._isGiftLine(item) || self._isWrapLine(item)) return;
          nonGiftSubtotal += item.final_line_price;
        });
        var amount = nonGiftSubtotal / 100;
        var desiredTiers = [];
        self.tierTypes.forEach(function (type, index) {
          if (type === 'free_product' && self.tierGiftVariantIds[index] && amount >= self.tiers[index]) {
            desiredTiers.push(index);
          }
        });

        var keptTiers = {};
        var toRemove = [];
        items.filter(function (item) { return self._isGiftLine(item); }).forEach(function (line) {
          var tierIndex = self._getGiftLineTierIndex(line);
          var isDesired = desiredTiers.indexOf(tierIndex) !== -1;
          var isCorrectVariant = tierIndex >= 0 && line.variant_id === self.tierGiftVariantIds[tierIndex];
          if (!isDesired || !isCorrectVariant || keptTiers[tierIndex]) {
            toRemove.push(line);
          } else {
            keptTiers[tierIndex] = true;
          }
        });

        var toAdd = desiredTiers.filter(function (index) { return !keptTiers[index]; });
        if (!toRemove.length && !toAdd.length) return Promise.resolve();

        return self._withGiftBusy(function () {
          var task = toRemove.reduce(function (promise, line) {
            return promise.then(function () {
              return fetchJSON(ROUTES.change, { method: 'POST', body: { id: line.key, quantity: 0 } });
            });
          }, Promise.resolve());

          task = toAdd.reduce(function (promise, tierIndex) {
            return promise.then(function () {
              return addCartItem({
                id: self.tierGiftVariantIds[tierIndex],
                quantity: 1,
                properties: {
                  _free_gift: 'true',
                  _free_gift_tier: String(tierIndex + 1)
                }
              });
            });
          }, task);

          return task
            .then(function () { return fetchJSON(ROUTES.cart); })
            .then(function (cart) { self._applyServerCart(cart); })
            .catch(function (err) {
              console.warn('[NamNamCart] gift reconciliation error', err);
              return fetchJSON(ROUTES.cart).then(function (cart) { self._applyServerCart(cart); });
            });
        });
      });
    }

    _render() {
      if (!this._els || !this._els.items || !this._els.empty) this._cacheElements();
      if (!this._cart) return;
      var cart = this._cart;
      var opt = this._optimistic;
      var self = this;
      var displayItems = (cart.items || []).filter(function (i) {
        var q = opt[i.key] != null ? opt[i.key] : i.quantity;
        return q > 0;
      });
      var empty = displayItems.length === 0;
      var subtotalFinal = 0;
      var subtotalOriginal = 0;
      var progressSubtotal = 0;
      var count = 0;
      displayItems.forEach(function (i) {
        var q = opt[i.key] != null ? opt[i.key] : i.quantity;
        count += q;
        if (self._isGiftLine(i)) return;
        subtotalFinal += i.final_price * q;
        subtotalOriginal += (i.original_price || i.final_price) * q;
        if (self._isWrapLine(i)) return;
        progressSubtotal += i.final_price * q;
      });
      var cartLevelDiscount = this._getCartLevelDiscountTotal(cart);
      var displayTotal = Math.max(0, subtotalFinal - cartLevelDiscount);

      this._renderItems(displayItems, opt);
      this._renderUpsellFiltered(displayItems);

      if (this._els.count) this._els.count.textContent = count;
      var ext = document.querySelectorAll('[data-cart-count-external], .cart-count-bubble');
      for (var i = 0; i < ext.length; i++) {
        ext[i].textContent = count;
        if (count > 0) ext[i].removeAttribute('hidden');
      }

      if (this._els.subtotal) this._els.subtotal.textContent = formatINR(displayTotal);
      if (this._els.checkoutAmount) this._els.checkoutAmount.textContent = formatINR(displayTotal);

      var savings = Math.max(0, subtotalOriginal - displayTotal);
      var unlockedTierIndex = this._getHighestUnlockedTierIndex(progressSubtotal / 100);
      if (savings > 0 && subtotalOriginal > 0) {
        var pct = Math.round((savings / subtotalOriginal) * 100);
        if (this._els.originalTotal) {
          this._els.originalTotal.textContent = formatINR(subtotalOriginal);
          this._els.originalTotal.hidden = false;
        }
        if (this._els.percent) {
          this._els.percent.textContent = '(' + pct + '% OFF)';
          this._els.percent.hidden = false;
        }
        if (this._els.savings) this._els.savings.hidden = false;
      } else {
        if (this._els.originalTotal) this._els.originalTotal.hidden = true;
        if (this._els.percent) this._els.percent.hidden = true;
      }

      var savingsMessage = this._getSavingsRibbonMessage(unlockedTierIndex, savings);
      if (this._els.savings && this._els.savingsText) {
        this._els.savings.hidden = !savingsMessage;
        if (savingsMessage) this._els.savingsText.innerHTML = savingsMessage;
      } else if (this._els.savings) {
        this._els.savings.hidden = !savingsMessage;
      }

      var amountRupees = subtotalFinal / 100;
      if (this._els.perkShipping && this._els.perkShippingText) {
        if (amountRupees >= this.freeShipThreshold) {
          this._els.perkShipping.hidden = false;
          this._els.perkShippingText.textContent = 'FREE shipping ✓';
          if (this._els.perkDot) this._els.perkDot.hidden = false;
        } else if (!empty) {
          this._els.perkShipping.hidden = false;
          var diff = Math.max(0, this.freeShipThreshold - amountRupees);
          this._els.perkShippingText.textContent = 'Add ' + formatINR(diff * 100) + ' for FREE shipping';
          if (this._els.perkDot) this._els.perkDot.hidden = false;
        } else {
          this._els.perkShipping.hidden = true;
          if (this._els.perkDot) this._els.perkDot.hidden = true;
        }
      }

      if (this._els.nudge && this._els.nudgeText) {
        var progressRupees = progressSubtotal / 100;
        var nextGiftTierIndex = this._getNextGiftTierIndex(progressRupees);
        if (!empty && nextGiftTierIndex !== -1) {
          var nudgeDiff = this.tiers[nextGiftTierIndex] - progressRupees;
          var giftLabel = escapeHTML(this.tierLabels[nextGiftTierIndex]);
          if (nudgeDiff <= NEAR_MISS_LOUD) {
            this._els.nudgeText.innerHTML = "You're <b>" + formatINR(nudgeDiff * 100) + " away</b> from <b>" + giftLabel + "</b>!";
            this._els.nudge.hidden = false;
            this._els.nudge.classList.add('nn__nudge--hot');
          } else if (displayItems.length >= 2) {
            this._els.nudgeText.innerHTML = "Add <b>one more</b> to unlock <b>" + giftLabel + "</b> 🎁";
            this._els.nudge.hidden = false;
            this._els.nudge.classList.remove('nn__nudge--hot');
          } else {
            this._els.nudge.hidden = true;
          }
        } else {
          this._els.nudge.hidden = true;
        }
      }

      if (this._els.empty) this._els.empty.hidden = !empty;
      if (this._els.gifts) this._els.gifts.hidden = empty;
      if (this._els.footer) this._els.footer.hidden = empty;
      if (this._els.upsell) this._els.upsell.hidden = empty;
      if (this._els.progress) this._els.progress.hidden = empty;
      if (this._els.timer) this._els.timer.hidden = empty;
      if (empty) this._stopTimer();

      this._renderProgress(progressSubtotal);
      this._updateUpsellArrows();
    }

    _findItem(key) {
      if (!this._cart) return null;
      var items = this._cart.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].key === key) return items[i];
      }
      return null;
    }

    _renderItems(items, opt) {
      var list = this._els.items;
      if (!list) return;
      var existing = {};
      var rows = Array.prototype.slice.call(list.children);
      rows.forEach(function (row) {
        var k = row.dataset.lineKey;
        if (k && !row.classList.contains('is-leaving')) existing[k] = row;
      });
      var newKeys = items.map(function (i) { return i.key; });
      rows.forEach(function (row) {
        if (newKeys.indexOf(row.dataset.lineKey) === -1 && !row.classList.contains('is-leaving')) {
          row.remove();
        }
      });
      list.querySelectorAll('.is-leaving').forEach(function (r) {
        if (newKeys.indexOf(r.dataset.lineKey) === -1) {
          setTimeout(function () { r.remove(); }, 240);
        }
      });

      var prevNode = null;
      var highlightVariantId = this._pendingHighlight;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var qty = opt[item.key] != null ? opt[item.key] : item.quantity;
        var isGift = this._isGiftLine(item);
        var shouldHighlight = highlightVariantId && item.variant_id === highlightVariantId;
        var newNode = this._buildRow(item, qty, isGift, opt[item.key] != null, shouldHighlight);
        var oldRow = existing[item.key];
        if (oldRow) {
          oldRow.replaceWith(newNode);
        } else {
          if (prevNode) list.insertBefore(newNode, prevNode.nextSibling);
          else list.insertBefore(newNode, list.firstChild);
        }
        prevNode = newNode;
      }
      this._pendingHighlight = null;
    }

    _renderUpsellFiltered(cartItems) {
      var track = this._els.upsellTrack;
      if (!track) return;
      var cartVariantIds = {};
      cartItems.forEach(function (i) { cartVariantIds[i.variant_id] = true; });
      var cards = track.querySelectorAll('[data-upsell-card]');
      var shown = 0;
      cards.forEach(function (card) {
        var vid = toInt(card.getAttribute('data-upsell-variant-id'));
        if (vid && cartVariantIds[vid]) {
          card.style.display = 'none';
        } else {
          card.style.display = '';
          shown++;
        }
      });
      if (this._els.upsell) {
        this._els.upsell._nnEmpty = shown === 0;
      }
    }

    _buildRow(item, qty, isGift, isPending, shouldHighlight) {
      var hasDiscount = item.original_price > item.final_price;
      var lineFinal = item.final_price * qty;
      var lineOriginal = item.original_price * qty;
      var discountAmount = lineOriginal - lineFinal;
      var pct = hasDiscount ? Math.round((discountAmount / lineOriginal) * 100) : 0;

      var imgHTML = item.image
        ? '<img src="' + imgUrl(item.image, 200) + '" width="84" height="84" alt="' + escapeHTML(item.product_title) + '" loading="lazy" decoding="async">'
        : '<div class="nn__item-media-fallback"></div>';

      var titlePrefix = isGift ? '<span class="nn__item-gift-emoji" aria-hidden="true">🎁</span> ' : '';
      var titleHtml = titlePrefix + escapeHTML(item.product_title);
      if (item.variant_title && item.variant_title !== 'Default Title') {
        titleHtml += ' - ' + escapeHTML(item.variant_title);
      }

      var priceBlock;
      if (isGift) {
        priceBlock =
          '<span class="nn__item-price-was">' + formatINR(item.original_price) + '</span>' +
          '<span class="nn__item-price-free">FREE</span>';
      } else if (hasDiscount) {
        priceBlock =
          '<span class="nn__item-price-was">' + formatINR(lineOriginal) + '</span>' +
          '<span class="nn__item-price-now">' + formatINR(lineFinal) + '</span>' +
          '<span class="nn__item-price-pct">(' + pct + '% OFF)</span>';
      } else {
        priceBlock = '<span class="nn__item-price-now">' + formatINR(lineFinal) + '</span>';
      }

      var chipHtml = '';
      if (hasDiscount && !isGift) {
        var perUnitSavings = item.original_price - item.final_price;
        chipHtml =
          '<span class="nn__item-chip">' +
            '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
            '<span>' + formatINR(perUnitSavings) + ' off each</span>' +
          '</span>';
      }

      var qtyBlock;
      if (isGift) {
        qtyBlock = '<div class="nn__item-qty nn__item-qty--gift"><span class="nn__item-qty-num">' + qty + '</span></div>';
      } else {
        var minusDisabled = qty <= 1 ? ' disabled' : '';
        qtyBlock =
          '<div class="nn__item-qty">' +
            '<button type="button" class="nn__item-qty-btn" data-qty-decrease aria-label="Decrease"' + minusDisabled + '>' +
              '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            '</button>' +
            '<span class="nn__item-qty-num" data-qty-num aria-live="polite">' + qty + '</span>' +
            '<button type="button" class="nn__item-qty-btn" data-qty-increase aria-label="Increase">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            '</button>' +
          '</div>';
      }

      var removeBtn = isGift ? '' :
        '<button type="button" class="nn__item-remove" data-item-remove aria-label="Remove">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
        '</button>';

      var li = document.createElement('li');
      li.className = 'nn__item' + (isGift ? ' nn__item--gift' : '') + (isPending ? ' is-pending' : '') + (shouldHighlight ? ' nn__item--just-added' : '');
      li.setAttribute('data-cart-item', '');
      li.dataset.lineKey = item.key;
      li.dataset.variantId = item.variant_id;
      li.innerHTML =
        '<a href="' + item.url + '" class="nn__item-media" tabindex="-1" aria-hidden="true">' + imgHTML + '</a>' +
        '<div class="nn__item-main">' +
          '<div class="nn__item-row-top">' +
            '<a href="' + item.url + '" class="nn__item-title">' + titleHtml + '</a>' +
            '<div class="nn__item-price">' + priceBlock + '</div>' +
          '</div>' +
          (chipHtml ? '<div class="nn__item-chips">' + chipHtml + '</div>' : '') +
          '<div class="nn__item-row-bot">' +
            qtyBlock +
            removeBtn +
          '</div>' +
        '</div>';

      if (shouldHighlight) {
        setTimeout(function () { li.classList.remove('nn__item--just-added'); }, 2400);
      }

      return li;
    }

    _renderProgress(subtotalPaise) {
      var amount = subtotalPaise / 100;
      var tiers = this.tiers;
      var percent = this._getProgressPercent(amount);

      // Drive the three dynamic pieces
      this._animateFill(percent);
      this._animateCounter(amount);
      this._reflectFillNearMiss(amount);

      if (this._els.progressTrack) this._els.progressTrack.setAttribute('aria-valuenow', Math.round(percent));

      // Track-level shimmer for the final stretch (>83%)
      if (this._els.progressTrack) {
        this._els.progressTrack.classList.toggle('nn__progress-track--shimmer', percent > 83 && percent < 100);
      }

      var unlocked = tiers.map(function (tt) { return amount >= tt; });
      var newlyUnlockedIdx = -1;
      for (var i = 0; i < this._els.progressTiers.length; i++) {
        var was = this._lastUnlocked[i];
        var is = unlocked[i];
        this._els.progressTiers[i].classList.toggle('is-unlocked', is);
        if (this._els.progressMarkers && this._els.progressMarkers[i]) {
          this._els.progressMarkers[i].classList.toggle('is-unlocked', is);
        }
        if (is && !was) {
          newlyUnlockedIdx = i;
          this._els.progressTiers[i].classList.add('nn__progress-tier--pop');
          (function (el) {
            setTimeout(function () { el.classList.remove('nn__progress-tier--pop'); }, 800);
          })(this._els.progressTiers[i]);
        }
      }
      var newlyUnlocked = newlyUnlockedIdx !== -1;
      if (newlyUnlocked && this._open && this._lastHydrate > 0) {
        this._confetti();
        haptic(80);
        this._tierJustUnlocked = newlyUnlockedIdx;
      }
      this._lastUnlocked = unlocked;

      if (this._els.progressMsgText) {
        if (newlyUnlocked && this._tierJustUnlocked !== -1) {
          var unlockedLabel = this.tierLabels[this._tierJustUnlocked];
          this._els.progressMsgText.innerHTML = '🎉 <b>Unlocked!</b> ' + escapeHTML(unlockedLabel);
          if (this._els.progressMsgIco) this._els.progressMsgIco.textContent = '🎊';
          if (this._els.progressMessage) this._els.progressMessage.classList.add('nn__progress-msg--celebrate');
          var self = this;
          setTimeout(function () {
            if (self._els.progressMessage) self._els.progressMessage.classList.remove('nn__progress-msg--celebrate');
            self._tierJustUnlocked = -1;
            self._renderProgressMessage(unlocked, amount);
          }, 2600);
        } else {
          this._renderProgressMessage(unlocked, amount);
        }
      }
    }

    _renderProgressMessage(unlocked, amount) {
      if (!this._els.progressMsgText) return;
      var nextIdx = unlocked.indexOf(false);
      if (nextIdx === -1) {
        this._els.progressMsgText.innerHTML = "All rewards unlocked. <b>Treat yourself!</b>";
        if (this._els.progressMsgIco) this._els.progressMsgIco.textContent = '🎉';
        return;
      }
      var diff = Math.max(0, this.tiers[nextIdx] - amount);
      var diffStr = formatINR(Math.ceil(diff) * 100);
      var label = this.tierLabels[nextIdx];
      var loud = diff <= NEAR_MISS_LOUD && diff > 0;
      if (loud) {
        this._els.progressMsgText.innerHTML = "<b>So close!</b> Just <b>" + diffStr + "</b> more for <b>" + escapeHTML(label) + "</b>";
      } else {
        this._els.progressMsgText.innerHTML = "Add <b>" + diffStr + "</b> more, get <b>" + escapeHTML(label) + "</b>";
      }
      if (this._els.progressMsgIco) {
        this._els.progressMsgIco.textContent = this.tierTypes[nextIdx] === 'free_product' ? '🎁' : '💰';
      }
    }

    _startTimerIfNeeded() {
      if (!this._cart || !this._cart.items || this._cart.items.length === 0) return;
      this._ensureTimerExpiry();
      if (this._els.timer) this._els.timer.hidden = false;
      this._timerLastSec = -1;
      var self = this;
      var loop = function () {
        if (!self._open) { self._timerRaf = null; return; }
        var expiry;
        try { expiry = parseInt(localStorage.getItem(TIMER_KEY), 10); } catch (e) { expiry = 0; }
        if (!expiry) { self._stopTimer(); return; }
        var ms = expiry - Date.now();
        if (ms <= 0) {
          var fresh = Date.now() + self.timerMinutes * 60 * 1000;
          try { localStorage.setItem(TIMER_KEY, String(fresh)); } catch (e) {}
          ms = fresh - Date.now();
        }
        var totalSec = Math.floor(ms / 1000);
        if (totalSec !== self._timerLastSec) {
          self._timerLastSec = totalSec;
          var m = Math.floor(totalSec / 60);
          var s = totalSec % 60;
          if (self._els.timerText) self._els.timerText.textContent = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        }
        self._timerRaf = requestAnimationFrame(loop);
      };
      this._timerRaf = requestAnimationFrame(loop);
    }
    _stopTimer() { if (this._timerRaf) { cancelAnimationFrame(this._timerRaf); this._timerRaf = null; } }
    _ensureTimerExpiry() {
      try {
        var expiry = parseInt(localStorage.getItem(TIMER_KEY), 10);
        if (!expiry || expiry < Date.now()) {
          expiry = Date.now() + this.timerMinutes * 60 * 1000;
          localStorage.setItem(TIMER_KEY, String(expiry));
        }
      } catch (e) {}
    }

    _onWrapToggle(e) {
      var checked = e.target.checked;
      console.log('[NamNamCart] wrap toggle changed', {
        checked: checked,
        wrapVariantId: this.wrapVariantId,
        wrapProductHandle: this.wrapProductHandle
      });
      var self = this;
      if (this._els.wrapToggle) this._els.wrapToggle.disabled = true;
      this._enqueue(function () {
        return self._ensureWrapVariantId().then(function (wid) {
          if (!wid) {
            if (self._els.wrapToggle) self._els.wrapToggle.disabled = false;
            return Promise.resolve();
          }
          var existing = self._findWrapLine();
          if (checked && !existing) {
            console.log('[NamNamCart] adding gift wrap to cart', {
              variantId: wid,
              quantity: 1,
              properties: { _gift_wrap: 'true' }
            });
            return addCartItem({
              id: wid,
              quantity: 1,
              properties: { _gift_wrap: 'true' }
            })
              .then(function () { return fetchJSON(ROUTES.cart); })
              .then(function (cart) { self._applyServerCart(cart); return self._syncDerivedCartState(); });
          }
          if (!checked && existing) {
            return fetchJSON(ROUTES.change, { method: 'POST', body: { id: existing.key, quantity: 0 } })
              .then(function (cart) { self._applyServerCart(cart); return self._syncDerivedCartState(); });
          }
          return Promise.resolve();
        }).catch(function (err) {
          console.warn('[NamNamCart] wrap toggle error', err);
          if (self._els.wrapToggle) self._els.wrapToggle.checked = !checked;
        }).finally(function () {
          if (self._els.wrapToggle) self._els.wrapToggle.disabled = false;
        });
      });
    }

    _onWrapLabelClick(e) {
      if (!this._els.wrapToggle) return;
      if (e.target === this._els.wrapToggle) return;
      if (this._els.wrapToggle.disabled) return;
      e.preventDefault();
      this._els.wrapToggle.checked = !this._els.wrapToggle.checked;
      console.log('[NamNamCart] wrap label clicked', {
        checked: this._els.wrapToggle.checked
      });
      this._onWrapToggle({ target: this._els.wrapToggle });
    }

    _reflectWrapToggle() {
      this._syncWrapPriceFromCart();
      if (!this._els.wrapToggle) return;
      var hasWrap = !!this._findWrapLine();
      if (this._els.wrapToggle.checked !== hasWrap) this._els.wrapToggle.checked = hasWrap;
      if (this._els.specialWrap) this._els.specialWrap.hidden = hasWrap;
    }

    _reflectNoteState() {
      if (!this._cart) return;
      var note = (this._cart.note || '').trim();
      if (this._els.noteInput && !this._sheetOpen) this._els.noteInput.value = this._cart.note || '';
      this._updateNoteSubText(note);
      this._updateNoteCount(this._cart.note || '');
    }

    _openSheet() {
      if (!this._els.sheet || this._sheetOpen) return;
      this._sheetOpen = true;
      this._els.sheet.setAttribute('aria-hidden', 'false');
      if (this._els.noteInput) this._updateNoteCount(this._els.noteInput.value || '');
      var self = this;
      requestAnimationFrame(function () {
        if (self._els.noteInput) self._els.noteInput.focus();
      });
    }

    _closeSheet() {
      if (!this._els.sheet || !this._sheetOpen) return;
      this._sheetOpen = false;
      this._els.sheet.setAttribute('aria-hidden', 'true');
    }

    _saveNoteAndClose() {
      var val = (this._els.noteInput && this._els.noteInput.value || '').trim();
      if (this._saveNoteDebounced && this._saveNoteDebounced.cancel) this._saveNoteDebounced.cancel();
      this._updateNoteSubText(val);
      this._saveNoteToServer(val);
      this._closeSheet();
    }

    _clearNote() {
      if (this._saveNoteDebounced && this._saveNoteDebounced.cancel) this._saveNoteDebounced.cancel();
      if (this._els.noteInput) this._els.noteInput.value = '';
      this._updateNoteCount('');
      this._updateNoteSubText('');
      this._saveNoteToServer('');
    }

    _onNoteInput(e) {
      var val = e.target.value || '';
      this._updateNoteCount(val);
      this._saveNoteDebounced(val);
    }

    _saveNoteToServer(val) {
      var v = typeof val === 'string' ? val : (this._els.noteInput && this._els.noteInput.value || '');
      var self = this;
      this._enqueue(function () {
        return fetchJSON(ROUTES.update, { method: 'POST', body: { note: v } })
          .then(function (cart) {
            self._applyServerCart(cart);
            self._updateNoteSubText((cart && cart.note) || v);
          })
          .catch(function (err) { console.warn('[NamNamCart] note save error', err); });
      });
    }

    _updateNoteCount(val) {
      if (this._els.noteCount) this._els.noteCount.textContent = (val || '').length;
    }

    _updateNoteSubText(val) {
      if (!this._els.noteStatus) return;
      var v = (val || '').trim();
      var openBtn = this._els.openNoteBtn;
      if (v) {
        var preview = v.length > 40 ? v.substring(0, 40) + '…' : v;
        this._els.noteStatus.innerHTML = '✓ "' + escapeHTML(preview) + '"';
        if (openBtn) openBtn.classList.add('has-note');
      } else {
        this._els.noteStatus.textContent = "We'll handwrite-style print it on a card";
        if (openBtn) openBtn.classList.remove('has-note');
      }
    }

    _scrollUpsell(direction) {
      var track = this._els.upsellTrack;
      if (!track) return;
      var card = track.querySelector('[data-upsell-card]:not([style*="display: none"])');
      var step = card ? card.offsetWidth + 8 : 130;
      track.scrollBy({ left: step * direction * 2, behavior: 'smooth' });
    }
    _onUpsellScroll() {
      if (this._upsellRaf) return;
      var self = this;
      this._upsellRaf = requestAnimationFrame(function () {
        self._updateUpsellArrows();
        self._upsellRaf = null;
      });
    }
    _updateUpsellArrows() {
      var track = this._els.upsellTrack;
      var prev = this._els.upsellPrev;
      var next = this._els.upsellNext;
      if (!track || !prev || !next) return;
      prev.disabled = track.scrollLeft <= 1;
      next.disabled = track.scrollLeft >= (track.scrollWidth - track.clientWidth - 1);
    }
    _addFromUpsell(btn) {
      if (btn.disabled || btn.classList.contains('is-added')) return;
      var id = toInt(btn.dataset.variantId);
      if (!id) return;
      var originalHTML = btn.innerHTML;
      btn.disabled = true;
      var self = this;
      this._enqueue(function () {
        return addCartItem({ id: id, quantity: 1 })
          .then(function () { return fetchJSON(ROUTES.cart); })
          .then(function (cart) {
            self._pendingHighlight = id;
            self._applyServerCart(cart);
            haptic(25);
            btn.classList.add('is-added');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Added</span>';
            setTimeout(function () {
              btn.classList.remove('is-added');
              btn.innerHTML = originalHTML;
              btn.disabled = false;
            }, 1400);
            self._ensureTimerExpiry();
            if (self._open) self._startTimerIfNeeded();
            return self._syncDerivedCartState();
          })
          .catch(function (err) {
            console.warn('[NamNamCart] upsell add error', err);
            btn.disabled = false;
            btn.innerHTML = originalHTML;
          });
      });
    }

    _goToCheckout() {
      haptic(30);
      var self = this;
      this._enqueue(function () {
        return self._syncLatestTierDiscount();
      }).finally(function () {
        if (typeof window.gokwikCheckout === 'function') {
          try { window.gokwikCheckout(); return; } catch (e) {}
        }
        if (window.gokwikSdk && typeof window.gokwikSdk.openModal === 'function') {
          try { window.gokwikSdk.openModal(); return; } catch (e) {}
        }
        window.location.href = '/checkout';
      });
    }

    _confetti() {
      var canvas = this._els.confetti;
      if (!canvas || !this._els.panel) return;
      var rect = this._els.panel.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.left = rect.left + 'px';
      canvas.style.top = rect.top + 'px';
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      var ctx = canvas.getContext('2d');
      var colors = ['#e88e1c', '#9edbd3', '#ffdfb8', '#020912', '#8fbf9f'];
      var pieces = [];
      var burstX = rect.width / 2;
      var burstY = 180;
      for (var i = 0; i < 60; i++) {
        pieces.push({
          x: burstX, y: burstY,
          vx: (Math.random() - 0.5) * 9,
          vy: -(Math.random() * 9 + 5),
          g: 0.3,
          size: Math.random() * 6 + 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.25,
          life: 0
        });
      }
      var maxLife = 78;
      var anim = function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var alive = false;
        pieces.forEach(function (p) {
          if (p.life > maxLife) return;
          alive = true;
          p.life++;
          p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, 1 - p.life / maxLife);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        });
        if (alive) requestAnimationFrame(anim);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
      };
      requestAnimationFrame(anim);
    }
  }

  if (!customElements.get('cart-drawer')) {
    customElements.define('cart-drawer', CartDrawer);
  }

  if (window.Shopify && window.Shopify.designMode && !window.__nnCartEditorEventsBound) {
    window.__nnCartEditorEventsBound = true;
    var getEditorDrawer = function (event) {
      if (!event || !event.target) return null;
      if (event.target.matches && event.target.matches('cart-drawer')) return event.target;
      return event.target.querySelector ? event.target.querySelector('cart-drawer') : null;
    };
    document.addEventListener('shopify:section:load', function (event) {
      var drawer = getEditorDrawer(event);
      if (!drawer) return;
      requestAnimationFrame(function () {
        if (drawer._initialized) drawer._reloadTierSettings();
        else if (typeof drawer._scheduleInit === 'function') drawer._scheduleInit();
        if (typeof drawer.open === 'function') drawer.open();
      });
    });
    document.addEventListener('shopify:section:select', function (event) {
      var drawer = getEditorDrawer(event);
      if (drawer && typeof drawer.open === 'function') drawer.open();
    });
    document.addEventListener('shopify:section:deselect', function (event) {
      var drawer = getEditorDrawer(event);
      if (drawer && typeof drawer.close === 'function') drawer.close();
    });
  }

  function _drawer() {
    return document.getElementById('NamNamCart') || document.querySelector('cart-drawer');
  }
  window.NamNamCart = window.NamNamCart || {};
  window.NamNamCart.open = function () { var d = _drawer(); if (d) d.open(); };
  window.NamNamCart.close = function () { var d = _drawer(); if (d) d.close(); };
  window.NamNamCart.refresh = function () { var d = _drawer(); if (d) return d.refresh(); };
  window.NamNamCart.add = function (payload) {
    var request = payload.items
      ? fetchJSON(ROUTES.add, { method: 'POST', body: payload })
      : addCartItem(payload);
    return request.then(function () {
      prefetchCart();
      var d = _drawer();
      if (d) d.refresh();
      bounceCartIcon();
      showToast('✓ Added to Cart');
    });
  };
  window.NamNamCart.showToast = showToast;

  /* ================================================================
     Manual discount code feature
     Problem solved: _syncLatestTierDiscount() calls _replaceTierDiscountCode()
     which POSTs { discount: '' } then { discount: tierCode }, wiping any
     manually entered code. Fix: patch the drawer instance to skip tier
     sync while a manual code is active, and track codes in localStorage
     so pills survive page reloads.
  ================================================================ */

  var MANUAL_DISCOUNT_KEY = 'nn_manual_discount_v1';

  function _getStoredManualCodes() {
    try {
      var v = localStorage.getItem(MANUAL_DISCOUNT_KEY);
      return v ? JSON.parse(v) : [];
    } catch (e) { return []; }
  }

  function _saveManualCodes(codes) {
    try { localStorage.setItem(MANUAL_DISCOUNT_KEY, JSON.stringify(codes)); }
    catch (e) {}
  }

  function _addManualCode(code) {
    var upper = code.toUpperCase();
    var codes = _getStoredManualCodes();
    if (codes.indexOf(upper) === -1) codes.push(upper);
    _saveManualCodes(codes);
  }

  function _removeManualCode(code) {
    var upper = code.toUpperCase();
    _saveManualCodes(_getStoredManualCodes().filter(function (c) { return c !== upper; }));
  }

  // POST discount codes to /cart/update.js — returns full cart JSON
  function _postDiscount(codes, onSuccess, onError) {
    fetch(ROUTES.update, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ discount: codes.join(',') })
    })
      .then(function (r) { return r.json(); })
      .then(onSuccess)
      .catch(function (e) {
        console.error('[NamNamCart] discount error', e);
        if (onError) onError(e);
      });
  }

  // Update discount pills in all [data-cart-discount] wrappers.
  // Only shows codes from our manual tracking that are confirmed valid in cart.
  function _syncDiscountPillsFromCart(cart) {
    var manualCodes = _getStoredManualCodes();
    var validInCart = new Set(
      (cart.discount_codes || [])
        .filter(function (d) { return d.applicable !== false; })
        .map(function (d) { return d.code.toUpperCase(); })
    );
    // Reconcile: drop stored codes that Shopify says are no longer valid
    var confirmed = manualCodes.filter(function (c) { return validInCart.has(c); });
    if (confirmed.length !== manualCodes.length) _saveManualCodes(confirmed);

    var html = confirmed.map(function (code) {
      return '<li class="nn-discount__pill" data-discount-code="' + code + '">'
        + '<span class="nn-discount__pill-code">' + code + '</span>'
        + '<button type="button" class="nn-discount__pill-remove" data-discount-remove="' + code
        + '" aria-label="Remove ' + code + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" aria-hidden="true">'
        + '<path d="M6 6l12 12M18 6 6 18"/></svg>'
        + '</button></li>';
    }).join('');

    document.querySelectorAll('[data-cart-discount]').forEach(function (wrap) {
      var ul = wrap.querySelector('[data-discount-codes]');
      if (ul) ul.innerHTML = html;
      var det = wrap.querySelector('.nn-discount__details');
      if (det && confirmed.length > 0) det.open = true;
    });
  }

  // Patch the CartDrawer instance once it's connected:
  //   1. _syncLatestTierDiscount → skip when manual code is active (prevents overwrites)
  //   2. _applyServerCart → also update discount pills on every cart refresh
  function _patchDrawerForDiscounts(d) {
    if (!d || d._manualDiscountPatched) return;
    d._manualDiscountPatched = true;

    var origSync = d._syncLatestTierDiscount.bind(d);
    d._syncLatestTierDiscount = function () {
      if (_getStoredManualCodes().length > 0) return Promise.resolve();
      return origSync();
    };

    var origApply = d._applyServerCart.bind(d);
    d._applyServerCart = function (cart) {
      origApply(cart);
      _syncDiscountPillsFromCart(cart);
    };

    // Initialise pills from whatever cart state is already loaded
    if (d._cart) _syncDiscountPillsFromCart(d._cart);
  }

  // Attempt to patch; retry briefly since connectedCallback is async
  function _tryPatchDrawer() {
    var d = _drawer();
    if (d) {
      _patchDrawerForDiscounts(d);
    } else {
      setTimeout(function () { _patchDrawerForDiscounts(_drawer()); }, 300);
    }
  }

  // On page load: patch drawer + restore pills from localStorage
  document.addEventListener('DOMContentLoaded', function () {
    _tryPatchDrawer();
    if (_getStoredManualCodes().length > 0) {
      fetch(ROUTES.cart, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(_syncDiscountPillsFromCart)
        .catch(function () {});
    }
  });

  /* ---- Apply handler ---- */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-discount-form]');
    if (!form) return;
    e.preventDefault();
    var wrap  = form.closest('[data-cart-discount]');
    var input = form.querySelector('input[name="discount"]');
    var errEl = wrap ? wrap.querySelector('[data-discount-error]') : null;
    var btn   = form.querySelector('button[type="submit"]');
    var code  = (input ? input.value : '').trim();
    if (!code || !wrap) return;

    var existing = _getStoredManualCodes();
    if (existing.indexOf(code.toUpperCase()) !== -1) { input.value = ''; return; }
    if (errEl) errEl.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    _postDiscount(existing.concat(code), function (cart) {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }

      var invalid = (cart.discount_codes || []).some(function (d) {
        return d.code.toUpperCase() === code.toUpperCase() && d.applicable === false;
      });
      if (invalid) {
        input.value = '';
        if (errEl) {
          errEl.textContent = 'Discount code "' + code + '" isn\'t valid.';
          errEl.hidden = false;
        }
        return;
      }

      input.value = '';
      _addManualCode(code);

      if (wrap.hasAttribute('data-discount-reload')) {
        window.location.reload();
        return;
      }

      // Ensure drawer is patched (may not have been by DOMContentLoaded yet)
      _patchDrawerForDiscounts(_drawer());

      // Apply POST response directly — it has the discounted total_price.
      // Do NOT call d.refresh() here as that would trigger _syncDerivedCartState
      // → _syncLatestTierDiscount → tier code overwrites our manual code.
      var d = _drawer();
      if (d && typeof d._applyServerCart === 'function') {
        d._applyServerCart(cart);
      }
      // _applyServerCart (patched) already called _syncDiscountPillsFromCart,
      // but call again in case patch wasn't applied yet.
      _syncDiscountPillsFromCart(cart);

    }, function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
    });
  });

  /* ---- Remove handler ---- */
  document.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('[data-discount-remove]');
    if (!removeBtn) return;
    var wrap = removeBtn.closest('[data-cart-discount]');
    var code = removeBtn.getAttribute('data-discount-remove');
    _removeManualCode(code);
    var remaining = _getStoredManualCodes(); // already removed above

    _postDiscount(remaining, function (cart) {
      if (wrap && wrap.hasAttribute('data-discount-reload')) {
        window.location.reload();
        return;
      }
      var d = _drawer();
      if (d && typeof d._applyServerCart === 'function') d._applyServerCart(cart);
      _syncDiscountPillsFromCart(cart);

      // No manual codes left → let tier sync run again via a full refresh.
      // The patched _syncLatestTierDiscount will now allow it through.
      if (_getStoredManualCodes().length === 0 && d && typeof d.refresh === 'function') {
        d.refresh();
      }
    });
  });
})();
