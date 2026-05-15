const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Guest endpoint is working"
    });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing required environment variables"
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const initData = body && body.initData;

    if (!initData) {
      return res.status(400).json({
        ok: false,
        error: "initData is required"
      });
    }

    const validation = validateTelegramInitData(initData, BOT_TOKEN);

    if (!validation.ok) {
      return res.status(401).json({
        ok: false,
        error: "Invalid Telegram initData"
      });
    }

    const telegramUser = validation.user;

    if (!telegramUser || !telegramUser.id) {
      return res.status(400).json({
        ok: false,
        error: "Telegram user not found"
      });
    }

    const guestResult = await findGuestByTelegramId({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      telegramId: telegramUser.id
    });

    if (!guestResult.ok) {
      return res.status(500).json({
        ok: false,
        error: "Supabase error",
        details: guestResult.error
      });
    }

    if (!guestResult.guest) {
      return res.status(200).json({
        ok: false,
        reason: "guest_not_found",
        telegram_user: {
          id: telegramUser.id,
          first_name: telegramUser.first_name || null,
          last_name: telegramUser.last_name || null,
          username: telegramUser.username || null
        }
      });
    }

    let guest = guestResult.guest;

    if (IIKO_API_LOGIN && IIKO_ORGANIZATION_ID && guest.phone) {
      const iikoResult = await getIikoCustomerByPhone({
        apiLogin: IIKO_API_LOGIN,
        organizationId: IIKO_ORGANIZATION_ID,
        phone: guest.phone
      });

      if (iikoResult.ok) {
        const updatedGuest = {
          ...guest,
          iiko_customer_id: iikoResult.customer.id || guest.iiko_customer_id,
          bonus_balance: iikoResult.totalBalance,
          updated_at: new Date().toISOString()
        };

        const saveResult = await updateGuestInSupabase({
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
          phone: guest.phone,
          guest: updatedGuest
        });

        if (saveResult.ok && saveResult.guest) {
          guest = saveResult.guest;
        } else {
          guest = updatedGuest;
        }
      } else {
        console.error("iiko sync error:", iikoResult.error);
      }
    }

    return res.status(200).json({
      ok: true,
      guest
    });
  } catch (error) {
    console.error("Guest endpoint error:", error);

    return res.status(500).json({
      ok: false,
      error: "Guest endpoint failed"
    });
  }
};

function validateTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return {
      ok: false,
      error: "Hash not found"
    };
  }

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "hex");
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");

  if (
    hashBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)
  ) {
    return {
      ok: false,
      error: "Hash mismatch"
    };
  }

  const userRaw = params.get("user");
  const user = userRaw ? JSON.parse(userRaw) : null;

  return {
    ok: true,
    user
  };
}

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function findGuestByTelegramId({ supabaseUrl, supabaseKey, telegramId }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${baseUrl}/rest/v1/guests` +
    `?telegram_id=eq.${telegramId}` +
    `&select=id,telegram_id,phone,first_name,last_name,username,iiko_customer_id,iiko_card_number,bonus_balance,updated_at` +
    `&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  const data = text ? JSON.parse(text) : [];

  return {
    ok: true,
    guest: data[0] || null
  };
}

async function updateGuestInSupabase({ supabaseUrl, supabaseKey, phone, guest }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url = `${baseUrl}/rest/v1/guests?phone=eq.${encodeURIComponent(phone)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      iiko_customer_id: guest.iiko_customer_id || null,
      bonus_balance: guest.bonus_balance || 0,
      updated_at: guest.updated_at
    })
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  const data = text ? JSON.parse(text) : [];

  return {
    ok: true,
    guest: data[0] || null
  };
}

async function getIikoCustomerByPhone({ apiLogin, organizationId, phone }) {
  const tokenResponse = await fetch("https://api-ru.iiko.services/api/1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      apiLogin
    })
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.token) {
    return {
      ok: false,
      error: {
        step: "access_token",
        data: tokenData
      }
    };
  }

  const token = tokenData.token;
  const normalizedPhone = normalizePhone(phone);

  const customerResponse = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/info", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: "phone",
      phone: normalizedPhone,
      organizationId
    })
  });

  const customerData = await customerResponse.json();

  if (!customerResponse.ok) {
    return {
      ok: false,
      error: {
        step: "customer_info",
        phone: normalizedPhone,
        data: customerData
      }
    };
  }

  const walletBalances = customerData.walletBalances || [];

  const totalBalance = walletBalances.reduce((sum, wallet) => {
    return sum + Number(wallet.balance || 0);
  }, 0);

  return {
    ok: true,
    customer: customerData,
    walletBalances,
    totalBalance
  };
}

function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }

  if (digits.length === 10) {
    digits = "7" + digits;
  }

  return digits ? `+${digits}` : "";
}
