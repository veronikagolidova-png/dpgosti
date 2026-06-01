module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot webhook is working");
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.BOOKING_CHAT_ID;

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  const update = req.body;

  try {
    if (update.callback_query) {
      await handleCallbackQuery({
        token: BOT_TOKEN,
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        callbackQuery: update.callback_query
      });

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

    if (text === "/start" || text === "start") {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "Привет! Это бот «Давай Покрепче» 🖤\n\nЗдесь всё самое нужное:\n— карта гостя\n— меню\n— мероприятия месяца\n— бронь стола\n— отзывы\n— соцсети\n\nА еще у нас скоро будет 🦆 челлендж с уточками.\n\nНажмите кнопку «Открыть меню» внизу, чтобы перейти в гостевой раздел.",
        {
          remove_keyboard: true
        }
      );

      return res.status(200).json({ ok: true });
    }

    if (
      text === "🦆 челлендж с уточками" ||
      text === "челлендж с уточками" ||
      text === "/ducks"
    ) {
      await sendDuckChallengeInfo(BOT_TOKEN, chatId);
      return res.status(200).json({ ok: true });
    }

    if (
      text === "🦆 я нашёл уточку" ||
      text === "я нашел уточку" ||
      text === "я нашёл уточку"
    ) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "Класс! 🦆\n\nТеперь отправь сюда фото уточки прямо на том месте, где ты её нашёл.\n\nВажно: на фото должно быть видно и уточку, и место находки. После этого админ проверит фото и засчитает балл."
      );

      return res.status(200).json({ ok: true });
    }

    if (
      text === "🏆 рейтинг" ||
      text === "рейтинг" ||
      text === "/duck_rating"
    ) {
      await sendDuckRating({
        token: BOT_TOKEN,
        chatId,
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY
      });

      return res.status(200).json({ ok: true });
    }

    if (message.photo && message.photo.length) {
      await handleDuckPhoto({
        token: BOT_TOKEN,
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        adminChatId: ADMIN_CHAT_ID,
        message
      });

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

    await sendTelegramMessage(
      BOT_TOKEN,
      chatId,
      "Это бот «Давай Покрепче» 🖤\n\nНажмите кнопку «Открыть меню» внизу, чтобы открыть карту гостя, меню, бронь, афишу, отзывы и соцсети.\n\nА если участвуете в челлендже — напишите:\n🦆 Челлендж с уточками"
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

async function handleCallbackQuery({
  token,
  supabaseUrl,
  supabaseKey,
  callbackQuery
}) {
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

  if (data.startsWith("duck_approve:")) {
    const submissionId = data.replace("duck_approve:", "").trim();

    await approveDuckSubmission({
      token,
      supabaseUrl,
      supabaseKey,
      callbackQuery,
      submissionId,
      adminName
    });

    return;
  }

  if (data.startsWith("duck_reject:")) {
    const submissionId = data.replace("duck_reject:", "").trim();

    await rejectDuckSubmission({
      token,
      supabaseUrl,
      supabaseKey,
      callbackQuery,
      submissionId,
      adminName
    });

    return;
  }

  if (data === "duck_already_checked") {
    await answerCallbackQuery(
      token,
      callbackId,
      "Эта уточка уже проверена"
    );

    return;
  }

  await answerCallbackQuery(token, callbackId, "Команда получена");
}

async function sendDuckChallengeInfo(token, chatId) {
  const text =
    "🦆 Челлендж с уточками\n\n" +
    "5 числа мы спрячем 50 уточек в заведении.\n\n" +
    "Как участвовать:\n" +
    "1. Найди уточку.\n" +
    "2. Сфотографируй её прямо на месте.\n" +
    "3. Отправь фото сюда в бот.\n" +
    "4. Админ проверит фото и засчитает балл.\n\n" +
    "Кто найдёт больше всех уточек — получит сертификат на 5000 ₽ 🔥";

  await sendTelegramMessage(token, chatId, text, {
    inline_keyboard: [
      [
        {
          text: "🦆 Я нашёл уточку",
          callback_data: "duck_already_checked"
        }
      ]
    ]
  });

  await sendTelegramMessage(
    token,
    chatId,
    "Чтобы отправить уточку — просто пришли фото сюда в чат.\n\nА чтобы посмотреть рейтинг, напиши: рейтинг"
  );
}

async function handleDuckPhoto({
  token,
  supabaseUrl,
  supabaseKey,
  adminChatId,
  message
}) {
  if (!adminChatId) {
    await sendTelegramMessage(
      token,
      message.chat.id,
      "Фото получили, но не настроена группа админов для проверки. Напишите администратору."
    );
    return;
  }

  const from = message.from || {};
  const photos = message.photo || [];
  const bestPhoto = photos[photos.length - 1];

  const telegramId = from.id;
  const username = from.username || null;
  const firstName = from.first_name || null;
  const lastName = from.last_name || null;
  const caption = message.caption || "";

  const guestResult = await getGuestByTelegramId({
    supabaseUrl,
    supabaseKey,
    telegramId
  });

  const phone = guestResult.ok && guestResult.guest
    ? guestResult.guest.phone || null
    : null;

  const created = await createDuckSubmission({
    supabaseUrl,
    supabaseKey,
    data: {
      telegram_id: telegramId,
      username,
      first_name: firstName,
      last_name: lastName,
      phone,
      photo_file_id: bestPhoto.file_id,
      photo_unique_id: bestPhoto.file_unique_id || null,
      caption
    }
  });

  if (!created.ok || !created.submission) {
    console.error("Duck submission create error:", created.error);

    await sendTelegramMessage(
      token,
      message.chat.id,
      "Не смогли сохранить фото уточки 😔\nПопробуй отправить ещё раз."
    );

    return;
  }

  const submission = created.submission;

  const displayName = [
    firstName,
    lastName
  ].filter(Boolean).join(" ") || username || `ID ${telegramId}`;

  const adminCaption =
    "🦆 Новая уточка на проверку\n\n" +
    `Гость: ${displayName}\n` +
    `Telegram ID: ${telegramId}\n` +
    `Телефон: ${phone || "не указан"}\n` +
    `Заявка: ${submission.id}\n\n` +
    "Проверьте фото. Если видно уточку и место находки — засчитываем.";

  const adminPhoto = await sendTelegramPhoto({
    token,
    chatId: adminChatId,
    photo: bestPhoto.file_id,
    caption: adminCaption,
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: "✅ Засчитать",
            callback_data: `duck_approve:${submission.id}`
          },
          {
            text: "❌ Не засчитывать",
            callback_data: `duck_reject:${submission.id}`
          }
        ]
      ]
    }
  });

  if (adminPhoto.ok && adminPhoto.result) {
    await updateDuckSubmissionAdminMessage({
      supabaseUrl,
      supabaseKey,
      submissionId: submission.id,
      adminChatId,
      adminMessageId: adminPhoto.result.message_id
    });
  }

  await sendTelegramMessage(
    token,
    message.chat.id,
    "Фото уточки получили 🦆\n\nСейчас админ проверит его. Если всё ок — уточка попадёт в твой счёт и рейтинг."
  );
}

async function approveDuckSubmission({
  token,
  supabaseUrl,
  supabaseKey,
  callbackQuery,
  submissionId,
  adminName
}) {
  const callbackId = callbackQuery.id;
  const admin = callbackQuery.from || {};
  const message = callbackQuery.message;

  const submissionResult = await getDuckSubmission({
    supabaseUrl,
    supabaseKey,
    submissionId
  });

  if (!submissionResult.ok || !submissionResult.submission) {
    await answerCallbackQuery(token, callbackId, "Заявка не найдена");
    return;
  }

  const submission = submissionResult.submission;

  if (submission.status !== "pending") {
    await answerCallbackQuery(token, callbackId, "Уже проверено");
    return;
  }

  const updated = await updateDuckSubmissionStatus({
    supabaseUrl,
    supabaseKey,
    submissionId,
    status: "approved",
    adminTelegramId: admin.id,
    adminName
  });

  if (!updated.ok) {
    await answerCallbackQuery(token, callbackId, "Ошибка сохранения");
    return;
  }

  const countResult = await countApprovedDucks({
    supabaseUrl,
    supabaseKey,
    telegramId: submission.telegram_id
  });

  const total = countResult.ok ? countResult.count : "?";

  await sendTelegramMessage(
    token,
    submission.telegram_id,
    `Уточка засчитана 🦆🔥\n\nСейчас у тебя: ${total} уточек.\n\nПродолжай искать — главный приз сертификат на 5000 ₽.`
  );

  if (message) {
    await editTelegramMessageReplyMarkup(
      token,
      message.chat.id,
      message.message_id,
      {
        inline_keyboard: [
          [
            {
              text: `✅ Засчитано: ${adminName}`,
              callback_data: "duck_already_checked"
            }
          ]
        ]
      }
    );
  }

  await answerCallbackQuery(token, callbackId, "Уточка засчитана ✅");
}

async function rejectDuckSubmission({
  token,
  supabaseUrl,
  supabaseKey,
  callbackQuery,
  submissionId,
  adminName
}) {
  const callbackId = callbackQuery.id;
  const admin = callbackQuery.from || {};
  const message = callbackQuery.message;

  const submissionResult = await getDuckSubmission({
    supabaseUrl,
    supabaseKey,
    submissionId
  });

  if (!submissionResult.ok || !submissionResult.submission) {
    await answerCallbackQuery(token, callbackId, "Заявка не найдена");
    return;
  }

  const submission = submissionResult.submission;

  if (submission.status !== "pending") {
    await answerCallbackQuery(token, callbackId, "Уже проверено");
    return;
  }

  const updated = await updateDuckSubmissionStatus({
    supabaseUrl,
    supabaseKey,
    submissionId,
    status: "rejected",
    adminTelegramId: admin.id,
    adminName
  });

  if (!updated.ok) {
    await answerCallbackQuery(token, callbackId, "Ошибка сохранения");
    return;
  }

  await sendTelegramMessage(
    token,
    submission.telegram_id,
    "Эту уточку не засчитали 😔\n\nПопробуй отправить фото, где хорошо видно уточку и место, где ты её нашёл."
  );

  if (message) {
    await editTelegramMessageReplyMarkup(
      token,
      message.chat.id,
      message.message_id,
      {
        inline_keyboard: [
          [
            {
              text: `❌ Отклонено: ${adminName}`,
              callback_data: "duck_already_checked"
            }
          ]
        ]
      }
    );
  }

  await answerCallbackQuery(token, callbackId, "Фото отклонено");
}

async function sendDuckRating({
  token,
  chatId,
  supabaseUrl,
  supabaseKey
}) {
  const result = await getDuckRating({
    supabaseUrl,
    supabaseKey
  });

  if (!result.ok) {
    await sendTelegramMessage(
      token,
      chatId,
      "Рейтинг пока не загрузился 😔 Попробуйте чуть позже."
    );
    return;
  }

  const rating = result.rating || [];

  if (!rating.length) {
    await sendTelegramMessage(
      token,
      chatId,
      "Пока в рейтинге пусто 🦆\n\nСтань первым, кто найдёт уточку!"
    );
    return;
  }

  const lines = rating.slice(0, 10).map((row, index) => {
    const place = index + 1;
    const name = row.display_name || `Гость ${row.telegram_id}`;
    return `${place}. ${name} — ${row.ducks_count} уточек`;
  });

  await sendTelegramMessage(
    token,
    chatId,
    "🏆 Рейтинг охоты на уточек\n\n" + lines.join("\n")
  );
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

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function saveGuestToSupabase({ supabaseUrl, supabaseKey, guest }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${cleanUrl}/rest/v1/guests?on_conflict=phone`;

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

async function getGuestByTelegramId({ supabaseUrl, supabaseKey, telegramId }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/guests` +
    `?select=id,phone,first_name,last_name,username` +
    `&telegram_id=eq.${encodeURIComponent(telegramId)}` +
    `&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  return {
    ok: true,
    guest: Array.isArray(data) && data.length ? data[0] : null
  };
}

async function createDuckSubmission({ supabaseUrl, supabaseKey, data }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${cleanUrl}/rest/v1/duck_challenge_submissions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(data)
  });

  const text = await response.text();
  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    parsed = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  return {
    ok: true,
    submission: Array.isArray(parsed) && parsed.length ? parsed[0] : null
  };
}

async function getDuckSubmission({ supabaseUrl, supabaseKey, submissionId }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/duck_challenge_submissions` +
    `?select=*` +
    `&id=eq.${encodeURIComponent(submissionId)}` +
    `&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  return {
    ok: true,
    submission: Array.isArray(data) && data.length ? data[0] : null
  };
}

async function updateDuckSubmissionAdminMessage({
  supabaseUrl,
  supabaseKey,
  submissionId,
  adminChatId,
  adminMessageId
}) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${cleanUrl}/rest/v1/duck_challenge_submissions?id=eq.${encodeURIComponent(submissionId)}`;

  await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      admin_message_chat_id: Number(adminChatId),
      admin_message_id: Number(adminMessageId)
    })
  });
}

async function updateDuckSubmissionStatus({
  supabaseUrl,
  supabaseKey,
  submissionId,
  status,
  adminTelegramId,
  adminName
}) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${cleanUrl}/rest/v1/duck_challenge_submissions?id=eq.${encodeURIComponent(submissionId)}`;

  const now = new Date().toISOString();

  const body = {
    status
  };

  if (status === "approved") {
    body.approved_at = now;
    body.approved_by_telegram_id = adminTelegramId || null;
    body.approved_by_name = adminName || null;
  }

  if (status === "rejected") {
    body.rejected_at = now;
    body.rejected_by_telegram_id = adminTelegramId || null;
    body.rejected_by_name = adminName || null;
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  return {
    ok: true
  };
}

async function countApprovedDucks({
  supabaseUrl,
  supabaseKey,
  telegramId
}) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/duck_challenge_submissions` +
    `?select=id` +
    `&telegram_id=eq.${encodeURIComponent(telegramId)}` +
    `&status=eq.approved`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "count=exact"
    }
  });

  if (!response.ok) {
    return {
      ok: false,
      count: 0
    };
  }

  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);

  return {
    ok: true,
    count: match ? Number(match[1]) : 0
  };
}

async function getDuckRating({ supabaseUrl, supabaseKey }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/duck_challenge_submissions` +
    `?select=telegram_id,first_name,last_name,username,status` +
    `&status=eq.approved`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  const map = new Map();

  for (const row of data || []) {
    const key = String(row.telegram_id);

    if (!map.has(key)) {
      const displayName =
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.username ||
        `Гость ${row.telegram_id}`;

      map.set(key, {
        telegram_id: row.telegram_id,
        display_name: displayName,
        ducks_count: 0
      });
    }

    map.get(key).ducks_count += 1;
  }

  const rating = Array.from(map.values())
    .sort((a, b) => b.ducks_count - a.ducks_count);

  return {
    ok: true,
    rating
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

async function sendTelegramPhoto({
  token,
  chatId,
  photo,
  caption,
  replyMarkup = null
}) {
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;

  const body = {
    chat_id: chatId,
    photo,
    caption
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

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.ok !== true) {
    return {
      ok: false,
      error: data || `Telegram error ${response.status}`
    };
  }

  return {
    ok: true,
    result: data.result
  };
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
