# AISOC — ISO 27001:2022 & NIST 800-53 r5 Compliance Mapping

This document maps the security controls implemented in the AISOC platform to
**ISO/IEC 27001:2022 Annex A** and **NIST SP 800-53 Revision 5** control IDs.
It is intended as evidence packaging for auditors and as a quick orientation
for new operators.

Each entry lists:

- **Control** — the relevant ISO / NIST IDs
- **What we do** — the concrete behaviour in the codebase
- **Where** — the file paths, endpoints, DB columns or background workers
  that implement it
- **Evidence** — the audit-log event names and / or CSV reports an auditor
  can pull

Scope: the controls below cover identity & access management, authentication,
session management, privileged-access governance, audit logging, retention,
and operational hygiene. They cover the **technical** subset of the ISMS;
organisational controls (policies, training, supplier contracts) live outside
this repository.

---

## 1. Identity & Access Management

### 1.1 Centralised user store

| | |
|---|---|
| **ISO 27001** | A.5.16 — Identity management |
| **NIST 800-53** | IA-2, IA-4, AC-2 |
| **What we do** | Single `users` table is the source of truth. Every account has `id`, `username`, `email`, `role`, `status`, `created_at`, `last_login`, `auth_source` (`local` \| `ldap`). |
| **Where** | `server.ts` — schema in the migration block (~L460+), CRUD at `/api/users*`. |
| **Evidence** | `USER_CREATED`, `USER_DELETED` audit events. CSV report `/api/admin/reports/user-roster.csv`. |

### 1.2 Role-Based Access Control (RBAC)

| | |
|---|---|
| **ISO 27001** | A.5.15, A.5.18, A.8.2 |
| **NIST 800-53** | AC-2, AC-3, AC-6 |
| **What we do** | Five privilege tiers (`ANALYST` < `TIER1` < `TIER2` < `INCIDENT_LEAD` < `ADMIN`). Every protected endpoint declares its minimum tier through `requireRole(...)` / `requireAdmin`. A canonical permission matrix is exported via `GET /api/admin/permissions` (the single source of truth lives in `agents/shared/policy.ts → PERMISSIONS`). |
| **Where** | `server.ts` `ROLE_LEVEL` (~L1614), middleware `requireAdmin` / `requireRole`. Matrix endpoint at `/api/admin/permissions`. |
| **Evidence** | `USER_ROLE_CHANGED` audit events; permission matrix endpoint for auditor inspection. |

### 1.3 Least privilege & JIT elevation

| | |
|---|---|
| **ISO 27001** | A.8.2 — Privileged access rights |
| **NIST 800-53** | AC-6(2), AC-6(5) — Non-privileged accounts, Privileged accounts |
| **What we do** | A user's *base* role is fixed; admins can grant a **bounded** higher role for 5 min–4 h via `POST /api/admin/users/:id/temp-role` (gated by re-authentication / step-up). A background tick clears expired grants every 5 min. The middleware `effectiveRole()` resolves the max of base & temp. |
| **Where** | `server.ts` — columns `temp_role` / `temp_role_expires_at` / `temp_role_granted_by`; lifecycle tick at end of `startServer()`. |
| **Evidence** | `TEMP_ROLE_GRANTED`, `TEMP_ROLE_REVOKED`, `TEMP_ROLE_EXPIRED` audit events. |

### 1.4 Account lifecycle & expiry

| | |
|---|---|
| **ISO 27001** | A.5.18 — Access rights (provisioning, review, revocation) |
| **NIST 800-53** | AC-2(2), AC-2(3) — Automated termination of temporary / inactive accounts |
| **What we do** | Every user has `status` (`active` \| `disabled`) and optional `access_expires_at`. A background tick (5 min cadence) auto-disables any user whose window has lapsed and bumps their `jwt_epoch` so any open session dies immediately. `GET /api/admin/inactive-users?days=N` lists users without recent logins; `POST /api/admin/inactive-users/disable` bulk-disables (step-up gated). |
| **Where** | `server.ts` — `access_expires_at` column, lifecycle tick, inactive-user endpoints. |
| **Evidence** | `USER_ACCESS_EXPIRED`, `USER_STATUS_CHANGED`, `BULK_USER_DISABLED` audit events. |

### 1.5 Quarterly access reviews

| | |
|---|---|
| **ISO 27001** | A.5.18(c) — Periodic access review |
| **NIST 800-53** | AC-2(j) — Account reviews |
| **What we do** | Admin starts a review (`POST /api/admin/access-reviews`); the system snapshots every active user into `access_review_items`. Admin walks the list, marks each `keep` / `change_role` / `disable`. Completion writes one audit row carrying the full JSON of decisions — the artifact handed to auditors. |
| **Where** | Tables `access_reviews` + `access_review_items`; endpoints `/api/admin/access-reviews*`. |
| **Evidence** | `ACCESS_REVIEW_STARTED`, `ACCESS_REVIEW_COMPLETED` audit events; `GET /api/admin/access-reviews/:id` returns the full review. |

### 1.6 LDAP / AD integration & local fallback

| | |
|---|---|
| **ISO 27001** | A.5.16, A.5.17 |
| **NIST 800-53** | IA-2, IA-5 |
| **What we do** | When an LDAP integration row is enabled, every login tries LDAP first. Successful LDAP logins auto-provision a local mirror with `auth_source='ldap'`. Local users cannot use LDAP and vice-versa unless an admin sets a local password explicitly. The `allow_local_fallback` flag prevents LDAP misconfiguration from bricking local logins. |
| **Where** | `server.ts` `/api/auth/login` (~L1708); helpers in `agents/shared/ldap.ts`. |
| **Evidence** | `LOGIN` (with LDAP DN), `USER_CREATED` (LDAP auto-provision) audit events. |

---

## 2. Authentication

### 2.1 Strong password policy (NIST 800-63B aligned)

| | |
|---|---|
| **ISO 27001** | A.5.17 — Authentication information |
| **NIST 800-53** | IA-5(1) — Password-based authentication |
| **NIST 800-63B** | §5.1.1.2 (memorised secrets) — length first, complexity de-emphasised, blocklist required |
| **What we do** | Policy is a DB-backed row (`integrations.password_policy`) editable at runtime. Defaults: ≥12 characters, blocklist on, history depth 10, **no forced periodic rotation** (per 800-63B). Helper `validatePasswordAgainstPolicy()` enforces. |
| **Where** | `agents/shared/policy.ts` (helper + defaults). Endpoints `/api/auth/password-rules`, `/api/admin/security-policies`, `/api/admin/security-policies/:name`. |
| **Evidence** | `PASSWORD_POLICY_CHANGED` audit on every edit; `/api/auth/password-rules` returns current rules for the UI. |

### 2.2 Password history (anti-reuse)

| | |
|---|---|
| **ISO 27001** | A.5.17 |
| **NIST 800-53** | IA-5(1)(e) — Password reuse prohibition |
| **What we do** | New table `password_history` keeps the last *N* bcrypt hashes per user (N = `policy.history_depth`, default 10). Every password change / admin reset / user creation is recorded. On change, `passwordMatchesHistory()` rejects matches against any kept hash. |
| **Where** | `server.ts` `password_history` table + `recordPasswordChange()` / `passwordMatchesHistory()`. |
| **Evidence** | `PASSWORD_CHANGED`, `PASSWORD_RESET` audit events; reuse attempts return 400 with a clear message. |

### 2.3 Account lockout

| | |
|---|---|
| **ISO 27001** | A.8.5 — Secure authentication |
| **NIST 800-53** | AC-7 — Unsuccessful logon attempts |
| **What we do** | Lockout policy is a DB row (`integrations.lockout_policy`) — defaults 5 attempts / 15 min lockout / captcha-after-3. Login handler reads the policy on every call. Lockouts emit an audit event. Admins can override via `/api/admin/unlock-user/:id`. |
| **Where** | `server.ts` login flow (~L1779), `/api/admin/unlock-user/:id`. |
| **Evidence** | `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `USER_UNLOCKED` audit events. Compliance report `/api/admin/reports/failed-logins.csv` covers the last 90 d. |

### 2.4 Step-up / re-authentication for sensitive operations

| | |
|---|---|
| **ISO 27001** | A.5.15 — Privileged access controls |
| **NIST 800-53** | IA-11 — Re-authentication |
| **What we do** | Destructive / sensitive endpoints (`DELETE /api/users/:id`, `POST /api/admin/reset-alerts`, AI model changes, security-policy changes, JIT temp-role grants…) require a fresh password verification within the last 5 min. Frontend wraps each call through `StepUpModal`. |
| **Where** | `server.ts` `requireStepUp` middleware (~L1685); `/api/auth/verify-password` returns a 5-min `scope:'step_up'` JWT. Frontend in `src/components/StepUpModal.tsx`. |
| **Evidence** | `STEP_UP_VERIFIED`, `STEP_UP_FAILED` audit events. |

### 2.5 Session management & global logout

| | |
|---|---|
| **ISO 27001** | A.5.16 — Identity management |
| **NIST 800-53** | AC-12 — Session termination |
| **What we do** | Every issued JWT embeds the user's current `jwt_epoch`. `authenticate()` compares the embedded epoch against the live column; mismatch → 401. Bumping `jwt_epoch` (self-service `POST /api/users/me/sessions/revoke-all`, admin `POST /api/admin/users/:id/revoke-sessions`, password reset, account expiry) terminates **every** active token for that user. |
| **Where** | `server.ts` `users.jwt_epoch` column, `authenticate()` middleware, revoke-all endpoints. |
| **Evidence** | `SESSIONS_REVOKED` audit events. |

### 2.6 Per-account TLS / transport security

| | |
|---|---|
| **ISO 27001** | A.8.20, A.8.24 — Network security, cryptography |
| **NIST 800-53** | SC-8, SC-13 — Transmission confidentiality, cryptographic protection |
| **What we do** | Server starts in HTTPS mode whenever `certs/cert.pem` + `certs/key.pem` are present. HTTP-only mode is logged with a `[TLS] No certs found — running HTTP (dev only)` warning. `helmet` middleware sets standard security headers. |
| **Where** | `server.ts` HTTPS server bootstrap (~L1628); `helmet({ contentSecurityPolicy: false })`. |
| **Evidence** | Server logs at boot. |

---

## 3. Network-level access control

### 3.1 Admin IP allowlist

| | |
|---|---|
| **ISO 27001** | A.5.15, A.8.20 — Access control, network security |
| **NIST 800-53** | AC-3, SC-7 — Access enforcement, boundary protection |
| **What we do** | DB-backed config (`integrations.admin_ip_allowlist`) with `{ enabled, cidrs[] }`. When enabled, every `requireAdmin` call checks the client IP against the CIDR list (IPv4 + IPv6) and rejects misses with 403 + audit event. CIDR matcher is a zero-dependency helper. |
| **Where** | `agents/shared/cidr.ts`; `requireAdmin` middleware in `server.ts`. |
| **Evidence** | `ADMIN_IP_BLOCKED`, `ADMIN_IP_ALLOWLIST_CHANGED` audit events. |

### 3.2 Global rate limiting

| | |
|---|---|
| **ISO 27001** | A.8.20 |
| **NIST 800-53** | SC-5 — Denial of service protection |
| **What we do** | `express-rate-limit` with 200 req/min/IP applied globally. SIEM ingest has its own configurable per-key throttle. |
| **Where** | `server.ts` (~L1646); ingest rate limiter helper (~L44). |
| **Evidence** | HTTP 429 responses; not currently auditlogged (planned). |

---

## 4. Audit Logging

### 4.1 Audit log of security-relevant events

| | |
|---|---|
| **ISO 27001** | A.8.15 — Logging |
| **NIST 800-53** | AU-2, AU-3, AU-6 — Audit events, content, review |
| **What we do** | `audit_logs (id, timestamp, user_id, action, details)` captures every privilege-relevant action: authentication outcomes, user-management changes, role changes, password / MFA events, step-up, admin operations, session revocations, policy edits, JIT grants, access reviews, retention runs. `writeAudit()` is the single chokepoint. |
| **Where** | `server.ts` `writeAudit()` (~L1426). |
| **Evidence** | `GET /api/audit-logs?user_id=&action=&from=&to=&q=&page=` (filtered + paginated). `GET /api/audit-logs/export.csv` streams CSV. |

### 4.2 Audit log retention & archival

| | |
|---|---|
| **ISO 27001** | A.8.15(c) — Log retention |
| **NIST 800-53** | AU-11 — Audit record retention |
| **What we do** | DB-backed config (`integrations.audit_retention`) with `{ retention_days, archive_to_file, archive_path }`. Defaults: 365 d, archive on, `./audit-archive`. Hourly background tick streams rows older than `retention_days` to `audit-YYYY-MM-DD.jsonl.gz` then deletes. One audit row written per run (count + path). |
| **Where** | `server.ts` `runAuditRetentionOnce()` background tick (end of `startServer`). |
| **Evidence** | `AUDIT_ARCHIVED`, `AUDIT_RETENTION_CHANGED` audit events; archive files on disk. |

### 4.3 Failed-login monitoring

| | |
|---|---|
| **ISO 27001** | A.5.16, A.8.15, A.8.16 — Identity management, logging, monitoring |
| **NIST 800-53** | AU-6, AC-7, SI-4 |
| **What we do** | Every failed login emits a `LOGIN_FAILED` audit row tagged with username + source IP. Admin sees aggregated counts at `GET /api/admin/failed-logins?window=24h\|7d`. |
| **Where** | `server.ts` login handler (~L1779); aggregator endpoint (~L2370). |
| **Evidence** | `/api/admin/failed-logins`, `/api/admin/reports/failed-logins.csv`. |

---

## 5. Privileged Operations

### 5.1 Step-up on destructive operations

Covered by §2.4. Specific endpoints gated:

- `DELETE /api/users/:id`
- `POST /api/admin/reset-alerts`
- `POST /api/admin/clear-investigation`
- `POST /api/admin/clear-fp-archive`
- `POST /api/admin/inactive-users/disable`
- `POST /api/admin/users/:id/temp-role`
- `PATCH /api/admin/security-policies/:name`
- `PATCH /api/ai/models/:phase`
- `PATCH /api/local-llm/config`

### 5.2 Action provenance — every privileged event is attributable

| | |
|---|---|
| **ISO 27001** | A.5.15, A.8.15 |
| **NIST 800-53** | AU-3 — Content of audit records |
| **What we do** | Each `writeAudit()` call carries the authenticated `user_id` (`null` only for system events such as auto-escalation, expiry tick, retention tick). Details include the target entity ID, IP where relevant, before/after for state changes. |
| **Evidence** | Audit-log filter / export endpoints; `admin-actions.csv` compliance report. |

---

## 6. Cryptographic & secret hygiene

### 6.1 Password storage

| | |
|---|---|
| **ISO 27001** | A.5.17, A.8.24 |
| **NIST 800-53** | IA-5(1)(c) — Cryptographic protection of authenticators |
| **What we do** | bcrypt (cost 10) for every stored password — local accounts and the unusable randomly-generated LDAP mirror. No plaintext password ever persists. |
| **Where** | `server.ts` `bcrypt.hashSync(..., 10)` at every insertion point. |

### 6.2 Temporary passwords

| | |
|---|---|
| **ISO 27001** | A.5.17 |
| **NIST 800-53** | IA-5(1)(f) — Authenticator change requirement |
| **What we do** | Admin-generated temp passwords are 16-char base64url (96 bits entropy from `crypto.randomBytes(12)`). Shown to the admin **once** in the response — never stored in plaintext. `must_change_password=1` forces the user into a password-change modal on next login. |
| **Where** | `POST /api/users` `generate_temp_password` flag; `POST /api/users/:id/reset-password`. |

### 6.3 JWT secret handling

| | |
|---|---|
| **ISO 27001** | A.8.24 |
| **NIST 800-53** | SC-12 — Cryptographic key establishment / management |
| **What we do** | `JWT_SECRET` is sourced from environment at boot. A development fallback is present but flagged for replacement in production. JWTs carry only non-sensitive claims (`id`, `username`, `role`, `email`, `epoch`). |
| **Trade-off** | A production deployment **must** set `JWT_SECRET` to a strong random value. Documented as a deployment requirement. |

---

## 7. Compliance Evidence Reports

Endpoint suite (all `requireAdmin`):

| Report | Endpoint | Maps to |
|---|---|---|
| Active user roster | `GET /api/admin/reports/user-roster.csv` | ISO A.5.16, A.5.18 evidence |
| Failed logins (last *N* days) | `GET /api/admin/reports/failed-logins.csv?days=N` | NIST AU-6 evidence |
| Admin actions (last *N* days) | `GET /api/admin/reports/admin-actions.csv?days=N` | ISO A.8.15 evidence |
| Privileged coverage | `GET /api/admin/reports/privileged-coverage.csv` | ISO A.8.2 evidence |
| Access review history | `GET /api/admin/access-reviews` + per-review detail | ISO A.5.18 evidence |
| Audit-log export (filtered) | `GET /api/audit-logs/export.csv?…` | ISO A.8.15 evidence |

Each download emits a `COMPLIANCE_REPORT_DOWNLOADED` audit row so the act of pulling evidence is itself auditable.

---

## 8. System health & operational hygiene

### 8.1 Health endpoint

| | |
|---|---|
| **ISO 27001** | A.8.6 — Capacity management |
| **NIST 800-53** | SI-4(2), CM-3 |
| **What we do** | `GET /api/admin/health` returns uptime, DB size, row counts, Node memory, last SIEM-ingest heartbeat. Lets ops verify the platform is alive without DB access. |

### 8.2 Background hygiene workers

- **SLA escalation tick** (5 min): auto-escalates alerts past 2× their SLA window.
- **Account-lifecycle tick** (5 min): auto-disables expired accounts; clears expired temp roles.
- **Audit retention tick** (hourly): archives + deletes audit rows past retention.

All ticks are idempotent and log a single audit row per action.

---

## 9. Out of scope (documented gaps)

The following controls are intentionally not implemented in the current build
and should be addressed in a future iteration:

| Gap | Compensating control |
|---|---|
| TOTP / hardware MFA (NIST IA-2(1), 800-63B AAL2) | Step-up re-authentication on every sensitive op; admin IP allowlist; password policy + lockout |
| Centralised log forwarding to an external SIEM (NIST AU-6(3)) | The platform is itself the SIEM consumer; audit logs are stored on the platform DB with retention + archive |
| SAML / OIDC SSO (NIST IA-8) | LDAP / AD integration covers the most common SSO requirement |
| WebAuthn / FIDO2 (NIST IA-2(11)) | Step-up + IP allowlist + lockout |
| Editable custom roles (ISO A.8.2 fine-grained) | Five built-in tiers cover SOC role separation; matrix is read-only |
| Captcha rendering on login (NIST IA-6) | Lockout policy returns `captchaRequired` flag in the response; rendering deferred |

---

## 10. Quick checklist for an auditor

1. Pull `GET /api/admin/permissions` — verify the role / permission matrix matches the documented RACI.
2. Pull `GET /api/admin/reports/user-roster.csv` — verify every account has a justified role, `last_login` populated, no orphaned `INCIDENT_LEAD` / `ADMIN` accounts.
3. Pull `GET /api/admin/reports/privileged-coverage.csv` — verify all privileged accounts have a recent `password_changed_at` and `must_change_password=0`.
4. Pull `GET /api/admin/reports/admin-actions.csv?days=90` — verify a representative sample of admin actions has a justification trail.
5. Pull `GET /api/admin/reports/failed-logins.csv?days=90` — verify failed-login concentrations have been investigated.
6. Pull `GET /api/admin/access-reviews` — verify the most recent access review is < 90 days old and was completed.
7. Pull `GET /api/admin/security-policies` — verify password policy meets corporate baseline (length ≥ 12, blocklist on, history ≥ 5).
8. Pull `GET /api/admin/health` — verify the platform is up, DB size sane, ingest heartbeat recent.
9. Inspect `audit-archive/` — verify retention is producing files at the configured cadence.

---

*Last reviewed: 2026-05-21. Owners: the AISOC engineering team.*
