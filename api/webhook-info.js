export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;

  if (!BOT_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "BOT_TOKEN is not set"
    });
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const data = await response.json();

  return res.status(200).json(data);
}
