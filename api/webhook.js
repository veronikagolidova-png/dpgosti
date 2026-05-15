module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot webhook is working");
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

  const update = req.body;

  try {
    const message = update.message;

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = (message.text || "").trim().toLowerCase();

    if (text === "/id" || text.startsWith("/id@")) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `ID этого чата:\n${chatId}`
      );

      return res.status(200).json({ ok: true });
    }

    if (message.contact) {
      const rawPhone = message.contact.phone_number;
      const phone = normalizePhone(rawPhone);

      const telegramId = message.from?.id || message.contact?.user_id || null;
      const firstName = message.from?.first_name || message.contact?.first_name || null;
      const lastName = message.from?.last_name || message.contact?.last_name || null;
      const username = message.from?.username || null;

      const guest = {
        telegram_id: telegramId,
        phone,
        first_name: firstName,
        last_name: lastName,
        username,
        updated_at: new Date().toISOString()
      };

      const saved = await saveGuestToSupabase({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        guest
      });

      if (!saved.ok) {
        console.error("Supabase save error:", saved.error);

        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `Спасибо, ${firstName || "гость"}! Номер ${phone} получили ✅\n\nНо пока не смогли сохранить его в базу. Уже проверяем.`
        );

        return res.status(200).json({ ok: true });
      }

      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `Спасибо, ${firstName || "гость"}! Номер ${phone} сохранили ✅\n\nТеперь ваша карта будет открываться автоматически.`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "/start" || text === "start") {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "Привет! Нажмите кнопку «Открыть меню» внизу, чтобы посмотреть карту гостя, меню, бронь, отзывы и соцсети.",
        {
          remove_keyboard: true
        }
      );

      return res.status(200).json({ ok: true });
    }

    await sendTelegramMessage(
      BOT_TOKEN,
      chatId,
      "Нажмите кнопку «Открыть меню» внизу, чтобы перейти в гостевой раздел."
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(200).json({
      ok: false,
      error: "Webhook handled with error"
    });
  }
};

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

async function saveGuestToSupabase({ supabaseUrl, supabaseKey, guest }) {
  const cleanSupabaseUrl = String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  const url = `${cleanSupabaseUrl}/rest/v1/guests?on_conflict=phone`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(guest)
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  return {
    ok: true,
    data: text
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

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}
