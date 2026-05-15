module.exports = async function handler(req, res) {
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;
  const IIKO_ORGANIZATION_ID = process.env.IIKO_ORGANIZATION_ID;

  if (!IIKO_API_LOGIN || !IIKO_ORGANIZATION_ID) {
    return res.status(500).json({
      ok: false,
      error: "IIKO_API_LOGIN or IIKO_ORGANIZATION_ID is not set"
    });
  }

  const rawPhone = req.query.phone;

  if (!rawPhone) {
    return res.status(400).json({
      ok: false,
      error: "Add phone query parameter, for example: /api/iiko-customer-test?phone=79186820375"
    });
  }

  const phone = normalizePhone(rawPhone);

  try {
    const tokenResponse = await fetch("https://api-ru.iiko.services/api/1/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        apiLogin: IIKO_API_LOGIN
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.token) {
      return res.status(500).json({
        ok: false,
        step: "access_token",
        error: tokenData
      });
    }

    const token = tokenData.token;

    const customerResponse = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        type: "phone",
        phone,
        organizationId: IIKO_ORGANIZATION_ID
      })
    });

    const customerData = await customerResponse.json();

    if (!customerResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "customer_info",
        phone,
        error: customerData
      });
    }

    const walletBalances = customerData.walletBalances || [];
    const totalBalance = walletBalances.reduce((sum, wallet) => {
      return sum + Number(wallet.balance || 0);
    }, 0);

    return res.status(200).json({
      ok: true,
      phone,
      customer: {
        id: customerData.id || null,
        name: customerData.name || null,
        surname: customerData.surname || null,
        phone: customerData.phone || null,
        birthday: customerData.birthday || null,
        walletBalances,
        totalBalance
      },
      raw: customerData
    });
  } catch (error) {
    console.error("iiko customer test error:", error);

    return res.status(500).json({
      ok: false,
      error: "iiko customer test failed"
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
