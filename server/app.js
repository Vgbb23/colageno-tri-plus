import express from "express";
import {
  readEnv,
  onlyDigits,
  utcNowSql,
  fruitfyCharge,
  fruitfyGetOrder,
  extractFruitfyCharge,
  extractFruitfyOrder,
  summarizeFruitfyKeys,
  sendUtmifyOrder,
  getClientIp,
  toCents,
  fromCents,
  toFruitfyPhone,
  mapFruitfyStatus,
} from "./lib/payments.js";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function buildUtm(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const keys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];
  const utm = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) utm[key] = value.trim();
  }
  return utm;
}

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tri-plus-payments",
    env: {
      fruitfyToken: Boolean(readEnv("FRUITFY_API_TOKEN")),
      fruitfyStore: Boolean(readEnv("FRUITFY_STORE_ID")),
      fruitfyProduct: Boolean(readEnv("FRUITFY_PRODUCT_ID")),
      utmifyToken: Boolean(readEnv("UTMIFY_API_TOKEN")),
    },
  });
});

router.post("/pix/charge", async (req, res) => {
  try {
    const {
      name,
      email,
      cpf,
      phone,
      amount,
      quantity,
      productName,
      trackingParameters,
    } = req.body || {};

    if (!name || !email || !cpf || !phone || amount == null) {
      return res.status(400).json({
        success: false,
        message: "Campos obrigatórios: name, email, cpf, phone, amount.",
      });
    }

    if (!readEnv("FRUITFY_API_TOKEN") || !readEnv("FRUITFY_STORE_ID")) {
      return res.status(500).json({
        success: false,
        message:
          "Credenciais Fruitfy ausentes (FRUITFY_API_TOKEN / FRUITFY_STORE_ID). Configure no .env.local.",
      });
    }

    const fruitfyProductId = readEnv("FRUITFY_PRODUCT_ID");
    if (!fruitfyProductId) {
      return res.status(500).json({
        success: false,
        message:
          "FRUITFY_PRODUCT_ID ausente. Informe o UUID do produto no painel Fruitfy.",
      });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(422).json({
        success: false,
        message: "Valor inválido. Envie amount em reais (ex.: 79.90).",
      });
    }

    const phoneDigits = toFruitfyPhone(phone);
    if (phoneDigits.length < 12) {
      return res.status(422).json({
        success: false,
        message: "Telefone inválido.",
      });
    }

    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits.length !== 11) {
      return res.status(422).json({
        success: false,
        message: "CPF inválido.",
      });
    }

    const totalPriceInCents = toCents(parsedAmount);
    const qty = Number(quantity) > 0 ? Number(quantity) : 1;
    const utm = buildUtm(trackingParameters);

    const fruitfyPayload = {
      name: String(name).trim(),
      email: String(email).trim(),
      phone: phoneDigits,
      cpf: cpfDigits,
      amount: totalPriceInCents,
      items: [
        {
          id: fruitfyProductId,
          value: totalPriceInCents,
          quantity: 1,
        },
      ],
    };
    if (Object.keys(utm).length) fruitfyPayload.utm = utm;

    const { ok, status, data } = await fruitfyCharge(fruitfyPayload);

    if (!ok || data?.success === false) {
      const message =
        (typeof data?.message === "string" && data.message) ||
        (typeof data?.error === "string" && data.error) ||
        "Erro ao criar cobrança PIX na Fruitfy.";
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        success: false,
        message,
        details: data,
      });
    }

    let tx = extractFruitfyCharge(data);

    if (tx.id && !tx.qrCode && !tx.qrImage) {
      const extra = await fruitfyGetOrder(tx.id);
      if (extra.ok) {
        const fromOrder = extractFruitfyCharge(extra.data);
        tx = {
          id: fromOrder.id || tx.id,
          qrCode: fromOrder.qrCode || tx.qrCode,
          qrImage: fromOrder.qrImage || tx.qrImage,
          status: fromOrder.status || tx.status,
          amountCents: fromOrder.amountCents ?? tx.amountCents,
        };
      }
    }

    if (!tx.qrCode && !tx.qrImage) {
      const shape = summarizeFruitfyKeys(data);
      console.error("Fruitfy PIX sem QR/copia-e-cola:", JSON.stringify(shape));
      return res.status(502).json({
        success: false,
        message: "A Fruitfy não retornou o código PIX.",
        details: shape,
      });
    }
    if (!tx.id) {
      return res.status(502).json({
        success: false,
        message: "A Fruitfy não retornou o ID do pedido.",
        details: data,
      });
    }

    const createdAt = utcNowSql();
    const amountReais =
      tx.amountCents != null && tx.amountCents > 0
        ? fromCents(tx.amountCents)
        : parsedAmount;

    let utmifyResult = { skipped: true };
    try {
      utmifyResult = await sendUtmifyOrder({
        orderId: tx.id,
        status: "waiting_payment",
        createdAt,
        customer: {
          name: String(name).trim(),
          email: String(email).trim(),
          phone: onlyDigits(phone),
          document: cpfDigits,
          ip: getClientIp(req),
        },
        products: [
          {
            id: fruitfyProductId,
            name: productName || "Colágeno TRI PLUS Body Action",
            planId: null,
            planName: null,
            quantity: qty,
            priceInCents: totalPriceInCents,
          },
        ],
        trackingParameters,
        totalPriceInCents,
        gatewayFeeInCents: 0,
        userCommissionInCents: totalPriceInCents,
      });
    } catch (error) {
      utmifyResult = {
        ok: false,
        skipped: false,
        error: error instanceof Error ? error.message : "utmify_error",
      };
    }

    return res.status(201).json({
      success: true,
      message: "Cobrança PIX gerada com sucesso.",
      transaction: {
        id: tx.id,
        status: tx.status || "PENDING",
        amount: amountReais,
        qr_code: tx.qrCode,
        qr_image: tx.qrImage || null,
        createdAt,
      },
      utmify: {
        sent: Boolean(utmifyResult.ok),
        skipped: Boolean(utmifyResult.skipped),
        error: utmifyResult.ok
          ? null
          : utmifyResult.data || utmifyResult.error || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Erro interno ao gerar PIX.",
    });
  }
});

router.get("/pix/status", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id || id.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Informe o id da transação (?id=...).",
      });
    }

    const { ok, status, data } = await fruitfyGetOrder(id);

    if (!ok || data?.success === false) {
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        success: false,
        message:
          data?.message ||
          data?.error ||
          "Erro ao consultar status na Fruitfy.",
        details: data,
      });
    }

    const order = extractFruitfyOrder(data);
    const amountReais =
      order.amountCents != null ? fromCents(order.amountCents) : null;

    return res.json({
      success: true,
      transaction: {
        id: order.id || id,
        status: mapFruitfyStatus(order.status) || "PENDING",
        amount: amountReais,
        paidAt: order.paidAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Erro interno ao consultar PIX.",
    });
  }
});

router.post("/utmify/order", async (req, res) => {
  try {
    const body = req.body || {};
    const status = String(body.status || "").toLowerCase();
    if (status !== "waiting_payment" && status !== "paid") {
      return res.status(400).json({
        success: false,
        message:
          'status deve ser "waiting_payment" (PIX gerado) ou "paid" (PIX pago).',
      });
    }

    if (!body.orderId || !body.customer?.name || !body.customer?.email) {
      return res.status(400).json({
        success: false,
        message: "Campos obrigatórios: orderId, customer.name, customer.email.",
      });
    }

    if (!readEnv("UTMIFY_API_TOKEN")) {
      return res.status(503).json({
        success: false,
        message: "UTMIFY_API_TOKEN não configurada.",
      });
    }

    const totalPriceInCents = Math.round(Number(body.totalPriceInCents || 0));
    if (!Number.isFinite(totalPriceInCents) || totalPriceInCents <= 0) {
      return res.status(422).json({
        success: false,
        message: "totalPriceInCents inválido.",
      });
    }

    const result = await sendUtmifyOrder({
      ...body,
      status,
      customer: {
        ...body.customer,
        ip: body.customer?.ip || getClientIp(req),
      },
      totalPriceInCents,
      userCommissionInCents:
        body.userCommissionInCents != null
          ? body.userCommissionInCents
          : totalPriceInCents,
      gatewayFeeInCents: body.gatewayFeeInCents || 0,
    });

    if (result.skipped) {
      return res.status(503).json({
        success: false,
        message: "UTMIFY_API_TOKEN ausente em runtime.",
      });
    }

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        message: "Falha ao enviar pedido para a Utmify.",
        details: result.data || result.error,
      });
    }

    return res.json({
      success: true,
      message:
        status === "paid"
          ? "PIX pago enviado à Utmify."
          : "PIX gerado enviado à Utmify.",
      utmify: result.data || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Erro interno Utmify.",
    });
  }
});

// Na Vercel a função recebe a URL original (/api/...); no servidor local o
// prefixo também é /api. Montar nas duas raízes cobre os dois casos.
app.use("/api", router);
app.use("/", router);

export default app;
