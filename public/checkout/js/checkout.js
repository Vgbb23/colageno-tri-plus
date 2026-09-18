/* =========================================================
   Body Action · Checkout TRI PLUS
   - Resumo dinâmico (1/2/3 unidades), cupom, frete
   - Máscaras + validação (CPF, e-mail, telefone, cartão)
   - CEP: ViaCEP com fallback BrasilAPI
   - Pix real via /api/pix/charge + consulta de status
   ========================================================= */
(function () {
  "use strict";

  /* ---------------- Config ---------------- */
  var PRODUCT = {
    sku: "colageno-tri-plus",
    name: "Colágeno TRI PLUS",
    fullName: "Colágeno TRI PLUS Body Action",
    images: {
      1: "/kit-1-unidade.jpg",
      2: "/kit-2-unidades.png",
      3: "/kit-3-unidades.png"
    }
  };
  var OFFERS = {
    1: { price: 39.90, compare: 79.80, label: "1 unidade" },
    2: { price: 59.90, compare: 139.80, label: "2 unidades" },
    3: { price: 79.90, compare: 199.80, label: "3 unidades" }
  };
  var SHIPPING = {
    free: { price: 0, label: "Envio padrão" },
    express: { price: 19.90, label: "Envio expresso" }
  };
  var COUPONS = {
    TRIPLUS10: { type: "percent", value: 10 },
    BEMVINDA: { type: "percent", value: 10 },
    FRETEGRATIS: { type: "shipping", value: 0 }
  };
  var INSTALLMENTS = { max: 3, interestFree: 2, monthlyRate: 0.0249, minValue: 10 };
  var STORAGE_KEY = "triplus:checkout";
  var LAST_ORDER_KEY = "triplus:lastOrder";
  var TRACKING_STORAGE_KEY = "triplus_url_params";
  var TRACKING_KEYS = ["src", "sck", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  /* true = cartão recusa após o loading (adquirente fora). Volte para false quando o gateway voltar. */
  var CARD_ACQUIRER_DOWN = true;
  var PIX_POLL_MS = 200;
  var pixPollTimer = null;
  var lastOrderMeta = null;

  /* ---------------- State ---------------- */
  var state = {
    qty: 3,
    shipping: "free",
    method: "pix",
    coupon: null,
    installments: 1,
    brand: null
  };

  /* ---------------- Helpers ---------------- */
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var digits = function (v) { return String(v || "").replace(/\D/g, ""); };
  var brl = function (n) {
    return "R$ " + Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };
  var round2 = function (n) { return Math.round(n * 100) / 100; };

  function setText(selector, text, ctx) {
    $$(selector, ctx).forEach(function (el) { el.textContent = text; });
  }

  /* ---------------- Totals ---------------- */
  function computeTotals() {
    var offer = OFFERS[state.qty];
    var subtotal = offer.compare;
    var offerDiscount = round2(offer.compare - offer.price);
    var shipping = SHIPPING[state.shipping].price;
    var couponValue = 0;

    if (state.coupon) {
      var c = COUPONS[state.coupon];
      if (c.type === "percent") couponValue = round2(offer.price * (c.value / 100));
      if (c.type === "fixed") couponValue = Math.min(c.value, offer.price);
      if (c.type === "shipping") { couponValue = shipping; shipping = 0; }
    }

    var total = round2(offer.price - (state.coupon && COUPONS[state.coupon].type !== "shipping" ? couponValue : 0) + shipping);
    return { offer: offer, subtotal: subtotal, offerDiscount: offerDiscount, shipping: shipping, couponValue: couponValue, total: total };
  }

  function installmentValue(total, n) {
    if (n <= INSTALLMENTS.interestFree) return round2(total / n);
    var r = INSTALLMENTS.monthlyRate;
    return round2((total * r) / (1 - Math.pow(1 + r, -n)));
  }

  function renderInstallments(total) {
    var select = $("#installments");
    if (!select) return;
    var current = Number(select.value) || state.installments || 1;
    select.innerHTML = "";
    for (var n = 1; n <= INSTALLMENTS.max; n++) {
      var each = installmentValue(total, n);
      if (n > 1 && each < INSTALLMENTS.minValue) break;
      var opt = document.createElement("option");
      opt.value = String(n);
      if (n === 1) {
        opt.textContent = "1x de " + brl(total) + " à vista";
      } else if (n <= INSTALLMENTS.interestFree) {
        opt.textContent = n + "x de " + brl(each) + " sem juros";
      } else {
        opt.textContent = n + "x de " + brl(each) + " (total " + brl(round2(each * n)) + ")";
      }
      select.appendChild(opt);
    }
    select.value = String(Math.min(current, select.options.length));
    state.installments = Number(select.value);
  }

  function renderTotals() {
    var t = computeTotals();

    setText("[data-total]", brl(t.total));
    setText("[data-subtotal]", brl(t.offer.price));
    setText("[data-compare]", brl(t.offer.compare));
    setText("[data-discount]", "-" + brl(t.offerDiscount));
    setText("[data-qty-badge]", String(state.qty));
    setText("[data-qty-label]", t.offer.label);

    var shipEl = $("[data-shipping]");
    if (shipEl) {
      shipEl.textContent = t.shipping === 0 ? "Grátis" : brl(t.shipping);
      shipEl.classList.toggle("is-free", t.shipping === 0);
    }

    var couponRow = $("[data-coupon-row]");
    if (couponRow) {
      couponRow.hidden = !state.coupon;
      if (state.coupon) {
        setText("[data-coupon-code]", state.coupon);
        setText("[data-coupon-value]", "-" + brl(t.couponValue));
      }
    }

    renderInstallments(t.total);
    renderCTA();
  }

  function renderCTA() {
    setText("[data-cta]", "Finalizar pedido");
  }

  /* ---------------- Quantity ---------------- */
  function updateProductImages(qty) {
    var src = PRODUCT.images[qty] || PRODUCT.images[1];
    $$("[data-product-img]").forEach(function (img) { img.src = src; });
  }

  function setQty(qty) {
    qty = Number(qty);
    if (qty < 1) qty = 1;
    if (qty > 3) qty = 3;
    if (!OFFERS[qty]) qty = 3;
    state.qty = qty;
    var valueEl = $("[data-qty-value]");
    if (valueEl) valueEl.textContent = String(qty);
    var minus = $("[data-qty-minus]");
    var plus = $("[data-qty-plus]");
    if (minus) minus.disabled = qty <= 1;
    if (plus) plus.disabled = qty >= 3;
    updateProductImages(qty);
    renderTotals();
    persist();
  }

  function mergeTrackingFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var stored = {};
      try { stored = JSON.parse(sessionStorage.getItem(TRACKING_STORAGE_KEY) || "{}") || {}; } catch (e) { stored = {}; }
      TRACKING_KEYS.forEach(function (key) {
        var value = params.get(key);
        if (value && value.trim()) stored[key] = value.trim();
      });
      sessionStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(stored));
      return stored;
    } catch (e) {
      return {};
    }
  }

  function getTrackingParameters() {
    var out = { src: null, sck: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null };
    var stored = mergeTrackingFromUrl();
    TRACKING_KEYS.forEach(function (key) {
      var value = stored[key];
      out[key] = value && String(value).trim() ? String(value).trim() : null;
    });
    return out;
  }

  /* ---------------- Masks ---------------- */
  var masks = {
    cpf: function (v) {
      v = digits(v).slice(0, 11);
      return v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    },
    phone: function (v) {
      v = digits(v).slice(0, 11);
      if (v.length <= 10) return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
      return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
    },
    cep: function (v) {
      v = digits(v).slice(0, 8);
      return v.replace(/(\d{5})(\d)/, "$1-$2");
    },
    card: function (v) {
      v = digits(v);
      var brand = detectBrand(v);
      if (brand === "amex") {
        v = v.slice(0, 15);
        return v.replace(/(\d{4})(\d)/, "$1 $2").replace(/(\d{6})(\d)/, "$1 $2");
      }
      if (brand === "diners") {
        v = v.slice(0, 14);
        return v.replace(/(\d{4})(\d)/, "$1 $2").replace(/(\d{6})(\d)/, "$1 $2");
      }
      v = v.slice(0, 16);
      return v.replace(/(\d{4})(?=\d)/g, "$1 ");
    },
    expiry: function (v) {
      v = digits(v).slice(0, 4);
      if (v.length >= 3) return v.slice(0, 2) + "/" + v.slice(2);
      return v;
    },
    cvv: function (v) {
      var max = state.brand === "amex" ? 4 : 3;
      return digits(v).slice(0, max);
    }
  };

  function applyMask(input) {
    var type = input.getAttribute("data-mask");
    if (!type || !masks[type]) return;
    var masked = masks[type](input.value);
    if (masked !== input.value) input.value = masked;
  }

  /* ---------------- Card brand ---------------- */
  function detectBrand(num) {
    num = digits(num);
    if (!num) return null;
    if (/^(4011(78|79)|43(1274|8935)|45(1416|7393|763(1|2))|50(4175|6699|67[0-7][0-9]|9[0-9]{3})|627780|63(6297|6368)|650(03[^4]|04[0-9]|05[01]|4[0-9]{2}|5[0-9]{2}|9[0-9]{2}|541|700|720|901)|6516(5[2-9]|[6-7][0-9])|6550([0-1][0-9]|2[1-9]|[3-4][0-9]|5[0-8]))/.test(num)) return "elo";
    if (/^(606282|3841(0|4|6)0)/.test(num)) return "hipercard";
    if (/^3[47]/.test(num)) return "amex";
    if (/^3(0[0-5]|[68])/.test(num)) return "diners";
    if (/^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/.test(num)) return "mastercard";
    if (/^4/.test(num)) return "visa";
    return null;
  }

  var BRAND_LABEL = { visa: "VISA", mastercard: "MASTER", elo: "ELO", amex: "AMEX", hipercard: "HIPER", diners: "DINERS" };
  var BRAND_LOGOS = {
    visa: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#1a1f71"/><path fill="#fff" d="M15.6 16.2 18.1 7.8h2.5l-2.5 8.4h-2.5zm11.4-8.4c-.5-.2-1.3-.4-2.3-.4-2.5 0-4.3 1.3-4.3 3.2 0 1.4 1.3 2.2 2.3 2.6 1 .5 1.4.8 1.4 1.2 0 .7-.8 1-1.6 1-.9 0-1.5-.1-2.3-.5l-.3-.1-.4 2.3c.7.3 1.9.6 3.2.6 2.7 0 4.4-1.3 4.4-3.3 0-1.1-.7-1.9-2.2-2.6-.9-.4-1.5-.8-1.5-1.2 0-.4.5-.8 1.5-.8.8 0 1.4.2 1.9.4l.2.1.4-2.2zm5.6 13.2h2.2l-1.9-8.4h-2.1c-.5 0-.9.3-1.1.7l-3.6 7.7h2.6l.5-1.4h3.1l.3 1.4zm-2.7-3.3.9-2.6.6 2.6h-1.5zM13 7.8l-4 8.4H6.4L4.4 9.3c-.1-.5-.2-.7-.6-.9C3.1 8 2.1 7.7 1.2 7.5l.1-.4h4.2c.5 0 1 .4 1.1 1l1 5.3 2.5-6.3H13z"/></svg>',
    mastercard: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#fff"/><circle cx="15" cy="12" r="7.2" fill="#eb001b"/><circle cx="23" cy="12" r="7.2" fill="#f79e1b"/><path d="M19 6.6a7.2 7.2 0 0 1 0 10.8 7.2 7.2 0 0 1 0-10.8z" fill="#ff5f00"/></svg>',
    elo: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#000"/><circle cx="13.2" cy="12" r="5.2" fill="#ffcb05"/><circle cx="19" cy="12" r="5.2" fill="#00a4e0"/><circle cx="24.8" cy="12" r="5.2" fill="#ef3e42"/></svg>',
    amex: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#2e77bb"/><path fill="#fff" d="M6.2 14.8 7.8 9.2h2.2l1.6 5.6h-1.7l-.3-1.1H8.2l-.3 1.1H6.2zm2.3-2.3h1.2l-.6-2.2-.6 2.2zM13 9.2h4.6l.4 1.5h-2.8v.8h2.6v1.4h-2.6v.8h2.9l-.4 1.1H13V9.2zm6.4 0h1.7l1.8 2.6V9.2h1.6v5.6h-1.6l-1.9-2.7v2.7h-1.6V9.2zm6.6 0h4.4v1.4h-2.7v.8h2.5v1.3h-2.5v.8h2.8v1.3h-4.5V9.2z"/></svg>',
    hipercard: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#b3131b"/><path fill="#fff" d="M10.4 7.8h2.4v3.2h3.2V7.8h2.4v8.4h-2.4v-3.4h-3.2v3.4h-2.4V7.8zm10.6 0h6.6v1.8h-4.2v1.5h3.8v1.7h-3.8v1.6h4.4v1.8h-6.8V7.8z"/></svg>',
    diners: '<svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg"><rect width="38" height="24" rx="4" fill="#0079be"/><ellipse cx="19" cy="12" rx="9.2" ry="7.2" fill="#fff"/><ellipse cx="19" cy="12" rx="6.4" ry="7.2" fill="#0079be"/><rect x="16.4" y="6.4" width="5.2" height="11.2" fill="#fff"/></svg>'
  };

  function renderBrand(num) {
    var brand = detectBrand(num);
    state.brand = brand;
    var el = $("#ck-brand");
    if (!el) return;
    if (brand && BRAND_LOGOS[brand]) {
      el.innerHTML = BRAND_LOGOS[brand];
      el.setAttribute("data-brand", brand);
      el.classList.add("is-visible");
    } else {
      el.innerHTML = "";
      el.removeAttribute("data-brand");
      el.classList.remove("is-visible");
    }
  }

  function luhn(num) {
    num = digits(num);
    if (num.length < 13) return false;
    var sum = 0, dbl = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = Number(num[i]);
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  /* ---------------- Validators ---------------- */
  function validCPF(v) {
    v = digits(v);
    if (v.length !== 11 || /^(\d)\1{10}$/.test(v)) return false;
    var calc = function (len) {
      var sum = 0;
      for (var i = 0; i < len; i++) sum += Number(v[i]) * (len + 1 - i);
      var mod = (sum * 10) % 11;
      return mod === 10 ? 0 : mod;
    };
    return calc(9) === Number(v[9]) && calc(10) === Number(v[10]);
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()); }
  function validPhone(v) { var d = digits(v); return d.length === 10 || d.length === 11; }
  function validName(v) { return String(v).trim().split(/\s+/).filter(Boolean).length >= 2; }
  function validExpiry(v) {
    var m = /^(\d{2})\/(\d{2})$/.exec(v);
    if (!m) return false;
    var month = Number(m[1]), year = 2000 + Number(m[2]);
    if (month < 1 || month > 12) return false;
    var now = new Date();
    var exp = new Date(year, month, 0, 23, 59, 59);
    return exp >= now;
  }
  function validCVV(v) { return digits(v).length === (state.brand === "amex" ? 4 : 3); }

  var RULES = {
    email: { test: validEmail, msg: "Digite um e-mail válido." },
    name: { test: validName, msg: "Digite seu nome e sobrenome." },
    cpf: { test: validCPF, msg: "CPF inválido. Confira os números." },
    phone: { test: validPhone, msg: "Digite um celular com DDD." },
    cep: { test: function (v) { return digits(v).length === 8; }, msg: "CEP deve ter 8 números." },
    street: { test: function (v) { return v.trim().length >= 3; }, msg: "Informe o endereço." },
    number: { test: function (v) { return v.trim().length >= 1; }, msg: "Informe o número (ou S/N)." },
    district: { test: function (v) { return v.trim().length >= 2; }, msg: "Informe o bairro." },
    city: { test: function (v) { return v.trim().length >= 2; }, msg: "Informe a cidade." },
    state: { test: function (v) { return v.length === 2; }, msg: "Selecione o estado." },
    "card-number": { test: function (v) { return luhn(v) && !!detectBrand(v); }, msg: "Número de cartão inválido." },
    "card-name": { test: validName, msg: "Digite o nome como está no cartão." },
    "card-expiry": { test: validExpiry, msg: "Validade inválida ou cartão vencido." },
    "card-cvv": { test: validCVV, msg: "CVV inválido." },
    "holder-cpf": { test: validCPF, msg: "CPF do titular inválido." }
  };

  function fieldWrap(input) { return input.closest(".ck-field"); }

  function validateField(input, silent) {
    var rule = RULES[input.id];
    var wrap = fieldWrap(input);
    if (!rule || !wrap) return true;
    var ok = rule.test(input.value || "");
    if (!silent) {
      wrap.classList.toggle("is-valid", ok);
      wrap.classList.toggle("is-invalid", !ok);
      var err = wrap.querySelector(".ck-error");
      if (err) err.textContent = ok ? "" : rule.msg;
    } else if (ok) {
      wrap.classList.add("is-valid");
      wrap.classList.remove("is-invalid");
    }
    return ok;
  }

  function isCardActive() { return state.method === "card"; }

  function requiredInputs(section) {
    var inputs = $$("input[required], select[required]", section);
    if (section.id === "section-payment" && isCardActive()) {
      inputs = inputs.concat($$("[data-card-required]", section));
      var holder = $("#holder-cpf");
      if (holder && !$("#same-holder").checked) inputs.push(holder);
    }
    return inputs.filter(function (el) { return !el.closest("[hidden]"); });
  }

  function sectionComplete(section) {
    var inputs = requiredInputs(section);
    if (section.id === "section-payment" && !isCardActive()) return true;
    if (!inputs.length) return false;
    return inputs.every(function (el) { return RULES[el.id] ? RULES[el.id].test(el.value || "") : !!el.value; });
  }

  function refreshProgress() {
    var order = ["contact", "shipping", "payment"];
    var activeSet = false;
    order.forEach(function (key) {
      var section = $('[data-section="' + key + '"]');
      var done = section && sectionComplete(section);
      if (key === "payment" && !isCardActive()) done = sectionComplete($("#section-shipping")) && sectionComplete($("#section-contact"));
      if (section) section.classList.toggle("is-complete", !!done);
      $$('.ck-steps__item[data-step="' + key + '"]').forEach(function (step) {
        step.classList.toggle("is-done", !!done);
        step.classList.toggle("is-active", !done && !activeSet);
      });
      if (!done && !activeSet) activeSet = true;
    });
  }

  /* ---------------- CEP lookup ---------------- */
  var cepTimer = null;
  var lastCep = "";

  function fetchJSON(url, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 6000) : null;
    return fetch(url, { signal: controller ? controller.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function lookupCEP(cep) {
    return fetchJSON("https://viacep.com.br/ws/" + cep + "/json/")
      .then(function (d) {
        if (d.erro) throw new Error("not-found");
        return { street: d.logradouro, district: d.bairro, city: d.localidade, state: d.uf };
      })
      .catch(function () {
        return fetchJSON("https://brasilapi.com.br/api/cep/v1/" + cep).then(function (d) {
          return { street: d.street, district: d.neighborhood, city: d.city, state: d.state };
        });
      });
  }

  var ETA = {
    fast: ["SP", "RJ", "MG", "ES", "PR", "SC", "RS", "DF", "GO"],
    mid: ["BA", "PE", "CE", "MT", "MS", "SE", "AL", "PB", "RN", "TO", "MA", "PI"]
  };
  function updateETA(uf) {
    var free = $('[data-eta="free"]'), express = $('[data-eta="express"]');
    var tier = ETA.fast.indexOf(uf) > -1 ? 0 : ETA.mid.indexOf(uf) > -1 ? 1 : 2;
    var freeTxt = "Chega em 7 a 9 dias úteis";
    var expTxt = ["Chega em 1 a 3 dias úteis", "Chega em 2 a 5 dias úteis", "Chega em 4 a 8 dias úteis"][tier];
    if (free) free.textContent = freeTxt;
    if (express) express.textContent = expTxt;
  }

  function revealAddress() {
    var addr = $("#ck-address"), ship = $("#ck-shipping");
    if (addr) addr.hidden = false;
    if (ship) ship.hidden = false;
  }

  function handleCEP(input, immediate) {
    var wrap = fieldWrap(input);
    var cep = digits(input.value);
    clearTimeout(cepTimer);
    if (cep.length !== 8) { wrap.classList.remove("is-loading"); return; }
    if (cep === lastCep && !immediate) return;

    cepTimer = setTimeout(function () {
      lastCep = cep;
      wrap.classList.add("is-loading");
      wrap.classList.remove("is-invalid");
      lookupCEP(cep)
        .then(function (a) {
          revealAddress();
          var fill = function (id, val) {
            var el = $("#" + id);
            if (!el) return;
            el.value = val || "";
            if (val) validateField(el, true); else { fieldWrap(el).classList.remove("is-valid"); }
          };
          fill("street", a.street); fill("district", a.district); fill("city", a.city); fill("state", a.state);
          updateETA(a.state);
          validateField(input);
          var next = !a.street ? $("#street") : $("#number");
          if (next) next.focus();
        })
        .catch(function () {
          // CEP não encontrado: libera preenchimento manual
          revealAddress();
          wrap.classList.remove("is-valid");
          wrap.classList.add("is-invalid");
          var err = wrap.querySelector(".ck-error");
          if (err) err.textContent = "CEP não encontrado. Preencha o endereço manualmente.";
          $("#street").focus();
        })
        .finally(function () {
          wrap.classList.remove("is-loading");
          refreshProgress();
          persist();
        });
    }, immediate ? 0 : 250);
  }

  /* ---------------- Payment tabs ---------------- */
  function setMethod(method) {
    state.method = method === "card" ? "card" : "pix";
    $$(".ck-paytab").forEach(function (tab) {
      var active = tab.getAttribute("data-method") === state.method;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".ck-paypanel").forEach(function (panel) {
      var active = panel.id === "panel-" + state.method;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    if (state.method === "pix") hideCardError();
    renderCTA();
    refreshProgress();
    persist();
  }

  /* ---------------- Coupon ---------------- */
  function applyCoupon() {
    var input = $("#coupon"), msg = $("#coupon-msg");
    var code = (input.value || "").trim().toUpperCase();
    if (!code) { msg.textContent = "Digite um código."; msg.className = "ck-coupon__msg is-err"; return; }
    if (!COUPONS[code]) {
      state.coupon = null;
      msg.textContent = "Cupom inválido ou expirado.";
      msg.className = "ck-coupon__msg is-err";
      renderTotals();
      return;
    }
    state.coupon = code;
    var c = COUPONS[code];
    msg.textContent = c.type === "percent" ? "Cupom aplicado: " + c.value + "% de desconto." : c.type === "shipping" ? "Cupom aplicado: frete grátis." : "Cupom aplicado.";
    msg.className = "ck-coupon__msg is-ok";
    renderTotals();
    persist();
  }

  /* ---------------- Persistence ---------------- */
  var PERSIST_FIELDS = ["email", "name", "cpf", "phone", "cep", "street", "number", "complement", "district", "city", "state", "reference"];
  function persist() {
    try {
      var data = { qty: state.qty, shipping: state.shipping, method: state.method, coupon: state.coupon, fields: {} };
      PERSIST_FIELDS.forEach(function (id) { var el = $("#" + id); if (el) data.fields[id] = el.value; });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* ---------------- Submit ---------------- */
  function collectPayload() {
    var t = computeTotals();
    var payload = {
      customer: { email: $("#email").value.trim(), name: $("#name").value.trim(), cpf: digits($("#cpf").value), phone: digits($("#phone").value) },
      address: {
        cep: digits($("#cep").value), street: $("#street").value.trim(), number: $("#number").value.trim(),
        complement: $("#complement").value.trim(), district: $("#district").value.trim(), city: $("#city").value.trim(),
        state: $("#state").value, reference: $("#reference").value.trim()
      },
      items: [{ sku: PRODUCT.sku, name: PRODUCT.fullName, quantity: state.qty, unitPrice: round2(t.offer.price / state.qty), total: t.offer.price }],
      shipping: { method: state.shipping, label: SHIPPING[state.shipping].label, price: t.shipping },
      coupon: state.coupon ? { code: state.coupon, value: t.couponValue } : null,
      payment: { method: state.method },
      totals: { subtotal: t.offer.price, discount: t.offerDiscount, shipping: t.shipping, coupon: t.couponValue, total: t.total }
    };
    if (state.method === "card") {
      payload.payment.card = {
        brand: state.brand,
        holder: $("#card-name").value.trim(),
        holderCpf: $("#same-holder").checked ? payload.customer.cpf : digits($("#holder-cpf").value),
        installments: Number($("#installments").value) || 1,
        installmentValue: installmentValue(t.total, Number($("#installments").value) || 1)
      };
    }
    return payload;
  }

  function submitOrder(payload) {
    if (payload.payment.method === "card") {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (CARD_ACQUIRER_DOWN) reject({ code: "issuer_unavailable" });
          else resolve({ orderId: String(Date.now()).slice(-6), status: "approved" });
        }, 3200);
      });
    }

    return fetch("/api/pix/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.customer.name,
        email: payload.customer.email,
        cpf: payload.customer.cpf,
        phone: payload.customer.phone,
        amount: payload.totals.total,
        quantity: payload.items[0].quantity,
        productId: PRODUCT.sku,
        productName: PRODUCT.fullName + " — " + payload.items[0].quantity + (payload.items[0].quantity === 1 ? " unidade" : " unidades"),
        trackingParameters: getTrackingParameters()
      })
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || data.success === false) {
          throw new Error(data.message || "Não foi possível gerar o Pix.");
        }
        var tx = data.transaction || {};
        return {
          orderId: tx.id,
          createdAt: tx.createdAt,
          pix: {
            copyPaste: tx.qr_code || tx.qrCode || "",
            qrImage: tx.qr_image || tx.qrImage || null,
            expiresAt: Date.now() + 30 * 60 * 1000
          },
          amount: typeof tx.amount === "number" && tx.amount > 0 ? tx.amount : payload.totals.total
        };
      }).catch(function (err) {
        if (err instanceof Error) throw err;
        throw new Error("Falha na API PIX. Tente de novo em alguns segundos.");
      });
    });
  }

  function scrollToField(el) {
    var wrap = fieldWrap(el) || el;
    var top = wrap.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 250);
    wrap.classList.add("is-shake");
    setTimeout(function () { wrap.classList.remove("is-shake"); }, 300);
  }

  function validateAll() {
    var sections = ["#section-contact", "#section-shipping", "#section-payment"];
    var firstInvalid = null;
    sections.forEach(function (sel) {
      var section = $(sel);
      requiredInputs(section).forEach(function (input) {
        var ok = validateField(input);
        if (!ok && !firstInvalid) firstInvalid = input;
      });
    });
    // Endereço ainda oculto (CEP não digitado)
    if (!firstInvalid && $("#ck-address").hidden) {
      firstInvalid = $("#cep");
      validateField(firstInvalid);
    }
    return firstInvalid;
  }

  function showLoading(text) {
    var el = $("#ck-loading");
    setText("[data-loading-text]", text || "Processando seu pedido…");
    el.hidden = false;
  }
  function hideLoading() { $("#ck-loading").hidden = true; }

  function onSubmit(event) {
    if (event) event.preventDefault();
    hideCardError();
    var invalid = validateAll();
    if (invalid) { scrollToField(invalid); return; }

    var payload = collectPayload();
    var btn = $("#ck-submit"), summaryBtn = $("#ck-summary-btn");
    if (btn) btn.disabled = true;
    if (summaryBtn) summaryBtn.disabled = true;
    showLoading(state.method === "pix" ? "Gerando seu Pix…" : "Conectando com o banco emissor…");

    submitOrder(payload)
      .then(function (res) {
        hideLoading();
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        if (state.method === "pix") showPixResult(res, payload); else showCardResult(res, payload);
      })
      .catch(function (err) {
        hideLoading();
        if (btn) btn.disabled = false;
        if (summaryBtn) summaryBtn.disabled = false;
        if (err && err.code === "issuer_unavailable") showCardIssuerError();
        else alert((err && err.message) || "Não foi possível concluir o pedido. Tente novamente.");
      });
  }

  function hideCardError() {
    var box = $("#ck-card-error");
    if (box) box.hidden = true;
  }

  function wipeCardSecrets() {
    ["card-number", "card-cvv", "card-name", "card-expiry", "holder-cpf"].forEach(function (id) {
      var el = $("#" + id);
      if (!el) return;
      el.value = "";
      var wrap = fieldWrap(el);
      if (wrap) wrap.classList.remove("is-valid", "is-invalid");
    });
    renderBrand("");
  }

  function showCardIssuerError() {
    wipeCardSecrets();
    var box = $("#ck-card-error");
    if (box) box.hidden = false;
    var section = $("#section-payment");
    if (section) {
      var top = section.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  /* ---------------- Result screens ---------------- */
  function renderOrderSummary(container, payload) {
    var t = payload.totals;
    var lines = [
      "<p><span>" + payload.items[0].name + " × " + payload.items[0].quantity + "</span><strong>" + brl(payload.items[0].total) + "</strong></p>",
      "<p><span>Frete (" + payload.shipping.label + ")</span><strong>" + (t.shipping ? brl(t.shipping) : "Grátis") + "</strong></p>"
    ];
    if (payload.coupon) lines.push("<p><span>Cupom " + payload.coupon.code + "</span><strong>-" + brl(payload.coupon.value) + "</strong></p>");
    if (payload.payment.method === "card") {
      var c = payload.payment.card;
      lines.push("<p><span>Pagamento</span><strong>" + (BRAND_LABEL[c.brand] || "Cartão") + " · " + c.installments + "x de " + brl(c.installmentValue) + "</strong></p>");
    }
    lines.push("<p><span>Entrega</span><strong>" + payload.address.street + ", " + payload.address.number + " — " + payload.address.city + "/" + payload.address.state + "</strong></p>");
    lines.push("<p class=\"is-total\"><span>Total</span><strong>" + brl(t.total) + "</strong></p>");
    container.innerHTML = lines.join("");
  }

  function hideCheckout() {
    $(".ck-main").hidden = true;
    $$(".ck-steps__item").forEach(function (s) { s.classList.add("is-done"); s.classList.remove("is-active"); });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showPixResult(res, payload) {
    hideCheckout();
    var section = $("#result-pix");
    section.hidden = false;
    if (typeof res.amount === "number" && res.amount > 0) payload.totals.total = res.amount;
    setText("[data-order-id]", "#" + res.orderId, section);
    setText("[data-total]", brl(payload.totals.total), section);
    var copy = res.pix.copyPaste || "";
    if (!copy && res.pix.qrImage && /^000201/.test(String(res.pix.qrImage).trim())) {
      copy = String(res.pix.qrImage).trim();
    }
    $("#pix-code").value = copy;
    renderOrderSummary($("[data-order-summary]", section), payload);
    renderPixQR($("#pix-qr"), res.pix);
    startTimer($("[data-timer]", section), res.pix.expiresAt);
    saveLastOrder(res, payload);
    startPixPolling(res.orderId);
  }

  function saveLastOrder(res, payload) {
    lastOrderMeta = {
      orderId: res.orderId,
      createdAt: res.createdAt,
      name: payload.customer.name,
      email: payload.customer.email,
      phone: payload.customer.phone,
      cpf: payload.customer.cpf,
      total: payload.totals.total,
      itemTotal: payload.items[0].total,
      qty: payload.items[0].quantity,
      product: payload.items[0].name,
      shipping: payload.shipping.label,
      shippingPrice: payload.totals.shipping,
      address: payload.address.street + ", " + payload.address.number + " — " + payload.address.city + "/" + payload.address.state,
      trackingParameters: getTrackingParameters()
    };
    try {
      sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(lastOrderMeta));
    } catch (e) { /* ignore */ }
  }

  function centsFromBRL(value) {
    return Math.round(Number(value) * 100);
  }

  function notifyUtmifyPaid(order) {
    if (!order || !order.orderId) return Promise.resolve();
    return fetch("/api/utmify/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.orderId,
        status: "paid",
        createdAt: order.createdAt,
        customer: {
          name: order.name,
          email: order.email,
          phone: order.phone,
          document: order.cpf
        },
        products: [{
          id: PRODUCT.sku,
          name: order.product || PRODUCT.fullName,
          planId: null,
          planName: null,
          quantity: order.qty || 1,
          priceInCents: centsFromBRL(order.total)
        }],
        trackingParameters: order.trackingParameters || getTrackingParameters(),
        totalPriceInCents: centsFromBRL(order.total),
        gatewayFeeInCents: 0,
        userCommissionInCents: centsFromBRL(order.total)
      }),
      keepalive: true
    }).catch(function () { /* não bloqueia o redirect */ });
  }

  function goToThanksPage() {
    window.location.href = "obrigado.html";
  }

  function handlePaid(order) {
    if (!order) order = lastOrderMeta;
    stopPixPolling();
    notifyUtmifyPaid(order);
    showLoading("Pagamento confirmado…");
    goToThanksPage();
  }

  function startPixPolling(transactionId) {
    stopPixPolling();
    if (!transactionId) return;
    var started = Date.now();
    var maxMs = 2 * 60 * 60 * 1000;
    var inFlight = false;
    var paidNotified = false;

    function tick() {
      if (Date.now() - started > maxMs) return;
      if (!inFlight) {
        inFlight = true;
        fetch("/api/pix/status?id=" + encodeURIComponent(transactionId))
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var status = String((j.transaction && j.transaction.status) || "").toLowerCase();
            if ((status === "paid") && !paidNotified) {
              paidNotified = true;
              handlePaid(lastOrderMeta);
              return;
            }
          })
          .catch(function () { /* próximo ciclo */ })
          .finally(function () { inFlight = false; });
      }
      if (!paidNotified) pixPollTimer = setTimeout(tick, PIX_POLL_MS);
    }

    tick();
  }

  function stopPixPolling() {
    if (pixPollTimer) {
      clearTimeout(pixPollTimer);
      pixPollTimer = null;
    }
  }

  function showCardResult(res, payload) {
    hideCheckout();
    var section = $("#result-card");
    section.hidden = false;
    setText("[data-order-id]", "#" + res.orderId, section);
    setText("[data-order-email]", payload.customer.email, section);
    renderOrderSummary($("[data-order-summary]", section), payload);
  }

  function startTimer(el, expiresAt) {
    function tick() {
      var left = Math.max(0, expiresAt - Date.now());
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      if (left > 0) setTimeout(tick, 1000); else el.textContent = "expirado";
    }
    tick();
  }

  function renderPixQR(container, pix) {
    if (!container) return;
    var image = pix && pix.qrImage ? String(pix.qrImage).trim() : "";
    var copyPaste = (pix && pix.copyPaste) || "";
    if (image && /^000201/.test(image)) {
      copyPaste = copyPaste || image;
      image = "";
    }
    if (image) {
      var src;
      if (/^(https?:|data:|\/\/)/i.test(image)) src = image;
      else if (image.indexOf("<svg") === 0 || image.indexOf("<?xml") === 0) {
        src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(image);
      } else {
        src = "data:image/png;base64," + image.replace(/^data:image\/\w+;base64,/, "");
      }
      container.innerHTML = '<img src="' + src + '" alt="QR Code Pix" width="220" height="220">';
      return;
    }
    if (!copyPaste) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(copyPaste) + '" alt="QR Code Pix" width="220" height="220">';
  }

  function copyPix() {
    var input = $("#pix-code"), btn = $("#pix-copy");
    var done = function () {
      btn.textContent = "Copiado!"; btn.classList.add("is-copied");
      setTimeout(function () { btn.textContent = "Copiar código"; btn.classList.remove("is-copied"); }, 2200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); document.execCommand("copy"); done(); });
    } else { input.select(); document.execCommand("copy"); done(); }
  }

  /* ---------------- Init ---------------- */
  function init() {
    var form = $("#ck-form");
    if (!form) return;

    mergeTrackingFromUrl();

    // Quantidade: ?qty= na URL > qty enviada pela página do produto > checkout salvo > padrão 3
    var params = new URLSearchParams(window.location.search);
    var saved = restore();
    var fromProduct = 0;
    try { fromProduct = Number(sessionStorage.getItem("triplus:qty")); sessionStorage.removeItem("triplus:qty"); } catch (e) { /* ignore */ }
    var qty = Number(params.get("qty")) || fromProduct || (saved && saved.qty) || 3;

    if (saved) {
      Object.keys(saved.fields || {}).forEach(function (id) {
        var el = $("#" + id);
        if (el && saved.fields[id]) { el.value = saved.fields[id]; validateField(el, true); }
      });
      if (saved.fields && digits(saved.fields.cep || "").length === 8) { lastCep = digits(saved.fields.cep); revealAddress(); if (saved.fields.state) updateETA(saved.fields.state); }
      if (saved.shipping && SHIPPING[saved.shipping]) {
        state.shipping = saved.shipping;
        var r = $('input[name="shipping"][value="' + saved.shipping + '"]'); if (r) r.checked = true;
      }
      if (saved.coupon && COUPONS[saved.coupon]) { state.coupon = saved.coupon; $("#coupon").value = saved.coupon; $(".ck-coupon").open = true; $("#coupon-msg").textContent = "Cupom aplicado."; $("#coupon-msg").className = "ck-coupon__msg is-ok"; }
      if (saved.method) state.method = saved.method;
    }
    setQty(qty);
    setMethod(state.method);

    var minus = $("[data-qty-minus]");
    var plus = $("[data-qty-plus]");
    if (minus) minus.addEventListener("click", function () { setQty(state.qty - 1); });
    if (plus) plus.addEventListener("click", function () { setQty(state.qty + 1); });

    // Máscaras + validação em tempo real
    $$("input[data-mask]", document).forEach(function (input) {
      input.addEventListener("input", function () {
        applyMask(input);
        if (input.id === "card-number") renderBrand(input.value);
        if (input.id === "cep") handleCEP(input);
        if (fieldWrap(input).classList.contains("is-invalid")) validateField(input);
      });
    });
    $$("input, select", form).forEach(function (el) {
      el.addEventListener("blur", function () {
        if (el.value || fieldWrap(el).classList.contains("is-invalid")) validateField(el);
        refreshProgress(); persist();
      });
      el.addEventListener("input", function () {
        var wrap = fieldWrap(el);
        if (wrap && wrap.classList.contains("is-valid") && RULES[el.id] && !RULES[el.id].test(el.value)) wrap.classList.remove("is-valid");
        refreshProgress();
      });
      el.addEventListener("change", function () { if (el.tagName === "SELECT") validateField(el); refreshProgress(); persist(); });
    });
    $("#cep").addEventListener("blur", function () { handleCEP(this, true); });
    $("#cep").addEventListener("paste", function () { var self = this; setTimeout(function () { applyMask(self); handleCEP(self, true); }, 0); });

    // Frete
    $$('input[name="shipping"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        state.shipping = radio.value;
        $$(".ck-radio-card").forEach(function (c) { c.classList.toggle("is-selected", c.contains(radio)); });
        renderTotals(); persist();
      });
    });

    // Pagamento
    $$(".ck-paytab").forEach(function (tab) {
      tab.addEventListener("click", function () { setMethod(tab.getAttribute("data-method")); });
    });
    $("#installments").addEventListener("change", function () { state.installments = Number(this.value); });
    $("#same-holder").addEventListener("change", function () {
      $("#holder-cpf-field").hidden = this.checked;
      refreshProgress();
    });
    $("#card-name").addEventListener("input", function () { this.value = this.value.toUpperCase(); });

    // Cupom
    $("#coupon-apply").addEventListener("click", applyCoupon);
    $("#coupon").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } });

    // Submit
    form.addEventListener("submit", onSubmit);
    var summaryBtn = $("#ck-summary-btn");
    if (summaryBtn) summaryBtn.addEventListener("click", onSubmit);

    var tryPix = $("#ck-try-pix");
    if (tryPix) tryPix.addEventListener("click", function () { setMethod("pix"); });

    // Pix copiar
    $("#pix-copy").addEventListener("click", copyPix);

    // Enter em campo de texto não envia sem validar (evita submit acidental)
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "submit") {
        e.preventDefault();
        var inputs = $$("input:not([hidden]), select", form).filter(function (i) { return !i.closest("[hidden]"); });
        var idx = inputs.indexOf(e.target);
        if (idx > -1 && inputs[idx + 1]) inputs[idx + 1].focus(); else onSubmit();
      }
    });

    refreshProgress();
    renderTotals();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
