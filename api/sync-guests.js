module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;
  const SYNC_SECRET = process.env.SYNC_SECRET;

  const key = String(req.query.key || "");
  const limit = Math.min(Number(req.query.limit || 1000), 1000);

  if (key !== SYNC_SECRET) {
    return res.status(401).json({ ok: false, error: "Wrong key" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IIKO_API_LOGIN || !IIKO_ORGANIZATION_ID) {
    return res.status(500).json({ ok: false, error: "Missing environment variables" });
  }

  try {
    const token = await getIikoToken(IIKO_API_LOGIN);

    const guests = await getSupabaseGuests({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
      limit
    });

    const result = {
      ok: true,
      checked: guests.length,
      updated: 0,
      skippedNoPhone: 0,
      notFoundInIiko: 0,
      errors: 0,
      items: []
    };

    for (const guest of guests) {
      if (!guest.phone) {
        result.skippedNoPhone++;
        continue;
      }

      try {
        const iiko = await getIikoCustomerByPhone({
          token,
          organizationId: IIKO_ORGANIZATION_ID,
          phone: guest.phone
        });

        if (!iiko.ok) {
          result.notFoundInIiko++;
          result.items.push({
            phone: guest.phone,
            status: "not_found_in_iiko",
            error: iiko.error
          });
          await sleep(250);
          continue;
        }

        const customer = iiko.customer;

        const payload = {
          iiko_customer_id: customer.id || guest.iiko_customer_id || null,
          bonus_balance: iiko.totalBalance || 0,
          iiko_first_name: customer.name || null,
          iiko_last_name: customer.surname || null,
          iiko_middle_name: customer.middleName || null,
          first_name: customer.name || guest.first_name || null,
          last_name: customer.surname || guest.last_name || null,
          middle_name: customer.middleName || guest.middle_name || null,
          birthday: customer.birthday || guest.birthday || null,
          iiko_sync_error: null,
          needs_iiko_sync: false,
          updated_at: new Date().toISOString()
        };

        await updateGuest({
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
          phone: guest.phone,
          payload
        });

        result.updated++;
        result.items.push({
          phone: guest.phone,
          status: "updated",
          iiko_customer_id: customer.id || null,
          balance: iiko.totalBalance
        });

        await sleep(250);
      } catch (error) {
        result.errors++;
        result.items.push({
          phone: guest.phone,
          status: "error",
          error: String(error.message || error)
        });
        await sleep(250);
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error.message || error)
    });
  }
};

function cleanSupabaseUrl(url) {
  return String(url || "").replace(/\/$/, "").replace(/\/rest\/v1$/, "");
}

async function getSupabaseGuests({ supabaseUrl, supabaseKey, limit }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${baseUrl}/rest/v1/guests` +
    `?select=*` +
    `&phone=not.is.null` +
    `&limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function updateGuest({ supabaseUrl, supabaseKey, phone, payload }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const response = await fetch(
    `${baseUrl}/rest/v1/guests?phone=eq.${encodeURIComponent(phone)}`,
    {
      method: "PATCH",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function getIikoToken(apiLogin) {
  const response = await fetch("https://api-ru.iiko.services/api/1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiLogin })
  });

  const data = await response.json();

  if (!response.ok || !data.token) {
    throw new Error("Не удалось получить токен iiko");
  }

  return data.token;
}

async function getIikoCustomerByPhone({ token, organizationId, phone }) {
  const normalizedPhone = normalizePhone(phone);

  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/info", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: "phone",
      phone: normalizedPhone,
      organizationId
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    return {
      ok: false,
      error: data || `iiko error ${response.status}`
    };
  }

  const walletBalances = data.walletBalances || [];

  const totalBalance = walletBalances.reduce((sum, wallet) => {
    return sum + Number(wallet.balance || 0);
  }, 0);

  return {
    ok: true,
    customer: data,
    walletBalances,
    totalBalance
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
