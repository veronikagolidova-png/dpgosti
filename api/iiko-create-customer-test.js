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
  const fullName = cleanText(req.query.fullName);
  const birthday = cleanText(req.query.birthday);
  const source = cleanText(req.query.source);
  const confirm = cleanText(req.query.confirm);

  if (!rawPhone || !fullName || !birthday || !source) {
    return res.status(400).json({
      ok: false,
      error: "Add phone, fullName, birthday and source query parameters",
      example:
        "/api/iiko-create-customer-test?phone=79180000000&fullName=Иванов Иван Иванович&birthday=2000-05-15&source=Instagram&confirm=yes"
    });
  }

  if (confirm !== "yes") {
    return res.status(400).json({
      ok: false,
      error: "To create a customer, add confirm=yes",
      warning: "This endpoint can create a real guest in iiko. Use a test phone first."
    });
  }

  if (!isValidBirthday(birthday)) {
    return res.status(400).json({
      ok: false,
      error: "Birthday must be in YYYY-MM-DD format, for example 2000-05-15"
    });
  }

  const phone = normalizePhone(rawPhone);
  const nameParts = splitFullName(fullName);
  const iikoBirthday = `${birthday} 00:00:00.000`;

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

    const checkResult = await getIikoCustomerByPhone({
      token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone
    });

    if (checkResult.ok && checkResult.customer) {
      const walletBalances = checkResult.customer.walletBalances || [];
      const totalBalance = walletBalances.reduce((sum, wallet) => {
        return sum + Number(wallet.balance || 0);
      }, 0);

      return res.status(200).json({
        ok: true,
        status: "already_exists",
        message: "Guest already exists in iiko. We did not create a duplicate.",
        phone,
        customer: {
          id: checkResult.customer.id || null,
          name: checkResult.customer.name || null,
          surname: checkResult.customer.surname || null,
          birthday: checkResult.customer.birthday || null,
          totalBalance
        },
        raw: checkResult.customer
      });
    }

    if (!checkResult.notFound) {
      return res.status(500).json({
        ok: false,
        step: "customer_info",
        error: "Could not confirm that customer does not exist. Customer was not created.",
        details: checkResult.error
      });
    }

    const createResult = await createIikoCustomer({
      token,
      organizationId: IIKO_ORGANIZATION_ID,
      phone,
      fullName,
      birthday: iikoBirthday,
      source,
      nameParts
    });

    if (!createResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "create_or_update",
        error: createResult.error
      });
    }

    return res.status(200).json({
      ok: true,
      status: "created",
      message: "Guest was created in iiko",
      phone,
      sentToIiko: {
        phone,
        fullName,
        birthday,
        source,
        name: nameParts.name,
        surName: nameParts.surName,
        middleName: nameParts.middleName
      },
      iikoResponse: createResult.data
    });
  } catch (error) {
    console.error("iiko create customer test error:", error);

    return res.status(500).json({
      ok: false,
      error: "iiko create customer test failed",
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

function isValidBirthday(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return {
      surName: "",
      name: parts[0],
      middleName: ""
    };
  }

  if (parts.length === 2) {
    return {
      surName: parts[0],
      name: parts[1],
      middleName: ""
    };
  }

  return {
    surName: parts[0],
    name: parts[1],
    middleName: parts.slice(2).join(" ")
  };
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

  const errorText = JSON.stringify(data || "").toLowerCase();

  const notFound =
    response.status === 400 ||
    errorText.includes("not found") ||
    errorText.includes("не найден") ||
    errorText.includes("customer") && errorText.includes("not");

  return {
    ok: false,
    notFound,
    error: data
  };
}

async function createIikoCustomer({
  token,
  organizationId,
  phone,
  fullName,
  birthday,
  source,
  nameParts
}) {
  const response = await fetch("https://api-ru.iiko.services/api/1/loyalty/iiko/customer/create_or_update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      organizationId,
      phone,
      name: nameParts.name,
      surName: nameParts.surName,
      middleName: nameParts.middleName,
      birthday,
      consentStatus: 1,
      shouldReceivePromoActionsInfo: false,
      userData: `ФИО: ${fullName}\nОткуда узнали о нас: ${source}\nИсточник регистрации: Telegram Mini App`
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
