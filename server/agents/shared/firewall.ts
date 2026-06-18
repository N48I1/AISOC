import https from "node:https";
import http  from "node:http";
import { URL } from "node:url";

export type FirewallType = "fortigate" | "pfsense" | "sophos";

export interface FirewallBlockResult {
  ok:      boolean;
  detail?: string;
  error?:  string;
}

// ─── Generic HTTP helper ─────────────────────────────────────────────────────
function request(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const isHttps = u.protocol === "https:";
    const mod     = isHttps ? https : http;
    const opts: https.RequestOptions = {
      method,
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     u.pathname + u.search,
      headers:  body
        ? { ...headers, "Content-Length": Buffer.byteLength(body).toString() }
        : headers,
      rejectUnauthorized: false, // self-signed certs common on network gear
    };
    const req = mod.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end",  () =>
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── FortiGate ───────────────────────────────────────────────────────────────
// Uses FortiOS REST API v2. Requires an API token (System > Admin > REST API Admin).
// Strategy: upsert an address object named "BBS-AISOC-Block-<ip>",
// then add it to an address group named "BBS-AISOC-Blocked" (created if missing).
async function fortigate(cfg: Record<string, string>, ip: string, action: "block" | "unblock"): Promise<FirewallBlockResult> {
  const { url, api_token, group_name = "BBS-AISOC-Blocked" } = cfg;
  if (!url || !api_token) return { ok: false, error: "Missing url or api_token" };
  const base    = url.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" };
  const addrName = `BBS-BLOCK-${ip.replace(/\./g, "-").replace(/:/g, "-")}`;

  if (action === "block") {
    // 1. Create/update address object
    const addrBody = JSON.stringify({
      name: addrName,
      type: "ipmask",
      subnet: `${ip}/32`,
      comment: "Blocked by BBS AISOC",
    });
    const addrRes = await request(
      `${base}/api/v2/cmdb/firewall/address/${encodeURIComponent(addrName)}`,
      "PUT", headers, addrBody
    );
    if (addrRes.status !== 200 && addrRes.status !== 201) {
      // Try POST if PUT 404
      await request(`${base}/api/v2/cmdb/firewall/address`, "POST", headers, addrBody);
    }

    // 2. Ensure block group exists, add member
    const grpGet  = await request(`${base}/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(group_name)}`, "GET", headers);
    let members: any[] = [];
    if (grpGet.status === 200) {
      try { members = JSON.parse(grpGet.text)?.results?.[0]?.member || []; } catch {}
    }
    if (!members.find((m: any) => m.name === addrName)) members.push({ name: addrName });

    const grpBody = JSON.stringify({ name: group_name, member: members, comment: "BBS AISOC auto-block list" });
    if (grpGet.status === 200) {
      await request(`${base}/api/v2/cmdb/firewall/addrgrp/${encodeURIComponent(group_name)}`, "PUT", headers, grpBody);
    } else {
      await request(`${base}/api/v2/cmdb/firewall/addrgrp`, "POST", headers, grpBody);
    }
    return { ok: true, detail: `IP ${ip} added to FortiGate group "${group_name}"` };
  } else {
    // Unblock: remove address object
    const delRes = await request(
      `${base}/api/v2/cmdb/firewall/address/${encodeURIComponent(addrName)}`,
      "DELETE", headers
    );
    return { ok: delRes.status === 200, detail: `IP ${ip} removed from FortiGate`, error: delRes.status !== 200 ? delRes.text.slice(0, 100) : undefined };
  }
}

// ─── pfSense ─────────────────────────────────────────────────────────────────
// Requires the unofficial pfSense REST API package (https://github.com/jaredhendrickson13/pfsense-api)
// Strategy: add/remove IPs from a firewall alias named "BBS_AISOC_Blocked",
// then apply the config. The alias must be referenced by a block rule in pfSense.
async function pfsense(cfg: Record<string, string>, ip: string, action: "block" | "unblock"): Promise<FirewallBlockResult> {
  const { url, client_id, client_token, alias = "BBS_AISOC_Blocked" } = cfg;
  if (!url || !client_id || !client_token) return { ok: false, error: "Missing url, client_id, or client_token" };
  const base    = url.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  const authBody = JSON.stringify({ client_id, client_token });

  if (action === "block") {
    const body = JSON.stringify({ name: alias, address: ip, detail: "Blocked by BBS AISOC" });
    const res  = await request(`${base}/api/v1/firewall/alias/entry`, "POST", headers, `${authBody.slice(0, -1)},${body.slice(1)}`);
    // pfSense API merges auth + payload or uses query params depending on version
    const res2 = await request(`${base}/api/v1/firewall/alias/entry?client-id=${client_id}&client-token=${encodeURIComponent(client_token)}`,
      "POST", { "Content-Type": "application/json" }, body);
    const ok = res.status === 200 || res2.status === 200;
    return { ok, detail: `IP ${ip} added to pfSense alias "${alias}"`, error: ok ? undefined : `HTTP ${res2.status}` };
  } else {
    const res = await request(
      `${base}/api/v1/firewall/alias/entry?client-id=${client_id}&client-token=${encodeURIComponent(client_token)}&name=${alias}&address=${ip}`,
      "DELETE", { "Content-Type": "application/json" }
    );
    return { ok: res.status === 200, detail: `IP ${ip} removed from pfSense alias "${alias}"`, error: res.status !== 200 ? res.text.slice(0, 100) : undefined };
  }
}

// ─── Sophos XG / SFOS ────────────────────────────────────────────────────────
// Uses Sophos Firewall XML API (port 4444 by default).
// Strategy: add IP to an IP Host, then add to a Host Group used in block policy.
async function sophos(cfg: Record<string, string>, ip: string, action: "block" | "unblock"): Promise<FirewallBlockResult> {
  const { url, username, password } = cfg;
  if (!url || !username || !password) return { ok: false, error: "Missing url, username, or password" };
  const base    = url.replace(/\/$/, "");
  const hostName = `BBS-BLOCK-${ip.replace(/\./g, "-")}`;

  const xmlRequest = action === "block"
    ? `<Request><Login><Username>${username}</Username><Password>${password}</Password></Login><Set operation="add"><IPHost><Name>${hostName}</Name><IPFamily>IPv4</IPFamily><HostType>IP</HostType><IPAddress>${ip}</IPAddress></IPHost></Set></Request>`
    : `<Request><Login><Username>${username}</Username><Password>${password}</Password></Login><Remove><IPHost><Name>${hostName}</Name></IPHost></Remove></Request>`;

  const res = await request(
    `${base}/webconsole/APIController?reqxml=${encodeURIComponent(xmlRequest)}`,
    "GET", {}
  );

  const ok = res.status === 200 && !res.text.includes("Authentication Failure") && !res.text.includes("Error");
  return {
    ok,
    detail: ok ? `IP ${ip} ${action === "block" ? "blocked on" : "unblocked from"} Sophos XG` : undefined,
    error:  ok ? undefined : res.text.slice(0, 150),
  };
}

// ─── Public dispatcher ───────────────────────────────────────────────────────
export async function firewallBlockIp(
  type: FirewallType,
  cfg:  Record<string, string>,
  ip:   string,
  action: "block" | "unblock" = "block",
): Promise<FirewallBlockResult> {
  console.log(`[Firewall][${type}] ${action} ${ip}`);
  try {
    if (type === "fortigate") return await fortigate(cfg, ip, action);
    if (type === "pfsense")   return await pfsense(cfg, ip, action);
    if (type === "sophos")    return await sophos(cfg, ip, action);
    return { ok: false, error: `Unknown firewall type: ${type}` };
  } catch (err: any) {
    console.warn(`[Firewall][${type}] error: ${err?.message}`);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}

export async function firewallTestConnection(type: FirewallType, cfg: Record<string, string>): Promise<FirewallBlockResult> {
  // Use a known-safe IP for test (documentation range — 192.0.2.x are TEST-NET, should never actually reach)
  const testIp = "192.0.2.1";
  const res = await firewallBlockIp(type, cfg, testIp, "block");
  if (res.ok) {
    // Clean up test entry
    await firewallBlockIp(type, cfg, testIp, "unblock").catch(() => {});
  }
  return res;
}
