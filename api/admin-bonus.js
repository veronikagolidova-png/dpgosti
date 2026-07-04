module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { telegram_id, amount, type } = req.body;

  if (!telegram_id || !amount) {
    return res.status(400).json({
      ok: false,
      error: "telegram_id and amount required"
    });
  }

  // Получаем гостя
  const guestRes = await fetch(
    `${SUPABASE_URL}/rest/v1/guests?telegram_id=eq.${telegram_id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  const guests = await guestRes.json();

  if (!guests.length) {
    return res.status(404).json({
      ok: false,
      error: "Guest not found"
    });
  }

  const guest = guests[0];

  let newBalance = Number(guest.bonus_balance || 0);

  if (type === "add") {
    newBalance += Number(amount);
  } else {
    newBalance -= Number(amount);
    if (newBalance < 0) newBalance = 0;
  }

  // Обновляем баланс
  await fetch(
    `${SUPABASE_URL}/rest/v1/guests?telegram_id=eq.${telegram_id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        bonus_balance: newBalance
      })
    }
  );

  return res.json({
    ok: true,
    balance: newBalance
  });
};
