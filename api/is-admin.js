module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const telegramId = String(req.query.telegram_id || "");

  if (!telegramId) {
    return res.status(400).json({
      ok: false,
      error: "telegram_id required"
    });
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/admins?telegram_id=eq.${telegramId}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  const data = await response.json();

  return res.json({
    ok: true,
    isAdmin: data.length > 0,
    admin: data[0] || null
  });
};
