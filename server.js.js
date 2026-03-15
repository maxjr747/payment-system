const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const CONFIG = {
  providerBaseUrl: process.env.PROVIDER_BASE_URL || "https://bo.ggusonepay.com",
  authToken: process.env.PROVIDER_AUTH_TOKEN || "",
  brandId: process.env.BRAND_ID || "",
  clientId: process.env.CLIENT_ID || "",
  defaultClientName: process.env.CLIENT_NAME || "",
  currency: process.env.CURRENCY_CODE || "usd",
  wayCode: process.env.WAY_CODE || "ecashapp",
  googleAuth: process.env.GOOGLE_AUTH || "",
  listPageSize: Number(process.env.LIST_PAGE_SIZE || 10),
  pollAttempts: Number(process.env.POLL_ATTEMPTS || 6),
  pollDelayMs: Number(process.env.POLL_DELAY_MS || 1200),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": CONFIG.authToken,
  };
}

function validateConfig() {
  const missing = [];
  if (!CONFIG.authToken) missing.push("PROVIDER_AUTH_TOKEN");
  if (!CONFIG.brandId) missing.push("BRAND_ID");
  if (!CONFIG.clientId) missing.push("CLIENT_ID");
  if (!CONFIG.defaultClientName) missing.push("CLIENT_NAME");
  return missing;
}

async function createOrder({ amount, customerName }) {
  const payload = {
    amount: toMinorUnits(amount),
    brandId: CONFIG.brandId,
    clientId: CONFIG.clientId,
    clientName: customerName || CONFIG.defaultClientName,
    currCode: CONFIG.currency,
    googleAuth: CONFIG.googleAuth,
    wayCode: CONFIG.wayCode,
  };

  const response = await fetch(
    `${CONFIG.providerBaseUrl}/api/mgr/glo/payin/handOrder`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Create order failed with status ${response.status}.`);
  }

  if (data.code !== 200) {
    throw new Error(data.message || "Provider rejected the order.");
  }

  return {
    raw: data,
    payload,
  };
}

async function fetchLatestOrders() {
  const url =
    `${CONFIG.providerBaseUrl}/api/mgr/glo/payin/queryPage?belongType=1&pageSize=${CONFIG.listPageSize}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": CONFIG.authToken,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Order list failed with status ${response.status}.`);
  }

  if (data.code !== 200 || !data.data || !Array.isArray(data.data.records)) {
    throw new Error("Unexpected order list response format.");
  }

  return data.data.records;
}

function pickMatchingRecord(records, expectedMinorAmount) {
  // Prefer the newest matching record with a cashierUrl and matching amount.
  const candidates = records.filter((r) =>
    r &&
    Number(r.amount) === Number(expectedMinorAmount) &&
    typeof r.cashierUrl === "string" &&
    r.cashierUrl.trim() !== ""
  );

  if (candidates.length > 0) return candidates[0];

  // Fallback: newest record with any cashierUrl.
  return records.find((r) => r && typeof r.cashierUrl === "string" && r.cashierUrl.trim() !== "");
}

async function createAndResolvePaymentUrl({ amount, customerName }) {
  const minorAmount = toMinorUnits(amount);

  await createOrder({ amount, customerName });

  for (let attempt = 1; attempt <= CONFIG.pollAttempts; attempt += 1) {
    await sleep(CONFIG.pollDelayMs);

    const records = await fetchLatestOrders();
    const match = pickMatchingRecord(records, minorAmount);

    if (match && match.cashierUrl) {
      return {
        paymentUrl: match.cashierUrl,
        record: match,
        attempts: attempt,
      };
    }
  }

  throw new Error("Order was created, but no cashierUrl was found after polling.");
}

app.get("/api/health", (_req, res) => {
  const missing = validateConfig();

  res.json({
    ok: missing.length === 0,
    missing,
    providerBaseUrl: CONFIG.providerBaseUrl,
    wayCode: CONFIG.wayCode,
    currency: CONFIG.currency,
  });
});

app.post("/api/pay", async (req, res) => {
  try {
    const { amount, customerName } = req.body || {};
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Please enter a valid amount greater than 0." });
    }

    if (parsedAmount < 1 || parsedAmount > 5000) {
      return res.status(400).json({ error: "Amount must be between 1 and 5000." });
    }

    const missing = validateConfig();
    if (missing.length > 0) {
      return res.status(500).json({
        error: `Missing required server configuration: ${missing.join(", ")}`,
      });
    }

    const result = await createAndResolvePaymentUrl({
      amount: parsedAmount,
      customerName: String(customerName || "").trim(),
    });

    return res.json({
      ok: true,
      paymentUrl: result.paymentUrl,
      orderNo: result.record.orderNo || null,
      cashierUrl: result.record.cashierUrl || null,
      amount: result.record.amount || null,
      wayCode: result.record.wayCode || null,
      createdAt: result.record.createdAt || null,
      attempts: result.attempts,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unexpected server error.",
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Payment server running at http://localhost:${PORT}`);
});