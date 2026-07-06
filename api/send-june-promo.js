module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

  const MINI_APP_URL = "https://dpgosti.vercel.app";

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  const key = String(req.query.key || "");
  const confirm = String(req.query.confirm || "");
  const limit = Math.min(Number(req.query.limit || 300), 300);

  if (key !== SYNC_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Wrong key"
    });
  }

  const dryRun = confirm !== "yes";

  const message = `⚽️ Кажется, завтра весь футбольный мир будет смотреть только один матч.

6 июля в 22:00 встречаются Португалия 🇵🇹 — Испания 🇪🇸

Смотрим матч в нашем кинозале на Северной, 299А.

Большой экран, компания настоящих болельщиков, кальяны, напитки и атмосфера, когда каждый опасный момент проживает весь зал.

Если еще не решил, где смотреть футбол — ответ уже есть 😉

👇 Нажимай кнопку «Забронировать стол» и приходи.`;

  try {
    const guestsResult = await getGuests({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      limit
    });

    if (!guestsResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "get_guests",
        error: guestsResult.error
      });
    }

    const guests = guestsResult.data || [];

    const result = {
      ok: true,
      mode: dryRun ? "dry_run" : "send",
      checked: guests.length,
      wouldSend: 0,
      sent: 0,
      skippedNoTelegramId: 0,
      errors: 0,
      items: []
    };

    for (const guest of guests) {
      if (!guest.telegram_id) {
        result.skippedNoTelegramId++;
        continue;
      }

      if (dryRun) {
        result.wouldSend++;
        result.items.push({
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "would_send"
        });
        continue;
      }

      const sendResult = await sendTelegramMessage({
        token: BOT_TOKEN,
        chatId: guest.telegram_id,
        text: message,
        buttonUrl: MINI_APP_URL
      });

      if (!sendResult.ok) {
        result.errors++;
        result.items.push({
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "error",
          error: sendResult.error
        });

        await sleep(250);
        continue;
      }

      result.sent++;
      result.items.push({
        telegram_id: guest.telegram_id,
        phone: guest.phone,
        status: "sent"
      });

      await sleep(250);
    }

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error)
    });
  }
};

function cleanSupabaseUrl(url) {
  return String(url || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function getGuests({ supabaseUrl, supabaseKey, limit }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const response = await fetch(
    `${baseUrl}/rest/v1/guests?select=id,telegram_id,phone&telegram_id=not.is.null&limit=${limit}`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      error: data
    };
  }

  return {
    ok: true,
    data
  };
}

async function sendTelegramMessage({ token, chatId, text, buttonUrl }) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📍 Забронировать стол",
                web_app: {
                  url: buttonUrl
                }
              }
            ]
          ]
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data
    };
  }

  return {
    ok: true
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
