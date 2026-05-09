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

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
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

    return res.status(200).json({
      ok: true,
      guest: guestResult.guest
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

async function findGuestByTelegramId({ supabaseUrl, supabaseKey, telegramId }) {
  const cleanSupabaseUrl = String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  const url =
    `${cleanSupabaseUrl}/rest/v1/guests` +
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
