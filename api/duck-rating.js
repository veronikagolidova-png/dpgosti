module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  try {
    const result = await getDuckRating({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_SERVICE_ROLE_KEY
    });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error: result.error
      });
    }

    return res.status(200).json({
      ok: true,
      rating: result.rating
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Duck rating failed",
      details: String(error.message || error)
    });
  }
};

function cleanSupabaseUrl(supabaseUrl) {
  return String(supabaseUrl || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function getDuckRating({ supabaseUrl, supabaseKey }) {
  const cleanUrl = cleanSupabaseUrl(supabaseUrl);

  const url =
    `${cleanUrl}/rest/v1/duck_challenge_submissions` +
    `?select=telegram_id,first_name,last_name,username,status` +
    `&status=eq.approved`;

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
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: text
    };
  }

  const map = new Map();

  for (const row of data || []) {
    const key = String(row.telegram_id);

    if (!map.has(key)) {
      const displayName =
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.username ||
        `Гость ${row.telegram_id}`;

      map.set(key, {
        telegram_id: row.telegram_id,
        display_name: displayName,
        ducks_count: 0
      });
    }

    map.get(key).ducks_count += 1;
  }

  const rating = Array.from(map.values())
    .sort((a, b) => b.ducks_count - a.ducks_count)
    .slice(0, 20);

  return {
    ok: true,
    rating
  };
}
