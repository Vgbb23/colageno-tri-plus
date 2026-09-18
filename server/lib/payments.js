export function readEnv(name) {
  const raw = process.env[name];
  if (raw == null) return "";
  return String(raw).trim().replace(/^["']|["']$/g, "");
}

export function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function utcNowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function getFruitfyBase() {
  return (readEnv("FRUITFY_API_BASE_URL") || "https://api.fruitfy.io").replace(
    /\/$/,
    ""
  );
}

export function toCents(reais) {
  return Math.round(Number(reais) * 100);
}

export function fromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

export function toFruitfyPhone(phone) {
  let d = onlyDigits(phone);
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function mapFruitfyStatus(raw) {
  const status = String(raw || "")
    .trim()
    .toLowerCase();
  if (status === "paid") return "PAID";
  if (status === "waiting_payment" || status === "pending") return "PENDING";
  if (!status) return "PENDING";
  return status.toUpperCase();
}

function fruitfyAuthHeaders() {
  const token = readEnv("FRUITFY_API_TOKEN");
  const storeId = readEnv("FRUITFY_STORE_ID");
  if (!token) {
    throw new Error("FRUITFY_API_TOKEN ausente. Configure no .env.local.");
  }
  if (!storeId) {
    throw new Error("FRUITFY_STORE_ID ausente. Configure no .env.local.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Store-Id": storeId,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "pt_BR",
  };
}

async function fruitfyRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${getFruitfyBase()}${path}`, {
    method,
    headers: fruitfyAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text?.slice(0, 400) || "Resposta inválida da Fruitfy." };
  }
  return { ok: response.ok, status: response.status, data };
}

export async function fruitfyCharge(payload) {
  // OpenAPI: POST /api/pix/charge. O exemplo da intro omite /api.
  let result = await fruitfyRequest("/api/pix/charge", {
    method: "POST",
    body: payload,
  });
  if (result.status === 404) {
    result = await fruitfyRequest("/pix/charge", {
      method: "POST",
      body: payload,
    });
  }
  return result;
}

export async function fruitfyGetOrder(orderId) {
  const id = encodeURIComponent(String(orderId || "").trim());
  let result = await fruitfyRequest(`/api/order/${id}`);
  if (result.status === 404) {
    result = await fruitfyRequest(`/order/${id}`);
  }
  return result;
}

const EMV_RE = /000201[\x21-\x7E]{20,}/;

function extractEmv(value) {
  if (typeof value !== "string") return "";
  const s = value.trim().replace(/^\uFEFF/, "");
  if (!s) return "";
  const match = s.match(EMV_RE);
  if (match) return match[0];
  if (/br\.gov\.bcb\.pix/i.test(s) && s.length > 30) return s;
  return "";
}

function isEmv(value) {
  return Boolean(extractEmv(value));
}

function isQrImage(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || isEmv(s)) return false;
  if (s.startsWith("data:image") || s.startsWith("<svg") || s.startsWith("<?xml")) {
    return true;
  }
  if (s.startsWith("iVBOR") || s.startsWith("/9j/") || s.startsWith("R0lGOD")) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, "").length > 200) return true;
  return false;
}

function idKeyScore(key) {
  const k = String(key || "").toLowerCase();
  if (k === "order_uuid" || k === "orderuuid") return 100;
  if (k === "uuid") return 90;
  if (k === "order_id" || k === "orderid") return 80;
  if (k === "id") return 50;
  if (k === "short_id" || k === "shortid") return 40;
  return 0;
}

function copyHint(key) {
  return /(copy.?paste|copia|br.?code|emv|pix.?code|payload|qr.?code|qrcode|pix_copy|pixcode|copy_and_paste)/i.test(
    String(key || "")
  );
}

function imageHint(key) {
  return /(encoded.?image|qr.?image|base64|qrcode|qr.?code|qr.?url|image)/i.test(
    String(key || "")
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asCopyPaste(value) {
  if (typeof value !== "string") return "";
  const emv = extractEmv(value);
  if (emv) return emv;
  const s = value.trim();
  if (s.length > 50 && !isQrImage(s) && !/^[0-9a-f-]{36}$/i.test(s)) return s;
  return "";
}

function asQrImage(value) {
  if (typeof value !== "string") return "";
  const s = value.trim();
  if (!s || extractEmv(s)) return "";
  return isQrImage(s) ? s : "";
}

function classifyPixString(key, raw, acc) {
  if (typeof raw !== "string") return;
  const asText = raw.trim();
  if (!asText) return;

  if (/^[\{\[]/.test(asText)) {
    try {
      const parsed = JSON.parse(asText);
      if (parsed && typeof parsed === "object") {
        walkPix(parsed, key, 0, false, acc);
        return;
      }
    } catch {
      /* texto normal */
    }
  }

  const emv = extractEmv(asText);
  if (emv) {
    acc.qrCode = acc.qrCode || emv;
    return;
  }

  if (isQrImage(asText) || (imageHint(key) && asText.length > 80 && !copyHint(key))) {
    acc.qrImage = acc.qrImage || asText;
    return;
  }

  if (!acc.qrCode && asText.length > 40 && copyHint(key)) {
    acc.qrCode = asText;
  }
}

function walkPix(node, key, depth, skipId, acc) {
  if (node == null || depth > 12) return;

  const nextSkip =
    skipId ||
    /^(store|owner|product|main_product|customer|webhook|delivery|items)$/i.test(
      String(key || "")
    );

  if (node && typeof node === "object" && node.type === "Buffer" && Array.isArray(node.data)) {
    classifyPixString(key, Buffer.from(node.data).toString("utf8"), acc);
    return;
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    if (!nextSkip) {
      const score = idKeyScore(key);
      if (score) {
        let value = "";
        if (typeof node === "string") value = node.trim();
        else if (typeof node === "number" && Number.isFinite(node)) value = String(node);
        if (value && value.length <= 128 && score >= acc.idScore && !(score === acc.idScore && acc.id)) {
          acc.id = value;
          acc.idScore = score;
        }
      }
    }
    if (typeof node === "string") classifyPixString(key, node, acc);
    if (key && /status/i.test(key) && !acc.status && typeof node === "string") {
      acc.status = node;
    }
    if (key && /(paid_at|paidAt)/i.test(key) && !acc.paidAt) {
      acc.paidAt = String(node);
    }
    if (
      key &&
      /(total_gross_amount|total_net_amount|total_paid_amount|^amount$)/i.test(key) &&
      acc.amountCents == null
    ) {
      const n = Number(node);
      if (Number.isFinite(n) && n >= 100) acc.amountCents = Math.round(n);
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => walkPix(item, key, depth + 1, nextSkip, acc));
    return;
  }

  if (typeof node === "object") {
    for (const [childKey, child] of Object.entries(node)) {
      walkPix(child, childKey, depth + 1, nextSkip, acc);
    }
  }
}

function collectPixFields(data) {
  const acc = {
    id: "",
    idScore: 0,
    qrCode: "",
    qrImage: "",
    status: "",
    amountCents: null,
    paidAt: null,
  };

  const root = data && typeof data === "object" ? data : {};
  const nested =
    (root.data && typeof root.data === "object" && !Array.isArray(root.data) && root.data) ||
    (root.order && typeof root.order === "object" && root.order) ||
    (root.transaction && typeof root.transaction === "object" && root.transaction) ||
    root;
  const pix =
    (nested.pix && typeof nested.pix === "object" && nested.pix) ||
    (nested.payment && typeof nested.payment === "object" && nested.payment) ||
    (nested.qr && typeof nested.qr === "object" && nested.qr) ||
    (nested.payment_data && typeof nested.payment_data === "object" && nested.payment_data) ||
    nested;

  const namedCode = firstString(
    asCopyPaste(pix.qrcode),
    asCopyPaste(pix.qr_code),
    asCopyPaste(pix.qrCode),
    asCopyPaste(pix.copy_paste),
    asCopyPaste(pix.copyPaste),
    asCopyPaste(pix.copy_and_paste),
    asCopyPaste(pix.copia_e_cola),
    asCopyPaste(pix.copiaECola),
    asCopyPaste(pix.pix_copy_paste),
    asCopyPaste(pix.brcode),
    asCopyPaste(pix.brCode),
    asCopyPaste(pix.emv),
    asCopyPaste(pix.payload),
    asCopyPaste(pix.qr_code_text),
    asCopyPaste(pix.code),
    asCopyPaste(nested.qrcode),
    asCopyPaste(nested.qr_code),
    asCopyPaste(nested.copy_paste),
    asCopyPaste(nested.copy_and_paste),
    asCopyPaste(nested.pix_copy_paste),
    asCopyPaste(nested.brcode)
  );
  const namedImage = firstString(
    asQrImage(pix.qrcode_base64),
    asQrImage(pix.qr_code_base64),
    asQrImage(pix.qrCodeBase64),
    asQrImage(pix.encoded_image),
    asQrImage(pix.encodedImage),
    asQrImage(pix.qr_image),
    asQrImage(pix.qrImage),
    asQrImage(pix.qr_code_image),
    asQrImage(pix.image),
    asQrImage(pix.qrcode),
    asQrImage(nested.qrcode_base64),
    asQrImage(nested.qr_code_base64),
    asQrImage(nested.qr_image),
    asQrImage(nested.qrcode)
  );
  const namedId = firstString(
    nested.order_uuid,
    pix.order_uuid,
    nested.uuid,
    nested.order_id,
    nested.id,
    root.order_uuid,
    root.uuid
  );

  if (namedId) {
    acc.id = namedId;
    acc.idScore = 100;
  }
  if (namedCode) acc.qrCode = namedCode;
  if (namedImage) acc.qrImage = namedImage;

  walkPix(data, "", 0, false, acc);

  if (acc.qrImage && extractEmv(acc.qrImage) && !acc.qrCode) {
    acc.qrCode = extractEmv(acc.qrImage);
    acc.qrImage = "";
  }

  return acc;
}

export function summarizeFruitfyKeys(data, depth = 0) {
  if (data == null || depth > 4) return data == null ? String(data) : typeof data;
  if (typeof data !== "object") {
    if (typeof data === "string") {
      const preview = data.slice(0, 24).replace(/\s+/g, " ");
      return `string(${data.length}:${preview})`;
    }
    return typeof data;
  }
  if (Array.isArray(data)) {
    return data.slice(0, 3).map((item) => summarizeFruitfyKeys(item, depth + 1));
  }
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = summarizeFruitfyKeys(value, depth + 1);
  }
  return out;
}

export function extractFruitfyCharge(data) {
  const found = collectPixFields(data);
  return {
    id: found.id,
    qrCode: found.qrCode,
    qrImage: found.qrImage || null,
    status: mapFruitfyStatus(found.status),
    amountCents: found.amountCents,
  };
}

export function extractFruitfyOrder(data) {
  const found = collectPixFields(data);
  return {
    id: found.id,
    status: mapFruitfyStatus(found.status),
    amountCents: found.amountCents,
    paidAt: found.paidAt,
    qrCode: found.qrCode,
    qrImage: found.qrImage || null,
  };
}

function pickTracking(raw) {
  const keys = [
    "src",
    "sck",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];
  const out = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const key of keys) {
    const v = source[key];
    out[key] = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return out;
}

export function getClientIp(req) {
  const headers = req?.headers || {};
  const raw =
    headers["x-forwarded-for"] ||
    headers["x-real-ip"] ||
    headers["client-ip"] ||
    req?.ip ||
    "";
  const first = String(raw).split(",")[0].trim();
  if (!first || first === "unknown") return "0.0.0.0";
  return first;
}

export async function sendUtmifyOrder(payload) {
  const token = readEnv("UTMIFY_API_TOKEN");
  if (!token) {
    return { skipped: true, reason: "missing_token" };
  }

  const customer = {
    name: String(payload.customer?.name || ""),
    email: String(payload.customer?.email || ""),
    phone: payload.customer?.phone
      ? String(payload.customer.phone).replace(/\D/g, "")
      : null,
    document: payload.customer?.document
      ? String(payload.customer.document).replace(/\D/g, "")
      : null,
    country: "BR",
    ip:
      typeof payload.customer?.ip === "string" && payload.customer.ip.trim()
        ? payload.customer.ip.trim()
        : "0.0.0.0",
  };

  const body = {
    orderId: String(payload.orderId),
    platform: payload.platform || "Fruitfy",
    paymentMethod: "pix",
    status: payload.status,
    createdAt: payload.createdAt || utcNowSql(),
    approvedDate:
      payload.status === "paid" ? payload.approvedDate || utcNowSql() : null,
    refundedAt: null,
    customer,
    products:
      Array.isArray(payload.products) && payload.products.length
        ? payload.products
        : [
            {
              id: payload.productId || "colageno-tri-plus",
              name: payload.productName || "Colágeno TRI PLUS Body Action",
              planId: null,
              planName: null,
              quantity: Number(payload.quantity || 1),
              priceInCents: Math.round(Number(payload.priceInCents || 0)),
            },
          ],
    trackingParameters: pickTracking(payload.trackingParameters),
    commission: {
      totalPriceInCents: Math.round(Number(payload.totalPriceInCents || 0)),
      gatewayFeeInCents: Math.round(Number(payload.gatewayFeeInCents || 0)),
      userCommissionInCents: Math.round(
        Number(
          payload.userCommissionInCents != null
            ? payload.userCommissionInCents
            : payload.totalPriceInCents || 0
        )
      ),
    },
  };

  try {
    const response = await fetch(
      "https://api.utmify.com.br/api-credentials/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": token,
        },
        body: JSON.stringify(body),
      }
    );
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text?.slice(0, 300) };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
