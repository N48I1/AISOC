import https from "node:https";

export interface TelegramResult {
  ok:    boolean;
  error?: string;
}

export async function sendTelegramMessage(config: {
  botToken: string;
  chatId:   string;
}, text: string): Promise<TelegramResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: config.chatId, text: text.slice(0, 4096), parse_mode: "HTML" });
    const opts: https.RequestOptions = {
      method:   "POST",
      hostname: "api.telegram.org",
      port:     443,
      path:     `/bot${config.botToken}/sendMessage`,
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() },
    };
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          const json = JSON.parse(text);
          if (json.ok) {
            console.log(`[Telegram] Message sent to chat ${config.chatId}`);
            resolve({ ok: true });
          } else {
            console.warn(`[Telegram] API error: ${json.description}`);
            resolve({ ok: false, error: json.description });
          }
        } catch {
          resolve({ ok: false, error: `Invalid JSON response: ${text.slice(0, 80)}` });
        }
      });
    });
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    req.on("error", (err) => { console.warn(`[Telegram] ${err.message}`); resolve({ ok: false, error: err.message }); });
    req.write(body);
    req.end();
  });
}
