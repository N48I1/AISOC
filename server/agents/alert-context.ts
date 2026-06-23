function safeJsonParse(value: unknown): any | null {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function compact(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function collectUrls(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s"'<>]+/g) || []));
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => acc && typeof acc === "object" ? acc[key] : undefined, obj);
}

export function parsedAlertPayload(alert: any): any {
  const parsed = safeJsonParse(alert?.full_log);
  return parsed && typeof parsed === "object" ? parsed : alert;
}

export function rawWazuhAlert(alert: any): any {
  const payload = parsedAlertPayload(alert);
  return payload?.attachments?.raw_wazuh_alert || payload?._source || payload;
}

export function alertData(alert: any): any {
  const payload = parsedAlertPayload(alert);
  const raw = rawWazuhAlert(alert);
  return raw?.data || payload?.data || alert?.data || {};
}

export function buildAlertContext(alert: any, opts: { maxRawChars?: number } = {}): string {
  const maxRawChars = opts.maxRawChars ?? 12000;
  const payload = parsedAlertPayload(alert);
  const raw = rawWazuhAlert(alert);
  const data = alertData(alert);
  const system = data?.win?.system || raw?.data?.win?.system || {};
  const eventData = data?.win?.eventdata || raw?.data?.win?.eventdata || {};
  const message = String(system.message || eventData.data || "");
  const combinedText = [
    message,
    typeof alert?.full_log === "string" ? alert.full_log : "",
    JSON.stringify(raw || {}),
  ].join("\n");

  const facts: Record<string, unknown> = {
    alert_id: alert?.id || payload?.id || raw?.id,
    timestamp: alert?.timestamp || payload?.timestamp || raw?.timestamp,
    rule: {
      id: raw?.rule?.id || payload?.rule?.id || alert?.rule_id,
      level: raw?.rule?.level || payload?.rule?.level || alert?.severity,
      description: raw?.rule?.description || payload?.rule?.description || alert?.description,
      groups: raw?.rule?.groups || payload?.rule?.groups,
    },
    agent: {
      id: raw?.agent?.id || payload?.agent?.id,
      name: raw?.agent?.name || payload?.agent?.name || alert?.agent_name || alert?.hostname,
      ip: raw?.agent?.ip || payload?.agent?.ip || alert?.source_ip,
    },
    windows_event: {
      provider: system.providerName,
      event_id: system.eventID,
      channel: system.channel,
      severity: system.severityValue,
      computer: system.computer,
      event_record_id: system.eventRecordID,
      message,
      eventdata: eventData.data,
    },
    extracted_artifacts: {
      application: getPathFromRegex(message, /Application:\s*([^\n\r]+)/i),
      app_path: getPathFromRegex(message, /(?:Path|App):\s*([A-Z]:\\[^\n\r]+)/i),
      required_framework: getPathFromRegex(message, /Framework:\s*'([^']+)'\s*,\s*version\s*'([^']+)'/i),
      dotnet_location: getPathFromRegex(message, /\.NET location:\s*([^\n\r]+)/i),
      found_frameworks: getPathFromRegex(message, /The following frameworks were found:\s*([\s\S]*?)(?:Learn more:|To install missing framework:|$)/i),
      urls: collectUrls(combinedText),
    },
  };

  const rawForModel = JSON.stringify(raw || payload || {}, null, 2).slice(0, maxRawChars);
  return [
    "EXTRACTED ALERT FACTS:",
    JSON.stringify(facts, null, 2),
    "",
    "RAW WAZUH ALERT:",
    rawForModel,
  ].join("\n");
}

function getPathFromRegex(text: string, regex: RegExp): string | string[] | null {
  const m = text.match(regex);
  if (!m) return null;
  if (m.length > 2) return m.slice(1).map(compact);
  return compact(m[1]);
}
