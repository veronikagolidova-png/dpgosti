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
  const rawCustomerId = cleanText(req.query.customerId);
  const rawCardNumber = cleanText(req.query.cardNumber);
  const rawCardTrack = cleanText(req.query.cardTrack);
  const confirm = cleanText(req.query.confirm);

  if (!rawPhone && !rawCustomerId) {
    return res.status(400).json({
      ok: false,
      error: "Add phone or customerId",
      example:
        "/api/iiko-add-card-test?phone=79180000000&cardNumber=79180000000&confirm=yes"
    });
  }

  if (confirm !== "yes") {
    return res.status(400).json({
      ok: false,
      error: "To add a card, add confirm=yes",
      warning: "This endpoint can create a real card in iiko. Use a test guest first."
    });
  }

  const phone = rawPhone ? normalizePhone(rawPhone) : "";
  const cardNumber = normalizeCardNumber(rawCardNumber || rawPhone || rawCustomerId);
  const cardTrack = normalizeCardNumber(rawCardTrack || cardNumber);

  if (!cardNumber || !cardTrack) {
    return res.status(400).json({
      ok: false,
      error: "cardNumber/cardTrack is empty"
    });
  }

  try {
    const tokenResult = await getIikoToken(IIKO_API_LOGIN);

    if (!tokenResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "access_token",
        error: tokenResult.error
      });
    }

    const token = tokenResult.token;

    let customerId = rawCustomerId;
    let customerBefore = null;

    if (!customerId && phone) {
      const customerResult = await getIikoCustomerByPhone({
        token,
        organizationId: IIKO_ORGANIZATION_ID,
        phone
      });

      if (!customerResult.ok || !customerResult.customer) {
        return res.status(404).json({
          ok: false,
          step: "customer_info",
          error: "Customer not found by phone. Create customer first.",
          phone,
          details: customerResult.error
        });
      }

      customerBefore = customerResult.customer;
      customerId = customerBefore.id;
    }

    if (!customerId) {
      return res.status(400).json({
        ok: false,
        error: "customerId was not found"
      });
    }

    if (customerBefore && Array.isArray(customerBefore.cards) && customerBefore.cards.length > 0) {
      return res.status(200).json({
        ok: true,
        status: "already_has_card",
        message: "Customer already has card. We did not add a duplicate.",
        phone,
        customerId,
        cards: customerBefore.cards,
        customer: customerBefore
      });
    }

    const addResult = await addIikoCard({
      token,
      organizationId: IIKO_ORGANIZATION_ID,
      customerId,
      cardNumber,
      cardTrack
    });

    if (!addResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "card_add",
        error: addResult.error,
        sentToIiko: {
          customerId,
          organizationId: IIKO_ORGANIZATION_ID,
          cardNumber,
          cardTrack
        }
      });
    }

    let customerAfter = null;

    if (phone) {
      const afterResult = await getIikoCustomerByPhone({
        token,
        organizationId: IIKO_ORGANIZATION_ID,
        phone
      });

      if (afterResult.ok) {
        customerAfter = afterResult.customer;
      }
    }

    return res.status(200).json({
      ok: true,
      status: "card_added",
      message: "Card was added to customer in iiko",
      phone,
      customerId,
      cardNumber,
      cardTrack,
      iikoResponse: addResult.data,
      customerAfter
    });
  } catch (error) {
    console.error("iiko add card test error:", error);

    return res.status(500).json({
      ok: false,
      error: "iiko add card test failed",
      details: String(error.message || error)
    });
  }
};

function cleanText(value) {
  return String(value || "").trim();
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

function normalizeCardNumber(value) {
  return String(value || "").replace(/\D/g, "");
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

async function addIikoCard({
  token,
  organizationId,
  customerId,
  cardNumber,
  cardTrack
}) {
  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/card/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      customerId,
      cardTrack,
      cardNumber,
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
