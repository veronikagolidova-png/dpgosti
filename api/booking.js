const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Booking endpoint is working"
    });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const BOOKING_CHAT_ID = process.env.BOOKING_CHAT_ID;

  if (!BOT_TOKEN || !BOOKING_CHAT_ID) {
    return res.status(500).json({
      ok: false,
      error: "BOT_TOKEN or BOOKING_CHAT_ID is not set"
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const initData = body.initData;
    const name = cleanText(body.name);
    const phone = cleanText(body.phone);
    const date = cleanText(body.date);
    const time = cleanText(body.time);
    const guests = cleanText(body.guests);
    const comment = cleanText(body.comment);

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

    if (!name || !phone || !date || !time || !guests) {
      return res.status(400).json({
        ok: false,
        error: "Заполните имя, телефон, дату, время и количество гостей"
      });
    }

    const telegramUser = validation.user || {};
    const guestLink = getTelegramUserLink(telegramUser);

    const message =
      `🍾 Новая бронь\n\n` +
      `Имя: ${name}\n` +
      `Телефон: ${phone}\n` +
      `Дата: ${date}\n` +
      `Время: ${time}\n` +
      `Гостей: ${guests}\n` +
      `Комментарий: ${comment || "—"}\n\n` +
      `Telegram: ${telegramUser.username ? "@" + telegramUser.username : "без username"}\n` +
      `Telegram ID: ${telegramUser.id || "—"}\n\n` +
      `Источник: Mini App`;

    const inlineKeyboard = [];

    if (guestLink) {
      inlineKeyboard.push([
        {
          text: "Написать гостю",
          url: guestLink
        }
      ]);
    }

    inlineKeyboard.push([
      {
        text: "✅ Бронь передала",
        callback_data: "booking_done"
      }
    ]);

    const telegramResult = await sendTelegramMessage(
      BOT_TOKEN,
      BOOKING_CHAT_ID,
      message,
      {
        inline_keyboard: inlineKeyboard
      }
    );

    if (!telegramResult.ok) {
      console.error("Telegram send error:", telegramResult);

      return res.status(500).json({
        ok: false,
        error: "Telegram не принял сообщение",
        telegram_error: telegramResult
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Booking sent"
    });
  } catch (error) {
    console.error("Booking endpoint error:", error);

    return res.status(500).json({
      ok: false,
      error: "Booking endpoint failed",
      details: String(error.message || error)
    });
  }
};

function cleanText(value) {
  return String(value || "").trim();
}

function getTelegramUserLink(user) {
  if (user && user.username) {
    return `https://t.me/${user.username}`;
  }

  if (user && user.id) {
    return `tg://user?id=${user.id}`;
  }

  return null;
}

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

async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  return data;
}
