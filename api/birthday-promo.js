module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;
  const CRON_SECRET = process.env.CRON_SECRET;

  const TIME_ZONE = "Europe/Moscow";
  const DAYS_BEFORE_BIRTHDAY = 3;

  const BIRTHDAY_PROMO_CODE =
    process.env.BIRTHDAY_PROMO_CODE || "ДЕНЬРОЖДЕНИЯ15";

  const BIRTHDAY_BOOKING_URL =
    process.env.BIRTHDAY_BOOKING_URL || "";

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  const queryKey = String(req.query.key || "");
  const confirm = String(req.query.confirm || "");
  const force = String(req.query.force || "") === "yes";
  const limit = Math.min(Number(req.query.limit || 300), 300);

  const authHeader = req.headers.authorization || "";

  const isManualAuthorized = queryKey === SYNC_SECRET;
  const isCronAuthorized =
    Boolean(CRON_SECRET) && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isManualAuthorized && !isCronAuthorized) {
    return res.status(401).json({
      ok: false,
      error: "Wrong key"
    });
  }

  const dryRun = isCronAuthorized ? false : confirm !== "yes";

  const nowLocal = getLocalDateParts(new Date(), TIME_ZONE);

  if (!force && (nowLocal.hour < 11 || nowLocal.hour >= 13)) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "outside_time_window",
      message: "Рассылка работает только с 11:00 до 13:00 по Москве/Краснодару",
      localHour: nowLocal.hour,
      mode: dryRun ? "dry_run" : "update"
    });
  }

  const targetDate = getTargetLocalDate({
    timeZone: TIME_ZONE,
    daysAhead: DAYS_BEFORE_BIRTHDAY
  });

  try {
    const guestsResult = await getGuestsWithBirthdays({
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
      mode: dryRun ? "dry_run" : "update",
      targetBirthdayInDays: DAYS_BEFORE_BIRTHDAY,
      targetMonth: targetDate.month,
      targetDay: targetDate.day,
      targetYear: targetDate.year,
      checked: guests.length,
      matchedBirthday: 0,
      alreadySentThisYear: 0,
      sent: 0,
      wouldSend: 0,
      skippedNoTelegramId: 0,
      errors: 0,
      items: []
    };

    for (const guest of guests) {
      const birthdayParts = parseBirthday(guest.birthday);

      if (!birthdayParts) {
        continue;
      }

      const isTargetBirthday =
        birthdayParts.month === targetDate.month &&
        birthdayParts.day === targetDate.day;

      if (!isTargetBirthday) {
        continue;
      }

      result.matchedBirthday += 1;

      if (!guest.telegram_id) {
        result.skippedNoTelegramId += 1;
        result.items.push({
          id: guest.id,
          phone: guest.phone,
          status: "skipped_no_telegram_id"
        });
        continue;
      }

      if (Number(guest.birthday_promo_sent_year) === Number(targetDate.year)) {
        result.alreadySentThisYear += 1;
        result.items.push({
          id: guest.id,
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "already_sent_this_year"
        });
        continue;
      }

      const text = buildBirthdayMessage({
        promoCode: BIRTHDAY_PROMO_CODE
      });

      if (dryRun) {
        result.wouldSend += 1;
        result.items.push({
          id: guest.id,
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          birthday: guest.birthday,
          status: "would_send"
        });
        continue;
      }

      const sendResult = await sendTelegramMessage({
        token: BOT_TOKEN,
        chatId: guest.telegram_id,
        text,
        bookingUrl: BIRTHDAY_BOOKING_URL
      });

      if (!sendResult.ok) {
        result.errors += 1;

        await updateBirthdayPromoError({
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
          guestId: guest.id,
          error: sendResult.error
        });

        result.items.push({
          id: guest.id,
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "send_error",
          error: sendResult.error
        });

        await sleep(250);
        continue;
      }

      await markBirthdayPromoSent({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        guestId: guest.id,
        year: targetDate.year
      });

      result.sent += 1;

      result.items.push({
        id: guest.id,
        telegram_id: guest.telegram_id,
        phone: guest.phone,
        birthday: guest.birthday,
        status: "sent"
      });

      await sleep(250);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Birthday promo error:", error);

    return res.status(500).json({
      ok: false,
      error: "Birthday promo failed",
      details: String(error.message || error)
    });
  }
};

function buildBirthdayMessage({ promoCode }) {
  return (
    "С днем рождения!\n\n" +
    "Пусть этот год станет самым насыщенным и ярким! А так же, хотим сказать спасибо, что ты являешься нашим гостем и другом!\n\n" +
    "Мы подготовили для тебя варианты как отметить день рождения:\n\n" +
    "• Ты можешь собрать своих друзей в нашем кинозале на Северной 299А (вместимость до 20 человек).\n" +
    "• Отпраздновать в нашей вип-комнате на 40 Лет Победы 148/2 или Северной 299А (вместимость до 10 человек).\n\n" +
    "Кстати, на 40 Лет Победы 148/2 у нас есть своя кухня.\n" +
    "А если выбираешь Северную 299А — мы можем сделать доставку с кухни 40 Лет Победы 148/2 прямо к вам.\n\n" +
    "А чтобы все прошло как надо, мы дарим тебе скидку -15%!\n\n" +
    `Промокод: ${promoCode}\n\n` +
    "Ну что, празднуем у нас?\n" +
    "Напиши, сколько вас будет человек — забронируем идеальный стол под твою компанию. 🔥"
  );
}

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

function parseBirthday(value) {
  if (!value) return null;

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function getLocalDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour)
  };
}

function getTargetLocalDate({ timeZone, daysAhead }) {
  const today = getLocalDateParts(new Date(), timeZone);

  const targetNoonUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day + daysAhead, 12, 0, 0)
  );

  return getLocalDateParts(targetNoonUtc, timeZone);
}

async function getGuestsWithBirthdays({ supabaseUrl, supabaseKey, limit }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${baseUrl}/rest/v1/guests` +
    `?select=id,telegram_id,phone,birthday,birthday_promo_sent_year` +
    `&birthday=not.is.null` +
    `&telegram_id=not.is.null` +
    `&limit=${limit}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

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

async function sendTelegramMessage({ token, chatId, text, bookingUrl }) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = {
    chat_id: chatId,
    text
  };

  if (bookingUrl) {
    body.reply_markup = {
      inline_keyboard: [
        [
          {
            text: "Забронировать день рождения",
            url: bookingUrl
          }
        ]
      ]
    };
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
    data
  };
}

async function markBirthdayPromoSent({
  supabaseUrl,
  supabaseKey,
  guestId,
  year
}) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${baseUrl}/rest/v1/guests?id=eq.${encodeURIComponent(guestId)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      birthday_promo_sent_year: year,
      birthday_promo_sent_at: new Date().toISOString(),
      birthday_promo_last_error: null,
      updated_at: new Date().toISOString()
    })
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Birthday promo sent mark error:", text);
  }
}

async function updateBirthdayPromoError({
  supabaseUrl,
  supabaseKey,
  guestId,
  error
}) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${baseUrl}/rest/v1/guests?id=eq.${encodeURIComponent(guestId)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      birthday_promo_last_error: JSON.stringify(error),
      updated_at: new Date().toISOString()
    })
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Birthday promo error save failed:", text);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
