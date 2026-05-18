# LDAP / Active Directory SSO

## What It Does

Lets analysts sign in to AISOC with their corporate AD (or any LDAPv3) credentials instead of a local password. On the first successful LDAP login, a mirror account is auto-created in the local `users` table with the role you choose, so existing AISOC features (RBAC, audit log, profile, notifications) keep working unchanged.

This replaces the previous Firewall sub-tab in the Integrations page.

---

## How Authentication Flows

```
POST /api/auth/login { username, password }
        │
        ▼
┌────────────────────────────────────┐
│ readLdapConfig() — enabled?        │
└────────────────────────────────────┘
        │ yes                                  │ no / disabled
        ▼                                      │
1. Bind as service account (bind_dn)            │
2. Search base_dn with user_filter              │
3. Re-bind as the located user DN               │
   with the password the analyst typed          │
        │                                       │
   ┌────┴────┐                                  │
   │success  │fail + allow_local_fallback=false │
   ▼         ▼                                  ▼
Find or     401                          Local bcrypt check
create                                   (existing flow)
local row                                       │
   │                                            ▼
   ▼                                       Issue JWT
auth_source='ldap'
Issue JWT
```

**LDAP-sourced users cannot log in locally** when LDAP is disabled — they'll get a clear error. The auto-created bcrypt hash is unusable random garbage on purpose.

The seed `admin` account always stays `auth_source='local'` so it survives an LDAP misconfiguration.

---

## Configuration

Open **Integrations → LDAP / AD** (admin only).

| Field | Example | Notes |
|---|---|---|
| Server URL | `ldaps://dc01.bbs.local:636` | Use `ldaps://` for TLS on 636, `ldap://` for plain on 389. Self-signed certs are accepted. |
| Bind DN | `CN=svc-aisoc,OU=Service Accounts,DC=bbs,DC=local` | Service account used to *find* users, not authenticate them. |
| Bind password | … | Stored in `integrations.config` as JSON. Masked for non-admins on read. |
| Base DN | `DC=bbs,DC=local` | Subtree to search under. |
| User filter | `(sAMAccountName={{username}})` | `{{username}}` is replaced with the (escaped) submitted login. OpenLDAP: use `(uid={{username}})`. |
| Username attr | `sAMAccountName` | Becomes the local `users.username`. |
| Email attr | `mail` | Copied into `users.email` on first login. |
| Display name attr | `displayName` | Copied into `users.display_name`. |
| Default role | `ANALYST` | Role assigned to auto-created accounts. Promote individually in Admin Ops. |
| Allow local fallback | `ON` | If LDAP rejects a username, try the local password too. Keep ON until you confirm at least one admin can log in via LDAP. |

---

## Auto-Provisioning

When a previously-unknown LDAP user authenticates successfully for the first time, AISOC inserts a row:

```sql
INSERT INTO users (username, password, email, role, display_name, auth_source)
VALUES (<sAMAccountName>, <random-bcrypt>, <mail>, <default_role>, <displayName>, 'ldap');
```

After that the account behaves like any local user:
- Shows up in Admin Ops user list (with an "LDAP" badge derived from `auth_source`)
- Can have its role changed by an admin
- Can be locked / unlocked
- Has its own profile, notification prefs, activity feed
- Audit log records the LDAP DN in the `USER_CREATED` entry

If a row with that username already exists with `auth_source='local'`, LDAP login is rejected for that name to avoid silent identity hijack. Promote the account by deleting the local one or renaming it first.

---

## Test Connection

The "Test lookup" button does steps 1–2 only (service-bind + search). It verifies:
- The URL is reachable and TLS handshake works
- The bind credentials are correct
- The base DN + filter actually return the target user

It does **not** ask for the user's password, so it's safe to run with any AD username.

Backend endpoint: `POST /api/admin/integrations/ldap/test` (admin only), body `{ "username": "<sAMAccountName>" }`.

---

## API

```
GET    /api/integrations/ldap           — Read current config (bind_password masked for non-admins)
PATCH  /api/integrations/:name          — Update LDAP config / enabled flag (admin only)
POST   /api/admin/integrations/ldap/test — Service-bind + user search (admin only)
POST   /api/auth/login                  — Now tries LDAP first when enabled (no API change)
```

The LDAP row is **excluded** from `GET /api/integrations` (the notification grid). Use the per-name read above.

---

## Schema Changes

```sql
-- New column on the users table (auto-migrated on boot)
ALTER TABLE users ADD COLUMN auth_source TEXT DEFAULT 'local';
-- Values: 'local' | 'ldap'

-- The integrations table picks up a seed row at startup:
INSERT OR IGNORE INTO integrations (name, enabled, config, auto_send_threshold)
VALUES ('ldap', 0, '{...defaults...}', 'NEVER');
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "LDAP authentication failed" with `errorCode: NOT_FOUND` | Base DN or filter wrong | Run "Test lookup" with a known username; check `user_filter` matches your directory (`sAMAccountName` for AD vs `uid` for OpenLDAP). |
| "Invalid LDAP credentials" but user exists | Wrong password OR account locked in AD | Try logging in via the AD-native client first to confirm. |
| TLS handshake fails | Self-signed cert from an internal CA | We pass `rejectUnauthorized: false` already; if you still see issues, switch to `ldap://` on 389 to isolate. |
| "LDAP is disabled — this account cannot log in locally" | Account was created via LDAP, but the integration is now off | Re-enable LDAP or have an admin reset the local password explicitly. |
| The seed admin can't log in after enabling LDAP | LDAP rejected the lookup AND `allow_local_fallback` is OFF | Disable LDAP via direct DB write (`UPDATE integrations SET enabled=0 WHERE name='ldap'`), then re-enable with fallback ON. |

---

## Files Involved

```
agents/shared/ldap.ts           ← ldapjs wrapper — findLdapUser(), ldapAuthenticate()
server.ts                       ← readLdapConfig(), /api/auth/login LDAP path,
                                  /api/admin/integrations/ldap/test, ldap seed row,
                                  users.auth_source column
src/App.tsx                     ← LdapSection (in IntegrationsTab),
                                  AD/LDAP sub-tab replaces former Firewalls tab
src/services/aiService.ts       ← getIntegration(), testLdapConnection()
```
