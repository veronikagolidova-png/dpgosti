module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const telegramId = String(req.query.telegram_id || "").trim();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase variables"
    });
  }

  if (!telegramId) {
    return res.status(400).json({
      ok: false,
      error: "telegram_id required"
    });
  }

  const cleanUrl = String(SUPABASE_URL)
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  try {
    const response = await fetch(
      `${cleanUrl}/rest/v1/admins?telegram_id=eq.${encodeURIComponent(telegramId)}&select=*`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json().catch(() => []);

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: data
      });
    }

    return res.status(200).json({
      ok: true,
      isAdmin: Array.isArray(data) && data.length > 0,
      admin: Array.isArray(data) ? data[0] || null : null
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error.message || error)
    });
  }
};
