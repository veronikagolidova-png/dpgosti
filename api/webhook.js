export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot webhook is working");
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;

  if (!BOT_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "BOT_TOKEN is not set"
    });
  }

  const update = req.body;

  try {
    const message = update.message;

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;

    if (message.contact) {
      const phone = message.contact.phone_number;
      const firstName = message.from?.first_name || "гость";
      const telegramId = message.from?.id;

      console.log("Новый контакт:", {
        phone,
        firstName,
        telegramId
      });

      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `Спасибо, ${firstName}! Номер ${phone} получили ✅\n\nСледующий шаг — подключим базу гостей и будем искать вашу карту лояльности.`
      );

      return res.status(200).json({ ok: true });
    }

    if (message.text === "/start") {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "Добро пожаловать! Нажмите кнопку «Моя бонусная карта», чтобы открыть карту лояльности."
      );
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(200).json({
      ok: false,
      error: "Webhook handled with error"
    });
  }
}

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}
