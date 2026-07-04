module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const body = req.body || {};
  const phone = normalizePhone(body.phone || "");

  if (!phone) {
    return res.status(400).json({
      ok: false,
      error: "Phone is required"
    });
  }

  const cleanUrl = String(SUPABASE_URL)
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");

  const payload = {
    first_name: cleanText(body.first_name),
    last_name: cleanText(body.last_name),
    middle_name: cleanText(body.middle_name),
    birthday: body.birthday || null,
    needs_iiko_sync: true,
    iiko_sync_error: null,
    updated_at: new Date().toISOString()
  };

  try {
    const updateResponse = await fetch(
      `${cleanUrl}/rest/v1/guests?phone=eq.${encodeURIComponent(phone)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(payload)
      }
    );

    const updatedGuests = await updateResponse.json().catch(() => []);

    if (!updateResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "update_supabase",
        error: updatedGuests
      });
    }

    if (!Array.isArray(updatedGuests) || updatedGuests.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Guest not found"
      });
    }

    const syncUrl =
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}` +
      `/api/update-guest-iiko?key=${encodeURIComponent(SYNC_SECRET)}&phone=${encodeURIComponent(phone)}`;

    const syncResponse = await fetch(syncUrl);
    const syncData = await syncResponse.json().catch(() => null);

    if (!syncResponse.ok || !syncData || !syncData.ok) {
      return res.status(200).json({
        ok: true,
        synced: false,
        guest: updatedGuests[0],
        sync_error: syncData || "iiko sync failed"
      });
    }

    return res.status(200).json({
      ok: true,
      synced: true,
      guest: updatedGuests[0],
      iiko: syncData
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error.message || error)
    });
  }
};

function cleanText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || null;
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
