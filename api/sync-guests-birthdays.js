module.exports = async function handler(req, res) {
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

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

  const key = String(req.query.key || "");
  const confirm = String(req.query.confirm || "");
  const limit = Math.min(Number(req.query.limit || 100), 300);

  if (key !== SYNC_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Wrong sync key"
    });
  }

  const dryRun = confirm !== "yes";

  try {
    const tokenResult = await getIikoToken(IIKO_API_LOGIN);

    if (!tokenResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "iiko_token",
        error: tokenResult.error
      });
    }

    const guestsResult = await getGuestsWithoutBirthday({
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
        : "Синхронизация выполнена",
      checked: guests.length,
      updated: 0,
      wouldUpdate: 0,
      skippedNoPhone: 0,
      skippedNoBirthdayInIiko: 0,
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
        await sleep(200);
        continue;
      }

      const customer = iikoCustomerResult.customer;
      const birthday = extractDate(customer.birthday);

      if (!birthday) {
        result.skippedNoBirthdayInIiko += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "no_birthday_in_iiko",
          customerName: customer.name || null,
          customerSurname: customer.surname || null
        });
        await sleep(200);
        continue;
      }

      const sourceFromUserData = extractSource(customer.userData);

      if (dryRun) {
        result.wouldUpdate += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "would_update",
          birthday,
          source: sourceFromUserData || null,
          customerName: customer.name || null,
          customerSurname: customer.surname || null
        });
        await sleep(200);
        continue;
      }

      const updateResult = await updateGuestInSupabase({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
        guestId: guest.id,
        birthday,
        source: sourceFromUserData
      });

      if (!updateResult.ok) {
        result.errors += 1;
        result.items.push({
          id: guest.id,
          phone,
          status: "update_error",
          birthday,
          error: updateResult.error
        });
        await sleep(200);
        continue;
      }

      result.updated += 1;
      result.items.push({
        id: guest.id,
        phone,
        status: "updated",
        birthday,
        source: sourceFromUserData || null,
        customerName: customer.name || null,
        customerSurname: customer.surname || null
      });

      await sleep(200);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Sync guests birthdays error:", error);

    return res.status(500).json({
      ok: false,
      error: "Sync failed",
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

async function getGuestsWithoutBirthday({ supabaseUrl, supabaseKey, limit }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${baseUrl}/rest/v1/guests` +
    `?select=id,phone,birthday,source` +
    `&phone=not.is.null` +
    `&birthday=is.null` +
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
  birthday,
  source
}) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);
  const url = `${baseUrl}/rest/v1/guests?id=eq.${encodeURIComponent(guestId)}`;

  const updateData = {
    birthday,
    updated_at: new Date().toISOString()
  };

  if (source) {
    updateData.source = source;
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
