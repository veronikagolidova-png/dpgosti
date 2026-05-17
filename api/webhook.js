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
    if (update.callback_query) {
      await handleCallbackQuery(BOT_TOKEN, update.callback_query);
      return res.status(200).json({ ok: true });
    }

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
        "Привет! Это бот «Давай Покрепче» 🖤\n\nЗдесь всё самое нужное:\n— карта гостя\n— меню\n— мероприятия месяца\n— бронь стола\n— отзывы\n— соцсети\n\nНажмите кнопку «Открыть меню» внизу, чтобы перейти в гостевой раздел.",
        {
          remove_keyboard: true
        }
      );

      return res.status(200).json({ ok: true });
    }

    await sendTelegramMessage(
      BOT_TOKEN,
      chatId,
      "Это бот «Давай Покрепче» 🖤\n\nНажмите кнопку «Открыть меню» внизу, чтобы открыть карту гостя, меню, бронь, афишу, отзывы и соцсети."
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

async function handleCallbackQuery(token, callbackQuery) {
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data || "";
  const admin = callbackQuery.from || {};
  const adminName =
    admin.first_name ||
    admin.username ||
    "администратор";

  if (data === "booking_done") {
    const message = callbackQuery.message;

    if (!message) {
      await answerCallbackQuery(token, callbackId, "Не удалось обновить бронь");
      return;
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;

    const oldKeyboard = message.reply_markup?.inline_keyboard || [];

    const newKeyboard = oldKeyboard.map((row) => {
      return row.map((button) => {
        if (button.callback_data === "booking_done") {
          return {
            text: `✅ Передала: ${adminName}`,
            callback_data: "booking_done_already"
          };
        }

        return button;
      });
    });

    await editTelegramMessageReplyMarkup(token, chatId, messageId, {
      inline_keyboard: newKeyboard
    });

    await answerCallbackQuery(
      token,
      callbackId,
      "Отметили: бронь передана ✅"
    );

    return;
  }

  if (data === "booking_done_already") {
    await answerCallbackQuery(
      token,
      callbackId,
      "Эта бронь уже отмечена ✅"
    );

    return;
  }

  await answerCallbackQuery(token, callbackId, "Команда получена");
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

async function answerCallbackQuery(token, callbackQueryId, text) {
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    })
  });
}

async function editTelegramMessageReplyMarkup(token, chatId, messageId, replyMarkup) {
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    })
  });
}
