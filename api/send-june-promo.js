module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

 const MINI_APP_URL = "https://dpgosti.vercel.app/?screen=booking&source=telegram_mailing&campaign=twilight_2026_10_20_reminder";

  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables"
    });
  }

  const key = String(req.query.key || "");
  const confirm = String(req.query.confirm || "");
 const limit = Math.min(Math.max(Number(req.query.limit || 20) || 20, 1), 20);
  const offset = Math.max(Number(req.query.offset || 0), 0);
const dryRun = confirm !== "yes";
  if (key !== SYNC_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Wrong key"
    });
  }


  // One browser tab orchestrates short requests, avoiding Vercel timeouts.
  if (String(req.query.run || "") === "all") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const safeKey = JSON.stringify(key).replace(/</g, "\\u003c");
    return res.status(200).send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Рассылка Сумерки</title><style>body{font:17px Arial,sans-serif;max-width:600px;margin:50px auto;padding:20px;line-height:1.5}h1{font-size:26px}#status{white-space:pre-line}button{padding:12px 20px;font-size:16px}</style></head><body><h1>Рассылка «Сумерки — завтра»</h1><p>Не закрывайте эту вкладку до завершения. Отправка идёт партиями по 20 человек.</p><p id="status">Подготовка…</p><button id="resume" hidden>Продолжить</button><script>
const secret=${safeKey};
const storageKey="twilight_2026_10_20_reminder_next_offset";
const initialOffset=Number(new URLSearchParams(location.search).get("offset")||0);
let offset=Math.max(initialOffset,Number(localStorage.getItem(storageKey)||initialOffset));
let sent=0, errors=0, checked=0;
const status=document.getElementById("status");
const button=document.getElementById("resume");
let running=false;
async function run(){
 if(running)return;
 running=true;button.hidden=true;
 try{
  while(true){
   status.textContent="Обработано в этом запуске: "+checked+"\\nОтправлено: "+sent+"\\nОшибок: "+errors+"\\nСледующая позиция: "+offset;
   const url="/api/send-june-promo?key="+encodeURIComponent(secret)+"&confirm=yes&limit=20&offset="+offset;
   const response=await fetch(url,{cache:"no-store"});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error?.message||JSON.stringify(data.error||"Ошибка сервера"));
   checked+=data.checked||0;sent+=data.sent||0;errors+=data.errors||0;
   offset+=data.checked||0;
   localStorage.setItem(storageKey,String(offset));
   if(!data.hasMore||!data.checked){
    status.textContent="Готово!\\nОбработано в этом запуске: "+checked+"\\nОтправлено: "+sent+"\\nОшибок: "+errors+"\\nСледующая позиция: "+offset;
    break;
   }
   await new Promise(resolve=>setTimeout(resolve,500));
  }
 }catch(e){
  status.textContent="Остановлено: "+String(e.message||e)+"\\nУже обработано: "+checked+"\\nОтправлено: "+sent+"\\nСледующая позиция: "+offset+"\\nНажмите «Продолжить» для повторной попытки.";
  button.hidden=false;
 }finally{running=false;}
}
button.addEventListener("click",run);
run();
</script></body></html>`);
  }



  const message = "Эдвард или Джейкоб? Завтра решим окончательно 🩸🌙\n\nУже завтра смотрим те самые «Сумерки» на большом экране!\n\nБелла, Эдвард, Джейкоб, любимые коктейли и немного ностальгии по 2008-му 🖤\n\n🎬 20 октября | 20:00\n📍 Северная, 299А — кинозал\n\nСобирай свою команду вампиров (или оборотней 😉) и бронируй стол заранее!\n\nУвидимся в Форксе 🐺";

  try {
    const guestsResult = await getGuests({
  supabaseUrl: SUPABASE_URL,
  supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
  limit,
  offset
});

    if (!guestsResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "get_guests",
        error: guestsResult.error
      });
    }

    const guests = guestsResult.data || [];

    const result = {
      ok: true,
      mode: dryRun ? "dry_run" : "send",
      checked: guests.length,
      offset,
      limit,
      hasMore: guests.length === limit,
      wouldSend: 0,
      sent: 0,
      skippedNoTelegramId: 0,
      errors: 0,
      items: []
    };

    for (const guest of guests) {
      if (!guest.telegram_id) {
        result.skippedNoTelegramId++;
        continue;
      }

      if (dryRun) {
        result.wouldSend++;
        result.items.push({
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "would_send"
        });
        continue;
      }

     const sendResult = await sendTelegramMessage({
  token: BOT_TOKEN,
  chatId: guest.telegram_id,
  text: message,
  buttonUrl: MINI_APP_URL
});
      if (!sendResult.ok) {
        result.errors++;
        result.items.push({
          telegram_id: guest.telegram_id,
          phone: guest.phone,
          status: "error",
          error: sendResult.error
        });

        await sleep(250);
        continue;
      }

      result.sent++;
      result.items.push({
        telegram_id: guest.telegram_id,
        phone: guest.phone,
        status: "sent"
      });

      await sleep(250);
    }

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error)
    });
  }
};

function cleanSupabaseUrl(url) {
  return String(url || "")
    .replace(/\/$/, "")
    .replace(/\/rest\/v1$/, "");
}

async function getGuests({ supabaseUrl, supabaseKey, limit, offset }) {
  const baseUrl = cleanSupabaseUrl(supabaseUrl);

  const response = await fetch(
    `${baseUrl}/rest/v1/guests?select=id,telegram_id,phone&telegram_id=not.is.null&order=id.asc&limit=${limit}&offset=${offset}`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    }
  );

  const data = await response.json();

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

async function sendTelegramMessage({ token, chatId, text, buttonUrl }) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [
            [
             {
  text: "🩸 Забронировать стол",
  web_app: {
    url: buttonUrl
  }
}
            ]
          ]
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data
    };
  }

  return {
    ok: true
  };
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
