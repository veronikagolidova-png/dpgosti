module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const phone = normalizePhone(req.query.phone || "");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase variables"
    });
  }

  if (!phone) {
    return res.status(400).json({
      ok: false,
      error: "phone required"
    });
  }

  const cleanUrl = String(SUPABASE_URL)
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  try {
    const url =
      `${cleanUrl}/rest/v1/guests` +
      `?select=*` +
      `&phone=eq.${encodeURIComponent(phone)}` +
      `&limit=1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json().catch(() => []);

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: data
      });
    }

    return res.status(200).json({
      ok: true,
      phone,
      guest: Array.isArray(data) && data.length ? data[0] : null
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error.message || error)
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
