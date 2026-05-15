module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set"
    });
  }

  try {
    const baseUrl = cleanSupabaseUrl(SUPABASE_URL);

    const url =
      `${baseUrl}/rest/v1/events` +
      `?is_active=eq.true` +
      `&select=id,event_date,title,description,branch,button_text,button_url,sort_order` +
      `&order=sort_order.asc,created_at.asc`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: text
      });
    }

    const events = text ? JSON.parse(text) : [];

    return res.status(200).json({
      ok: true,
      events
    });
  } catch (error) {
    console.error("Events endpoint error:", error);

    return res.status(500).json({
      ok: false,
      error: "Events endpoint failed"
    });
  }
};

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}
