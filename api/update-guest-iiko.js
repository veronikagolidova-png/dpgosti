module.exports = async function handler(req, res) {
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

  if (!IIKO_API_LOGIN || !IIKO_ORGANIZATION_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return res.status(500).json({ ok: false, error: "Missing environment variables" });
  }

  const key = String(req.query.key || "");
  const phone = normalizePhone(req.query.phone || "");

  if (key !== SYNC_SECRET) {
    return res.status(401).json({ ok: false, error: "Wrong key" });
  }

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Phone is required" });
  }

  try {
    const guestResult = await getGuestFromSupabase({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      phone
    });

    if (!guestResult.ok || !guestResult.guest) {
      return res.status(404).json({ ok: false, error: "Guest not found in Supabase" });
    }

    const guest = guestResult.guest;

    const tokenResult = await getIikoToken(IIKO_API_LOGIN);

    if (!tokenResult.ok) {
      return res.status(500).json({ ok: false, step: "iiko_token", error: tokenResult.error });
    }

    const customerResult = await getIikoCustomerByPhone({
      token: tokenResult.token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone
    });

    if (!customerResult.ok || !customerResult.customer) {
      return res.status(404).json({ ok: false, step: "get_iiko_customer", error: "Guest not found in iiko" });
    }

    const birthday = guest.birthday
      ? `${guest.birthday} 00:00:00.000`
      : customerResult.customer.birthday || null;

    const updateResult = await updateIikoCustomer({
      token: tokenResult.token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone,
      firstName: guest.first_name || "",
      lastName: guest.last_name || "",
      middleName: guest.middle_name || "",
      birthday,
      source: guest.source || ""
    });

    if (!updateResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "update_iiko_customer",
        error: updateResult.error
      });
    }

    await updateSupabaseSyncTime({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      phone
    });

    return res.status(200).json({
      ok: true,
      message: "Guest updated in iiko",
      phone,
      first_name: guest.first_name,
      last_name: guest.last_name,
      middle_name: guest.middle_name
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Update guest failed",
      details: String(error.message || error)
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

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function getGuestFromSupabase({ supabaseUrl, supabaseKey, phone }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/guests` +
    `?select=id,phone,first_name,last_name,middle_name,birthday,source` +
    `&phone=eq.${encodeURIComponent(phone)}` +
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
  const data = text ? JSON.parse(text) : [];

  if (!response.ok) {
    return { ok: false, error: data };
  }

  return {
    ok: true,
    guest: Array.isArray(data) && data.length ? data[0] : null
  };
}

async function updateSupabaseSyncTime({ supabaseUrl, supabaseKey, phone }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${cleanUrl}/rest/v1/guests?phone=eq.${encodeURIComponent(phone)}`;

  await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      updated_at: new Date().toISOString(),
      last_iiko_sync_at: new Date().toISOString()
    })
  });
}

async function getIikoToken(apiLogin) {
  const response = await fetch("https://api-ru.iiko.services/api/1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiLogin })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || !data.token) {
    return { ok: false, error: data };
  }

  return { ok: true, token: data.token };
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
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    return { ok: false, error: data };
  }

  return { ok: true, customer: data };
}

async function updateIikoCustomer({
  token,
  organizationId,
  phone,
  firstName,
  lastName,
  middleName,
  birthday,
  source
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
      name: firstName,
      surName: lastName,
      middleName,
      birthday,
      consentStatus: 1,
      shouldReceivePromoActionsInfo: false,
      shouldReceiveLoyaltyInfo: true,
      userData:
        `Источник регистрации: Telegram Mini App\n` +
        `Откуда узнали о нас: ${source || "не указано"}\n` +
        `Обновлено из Supabase`
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
    return { ok: false, error: data };
  }

  return { ok: true, data };
}
