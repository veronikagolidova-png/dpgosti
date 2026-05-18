const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Register card endpoint is working"
    });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !BOT_TOKEN ||
    !IIKO_API_LOGIN ||
    !IIKO_ORGANIZATION_ID ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const initData = cleanText(body.initData);
    const fullName = cleanText(body.fullName);
    const rawPhone = cleanText(body.phone);
    const birthday = cleanText(body.birthday);
    const source = cleanText(body.source);
    const agreement = Boolean(body.agreement);

    if (!initData) {
      return res.status(400).json({
        ok: false,
        error: "Откройте приложение внутри Telegram"
      });
    }

    const validation = validateTelegramInitData(initData, BOT_TOKEN);

    if (!validation.ok) {
      return res.status(401).json({
        ok: false,
        error: "Не удалось проверить Telegram"
      });
    }

    if (!fullName || !rawPhone || !birthday || !source) {
      return res.status(400).json({
        ok: false,
        error: "Заполните ФИО, телефон, дату рождения и откуда узнали о нас"
      });
    }

    if (!agreement) {
      return res.status(400).json({
        ok: false,
        error: "Нужно согласие на обработку персональных данных"
      });
    }

    if (!isValidBirthday(birthday)) {
      return res.status(400).json({
        ok: false,
        error: "Дата рождения должна быть в формате YYYY-MM-DD"
      });
    }

    const phone = normalizePhone(rawPhone);

    if (!phone || phone.length < 12) {
      return res.status(400).json({
        ok: false,
        error: "Проверьте номер телефона"
      });
    }

    const nameParts = splitFullName(fullName);
    const iikoBirthday = `${birthday} 00:00:00.000`;
    const cardNumber = normalizeCardNumber(phone);
    const cardTrack = cardNumber;

    const telegramUser = validation.user || {};

    const tokenResult = await getIikoToken(IIKO_API_LOGIN);

    if (!tokenResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "iiko_token",
        error: "Не удалось подключиться к iiko",
        details: tokenResult.error
      });
    }

    const token = tokenResult.token;

    let customer = null;
    let customerId = null;
    let createdCustomer = false;
    let addedCard = false;

    const checkResult = await getIikoCustomerByPhone({
      token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone
    });

    if (checkResult.ok && checkResult.customer) {
      customer = checkResult.customer;
      customerId = customer.id;
    } else if (checkResult.notFound) {
      const createResult = await createIikoCustomer({
        token,
        organizationId: IIKO_ORGANIZATION_ID,
        phone,
        fullName,
        birthday: iikoBirthday,
        source,
        nameParts
      });

      if (!createResult.ok) {
        return res.status(500).json({
          ok: false,
          step: "create_customer",
          error: "Не удалось создать гостя в iiko",
          details: createResult.error
        });
      }

      createdCustomer = true;
      customerId = createResult.data && createResult.data.id;

      if (!customerId) {
        const afterCreateResult = await getIikoCustomerByPhone({
          token,
          organizationId: IIKO_ORGANIZATION_ID,
          phone
        });

        if (afterCreateResult.ok && afterCreateResult.customer) {
          customer = afterCreateResult.customer;
          customerId = customer.id;
        }
      }
    } else {
      return res.status(500).json({
        ok: false,
        step: "check_customer",
        error: "Не удалось проверить гостя в iiko",
        details: checkResult.error
      });
    }

    if (!customerId) {
      return res.status(500).json({
        ok: false,
        error: "Не удалось получить ID гостя в iiko"
      });
    }

    const hasCard =
      customer &&
      Array.isArray(customer.cards) &&
      customer.cards.length > 0;

    if (!hasCard) {
      const addCardResult = await addIikoCard({
        token,
        organizationId: IIKO_ORGANIZATION_ID,
        customerId,
        cardNumber,
        cardTrack
      });

      if (!addCardResult.ok) {
        return res.status(500).json({
          ok: false,
          step: "add_card",
          error: "Гость создан, но карту не удалось добавить",
          details: addCardResult.error
        });
      }

      addedCard = true;
    }

    const finalResult = await getIikoCustomerByPhone({
      token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone
    });

    const finalCustomer =
      finalResult.ok && finalResult.customer
        ? finalResult.customer
        : customer;

    await saveGuestToSupabase({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      guest: {
        telegram_id: telegramUser.id || null,
        phone,
        first_name: nameParts.name || telegramUser.first_name || null,
        last_name: nameParts.surName || telegramUser.last_name || null,
        username: telegramUser.username || null,
        updated_at: new Date().toISOString()
      }
    });

    return res.status(200).json({
      ok: true,
      status: createdCustomer ? "created" : "already_exists",
      message: addedCard
        ? "Карта создана ✅"
        : "Карта уже была создана ✅",
      phone,
      customerId,
      cardNumber,
      createdCustomer,
      addedCard,
      customer: finalCustomer
    });
  } catch (error) {
    console.error("Register card error:", error);

    return res.status(500).json({
      ok: false,
      error: "Не удалось зарегистрировать карту",
      details: String(error.message || error)
    });
  }
};

function cleanText(value) {
  return String(value || "").trim();
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

function normalizeCardNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidBirthday(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return {
      surName: "",
      name: parts[0],
      middleName: ""
    };
  }

  if (parts.length === 2) {
    return {
      surName: parts[0],
      name: parts[1],
      middleName: ""
    };
  }

  return {
    surName: parts[0],
    name: parts[1],
    middleName: parts.slice(2).join(" ")
  };
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

async function getIikoToken(apiLogin) {
  const response = await fetch("https://api-ru.iiko.services/api/1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      apiLogin
    })
  });

  const data = await response.json();

  if (!response.ok || !data.token) {
    return {
      ok: false,
      error: data
    };
  }

  return {
    ok: true,
    token: data.token
  };
}

async function getIikoCustomerByPhone({ token, organizationId, phone }) {
  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/info", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: "phone",
      phone,
      organizationId
    })
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (response.ok) {
    return {
      ok: true,
      customer: data
    };
  }

  const errorText = JSON.stringify(data || "").toLowerCase();

  const notFound =
    response.status === 400 ||
    errorText.includes("not found") ||
    errorText.includes("не найден") ||
    (errorText.includes("customer") && errorText.includes("not"));

  return {
    ok: false,
    notFound,
    error: data
  };
}

async function createIikoCustomer({
  token,
  organizationId,
  phone,
  fullName,
  birthday,
  source,
  nameParts
}) {
  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/create_or_update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      organizationId,
      phone,
      name: nameParts.name,
      surName: nameParts.surName,
      middleName: nameParts.middleName,
      birthday,
      consentStatus: 1,
      shouldReceivePromoActionsInfo: false,
      shouldReceiveLoyaltyInfo: true,
      userData:
        `ФИО: ${fullName}\n` +
        `Откуда узнали о нас: ${source}\n` +
        `Источник регистрации: Telegram Mini App`
    })
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

async function addIikoCard({
  token,
  organizationId,
  customerId,
  cardNumber,
  cardTrack
}) {
  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/card/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      customerId,
      cardTrack,
      cardNumber,
      organizationId
    })
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

async function saveGuestToSupabase({ supabaseUrl, supabaseKey, guest }) {
  const cleanSupabaseUrl = String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  const url = `${cleanSupabaseUrl}/rest/v1/guests?on_conflict=phone`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(guest)
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Supabase guest save error:", text);

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
