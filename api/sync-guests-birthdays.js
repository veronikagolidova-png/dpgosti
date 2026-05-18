module.exports = async function handler(req, res) {
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;
  const CRON_SECRET = process.env.CRON_SECRET;

  if (
    !IIKO_API_LOGIN ||
    !IIKO_ORGANIZATION_ID ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !SYNC_SECRET
  ) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  const queryKey = String(req.query.key || "");
  const confirm = String(req.query.confirm || "");
  const limit = Math.min(Number(req.query.limit || 300), 300);
  const authHeader = req.headers.authorization || "";

  const isManualAuthorized = queryKey === SYNC_SECRET;
  const isCronAuthorized =
    CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isManualAuthorized && !isCronAuthorized) {
    return res.status(401).json({
      ok: false,
      error: "Wrong sync key"
    });
  }

  const dryRun = isCronAuthorized ? false : confirm !== "yes";

  try {
    const tokenResult = await getIikoToken(IIKO_API_LOGIN);

    if (!tokenResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "iiko_token",
        error: tokenResult.error
      });
    }

    const guestsResult = await getGuestsFromSupabase({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      limit
    });

    if (!guestsResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "supabase_guests",
        error: guestsResult.error
      });
    }

    const guests = guestsResult.data || [];

    const result = {
      ok: true,
      mode: dryRun ? "dry_run" : "update",
      message: dryRun
        ? "Проверка без записи. Чтобы записать данные, добавьте &confirm=yes"
        : "Синхронизация с iiko выполнена",
      checked: guests.length,
      updated: 0,
      wouldUpdate: 0,
      skippedNoPhone: 0,
      notFoundInIiko: 0,
      errors: 0,
      items: []
    };

    for (const guest of guests) {
      const phone = normalizePhone(guest.phone);

      if (!phone) {
        result.skippedNoPhone += 1;
        result.items.push({
          id: guest.id,
          phone: guest.phone,
          status: "skipped_no_phone"
        });
        continue;
      }

      const iikoCustomerResult = await getIikoCustomerByPhone({
        token: tokenResult.token,
        organizationId: IIKO_ORGANIZATION_ID,
        phone
      });

      if (!iikoCustomerResult.ok || !iikoCustomerResult.customer) {
        result.notFoundInIiko += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "not_found_in_iiko",
          error: iikoCustomerResult.error || null
        });

        await sleep(180);
        continue;
      }

      const customer = iikoCustomerResult.customer;

      const iikoCustomerId = cleanText(customer.id);
      const iikoFirstName = cleanText(customer.name);
      const iikoLastName = cleanText(customer.surname || customer.surName);
      const iikoMiddleName = cleanText(customer.middleName);

      const iikoFullName = buildFullName({
        lastName: iikoLastName,
        firstName: iikoFirstName,
        middleName: iikoMiddleName
      });

      const birthday = extractDate(customer.birthday);
      const sourceFromUserData = extractSource(customer.userData);
      const bonusBalance = extractBonusBalance(customer);
      const iikoCardNumber = extractCardNumber(customer, phone);

      const syncData = {
        iiko_customer_id: iikoCustomerId || null,
        iiko_first_name: iikoFirstName || null,
        iiko_last_name: iikoLastName || null,
        iiko_middle_name: iikoMiddleName || null,
        iiko_full_name: iikoFullName || null,
        iiko_card_number: iikoCardNumber || null,
        bonus_balance: bonusBalance,
        birthday: birthday || null,
        source: sourceFromUserData || null,
        last_iiko_sync_at: new Date().toISOString()
      };

      if (dryRun) {
        result.wouldUpdate += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "would_update",
          ...syncData
        });

        await sleep(180);
        continue;
      }

      const updateResult = await updateGuestInSupabase({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        guestId: guest.id,
        syncData
      });

      if (!updateResult.ok) {
        result.errors += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "update_error",
          error: updateResult.error
        });

        await sleep(180);
        continue;
      }

      result.updated += 1;
      result.items.push({
        id: guest.id,
        phone,
        status: "updated",
        ...syncData
      });

      await sleep(180);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Sync guests iiko error:", error);

    return res.status(500).json({
      ok: false,
      error: "Sync failed",
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

function extractDate(value) {
  if (!value) return "";

  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : "";
}

function extractSource(userData) {
  if (!userData) return "";

  const text = String(userData);
  const match = text.match(/Откуда узнали о нас:\s*(.+)/i);

  if (!match) return "";

  return String(match[1] || "")
    .split("\n")[0]
    .trim();
}

function buildFullName({ lastName, firstName, middleName }) {
  return [lastName, firstName, middleName]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");
}

function extractBonusBalance(customer) {
  const walletBalances = Array.isArray(customer.walletBalances)
    ? customer.walletBalances
    : [];

  if (!walletBalances.length) {
    return 0;
  }

  const total = walletBalances.reduce((sum, wallet) => {
    return sum + Number(wallet.balance || 0);
  }, 0);

  return Math.round(total);
}

function extractCardNumber(customer, phone) {
  const cards = Array.isArray(customer.cards) ? customer.cards : [];

  if (cards.length) {
    const card = cards[0];

    const possibleCardNumber =
      card.cardNumber ||
      card.number ||
      card.track ||
      card.cardTrack ||
      card.value ||
      "";

    if (possibleCardNumber) {
      return normalizeCardNumber(possibleCardNumber);
    }
  }

  const possibleCustomerCardNumber =
    customer.cardNumber ||
    customer.cardTrack ||
    customer.iikoCardNumber ||
    "";

  if (possibleCustomerCardNumber) {
    return normalizeCardNumber(possibleCustomerCardNumber);
  }

  // У нас карта создавалась по номеру телефона.
  // Если iiko не возвращает номер карты отдельным полем, сохраняем номер без плюса.
  return normalizeCardNumber(phone);
}

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
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

  return {
    ok: false,
    error: data
  };
}

async function getGuestsFromSupabase({ supabaseUrl, supabaseKey, limit }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${baseUrl}/rest/v1/guests` +
    `?select=id,phone,birthday,source,iiko_customer_id,iiko_full_name,bonus_balance,iiko_card_number` +
    `&phone=not.is.null` +
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

async function updateGuestInSupabase({
  supabaseUrl,
  supabaseKey,
  guestId,
  syncData
}) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${baseUrl}/rest/v1/guests?id=eq.${encodeURIComponent(guestId)}`;

  const updateData = {
    bonus_balance: Number(syncData.bonus_balance || 0),
    last_iiko_sync_at: syncData.last_iiko_sync_at,
    updated_at: new Date().toISOString()
  };

  if (syncData.iiko_customer_id) {
    updateData.iiko_customer_id = syncData.iiko_customer_id;
  }

  if (syncData.iiko_first_name) {
    updateData.iiko_first_name = syncData.iiko_first_name;
  }

  if (syncData.iiko_last_name) {
    updateData.iiko_last_name = syncData.iiko_last_name;
  }

  if (syncData.iiko_middle_name) {
    updateData.iiko_middle_name = syncData.iiko_middle_name;
  }

  if (syncData.iiko_full_name) {
    updateData.iiko_full_name = syncData.iiko_full_name;
  }

  if (syncData.iiko_card_number) {
    updateData.iiko_card_number = syncData.iiko_card_number;
  }

  if (syncData.birthday) {
    updateData.birthday = syncData.birthday;
  }

  if (syncData.source) {
    updateData.source = syncData.source;
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(updateData)
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
