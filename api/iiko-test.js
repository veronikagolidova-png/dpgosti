module.exports = async function handler(req, res) {
  const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;

  if (!IIKO_API_LOGIN) {
    return res.status(500).json({
      ok: false,
      error: "IIKO_API_LOGIN is not set"
    });
  }

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

    const organizationsResponse = await fetch("https://api-ru.iiko.services/api/1/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        organizationIds: null,
        returnAdditionalInfo: true,
        includeDisabled: false
      })
    });

    const organizationsData = await organizationsResponse.json();

    if (!organizationsResponse.ok) {
      return res.status(500).json({
        ok: false,
        step: "organizations",
        error: organizationsData
      });
    }

    return res.status(200).json({
      ok: true,
      message: "iiko connection works",
      organizations: organizationsData.organizations?.map((org) => ({
        id: org.id,
        name: org.name,
        address: org.address,
        isActive: !org.isDisabled
      })) || []
    });
  } catch (error) {
    console.error("iiko test error:", error);

    return res.status(500).json({
      ok: false,
      error: "iiko test failed"
    });
  }
};
