import https from "node:https";
import http  from "node:http";
import { URL } from "node:url";

export interface GlpiTicketResult {
  ok:       boolean;
  ticketId?: number;
  error?:   string;
}

function httpRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const isHttps = u.protocol === "https:";
    const mod     = isHttps ? https : http;
    const opts: https.RequestOptions = {
      method,
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     u.pathname + u.search,
      headers:  body ? { ...headers, "Content-Length": Buffer.byteLength(body).toString() } : headers,
      rejectUnauthorized: false,
    };
    const req = mod.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end",  () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function createGlpiTicket(config: {
  url:        string;
  appToken:   string;
  userToken:  string;
}, ticket: {
  title:    string;
  content:  string;
  urgency?: number; // 1=very low … 5=very high
}): Promise<GlpiTicketResult> {
  const base = config.url.replace(/\/$/, "") + "/apirest.php";
  try {
    // Step 1: init session
    const init = await httpRequest(`${base}/initSession`, "GET", {
      "App-Token":  config.appToken,
      "Authorization": `user_token ${config.userToken}`,
      "Content-Type": "application/json",
    });
    if (init.status !== 200) return { ok: false, error: `GLPI initSession HTTP ${init.status}: ${init.text.slice(0, 100)}` };
    const session = JSON.parse(init.text)?.session_token;
    if (!session) return { ok: false, error: "No session token from GLPI" };

    // Step 2: create ticket
    const body = JSON.stringify({
      input: {
        name:    ticket.title.slice(0, 255),
        content: ticket.content,
        urgency: ticket.urgency ?? 3,
        type:    1, // 1=Incident
      }
    });
    const create = await httpRequest(`${base}/Ticket`, "POST", {
      "App-Token":    config.appToken,
      "Session-Token": session,
      "Content-Type": "application/json",
    }, body);

    if (create.status !== 201) return { ok: false, error: `GLPI createTicket HTTP ${create.status}: ${create.text.slice(0, 100)}` };
    const ticketId = JSON.parse(create.text)?.id;

    // Step 3: close session (fire-and-forget)
    httpRequest(`${base}/killSession`, "GET", {
      "App-Token":    config.appToken,
      "Session-Token": session,
    }).catch(() => {});

    console.log(`[GLPI] Ticket #${ticketId} created: ${ticket.title}`);
    return { ok: true, ticketId };
  } catch (err: any) {
    console.warn(`[GLPI] Error: ${err?.message}`);
    return { ok: false, error: err?.message || "Unknown GLPI error" };
  }
}
