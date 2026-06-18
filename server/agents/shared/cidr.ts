// Pure CIDR matching for IPv4 + IPv6. No external dep.
// Used by the admin IP allowlist (ISO 27001 A.5.15 access control,
// NIST 800-53 AC-3, SC-7).

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [+m[1], +m[2], +m[3], +m[4]];
  if (parts.some(p => p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6ToBytes(ip: string): Uint8Array | null {
  if (!ip.includes(':')) return null;
  // Handle ::ffff:1.2.3.4 by stripping the mapped prefix
  const v4tail = ip.match(/(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let working = ip;
  let tailBytes: number[] = [];
  if (v4tail) {
    const v4 = ipv4ToInt(v4tail[2]);
    if (v4 === null) return null;
    tailBytes = [(v4 >> 24) & 0xff, (v4 >> 16) & 0xff, (v4 >> 8) & 0xff, v4 & 0xff];
    working = v4tail[1].replace(/:$/, '');
  }
  const dbl = working.split('::');
  if (dbl.length > 2) return null;
  const left  = dbl[0] ? dbl[0].split(':') : [];
  const right = dbl[1] !== undefined ? (dbl[1] ? dbl[1].split(':') : []) : [];
  const totalGroups = 8 - (tailBytes.length ? 2 : 0);
  const missing = totalGroups - left.length - right.length;
  if (dbl.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < groups.length; i++) {
    const g = parseInt(groups[i], 16);
    if (Number.isNaN(g) || g < 0 || g > 0xffff) return null;
    bytes[i * 2]     = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  }
  if (tailBytes.length) {
    bytes[12] = tailBytes[0];
    bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2];
    bytes[15] = tailBytes[3];
  }
  return bytes;
}

function normaliseClientIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);  // IPv4-mapped IPv6
  return ip;
}

function matchV4(ip: number, cidrIp: number, prefix: number): boolean {
  if (prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (cidrIp & mask);
}

function matchV6(ipBytes: Uint8Array, cidrBytes: Uint8Array, prefix: number): boolean {
  if (prefix < 0 || prefix > 128) return false;
  const fullBytes = Math.floor(prefix / 8);
  const rem = prefix % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== cidrBytes[i]) return false;
  }
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (ipBytes[fullBytes] & mask) === (cidrBytes[fullBytes] & mask);
}

export function cidrMatch(rawIp: string, cidr: string): boolean {
  if (!rawIp || !cidr) return false;
  const ip = normaliseClientIp(rawIp);
  const [addr, prefixStr] = cidr.includes('/') ? cidr.split('/') : [cidr, undefined];
  // Plain address (no slash) — exact match against either family
  if (prefixStr === undefined) return ip === addr;
  const prefix = parseInt(prefixStr, 10);
  if (Number.isNaN(prefix)) return false;

  const v4 = ipv4ToInt(ip);
  const cidrV4 = ipv4ToInt(addr);
  if (v4 !== null && cidrV4 !== null) return matchV4(v4, cidrV4, prefix);

  const v6 = ipv6ToBytes(ip);
  const cidrV6 = ipv6ToBytes(addr);
  if (v6 && cidrV6) return matchV6(v6, cidrV6, prefix);

  return false;
}

export function ipInAnyCidr(rawIp: string, cidrs: string[]): boolean {
  return cidrs.some(c => cidrMatch(rawIp, c));
}
