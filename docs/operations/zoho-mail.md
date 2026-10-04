---
title: Zoho SSO and mail operating guide
status: approved-candidate
owner: security-and-operations
related: [SEC-001, CFG-001, OPS-003, AUTH-001]
---

# Zoho SSO and mail operating guide

## Decision

Zoho Accounts and Zoho Mail serve separate purposes.

- Zoho Accounts OAuth is the administrator login. An administrator does not use an application password and does not have to enrol in application TOTP for routine access.
- Any existing bride, groom, family, agent, vendor or planner account may also choose Zoho SSO when its WOW email matches the verified email returned by Zoho. Accounts using Gmail or another provider continue to work with username, email address or mobile number plus password.
- OTP is limited to signup/contact verification and password recovery. It is not a passwordless login method.
- Zoho Mail SMTP sends verification, invitation, password-reset, RSVP and operational messages. It does not control application login.

Zoho SSO uses the Authorization Code flow and the least-privilege `AaaServer.profile.Read` scope. The application accepts only an already-existing account with a matching email and never creates or changes roles from an SSO assertion.

## TOTP and step-up

Application TOTP remains optional and is not part of routine administrator login. Zoho account MFA should protect the Zoho identity itself.

For a later high-risk action such as starting the one-button AWS migration, prefer fresh Zoho reauthentication and a five-minute, single-use, action-scoped token. Add application TOTP only if the chosen Zoho plan cannot provide adequate fresh-authentication evidence. If TOTP is enabled, the sequence is: enrol from an authenticated session, scan the QR code, confirm one current six-digit code, store recovery codes, then enter a current code only when the protected action requests step-up.

## Required account and access

At final deployment, the owner must provide:

- a Zoho OAuth web application client ID and secret;
- an exact callback URI for the production domain;
- the permitted Zoho Accounts data-centre URL;
- a verified sending domain and DNS access for SPF, DKIM and DMARC;
- a sender mailbox or alias used by `MAIL_FROM` and `SMTP_USER`;
- a revocable SMTP application password;
- access to Zoho security, sending and restriction reports.

Store client secrets and SMTP credentials only in Railway/GitHub/Kubernetes secret storage. Record owners and verification dates in `access.csv`, never credential values.

## Configuration

The committed configuration contains placeholders only until the final deployment gate.

```text
ADMIN_LOGIN_PROVIDER=zoho
ZOHO_SSO_ENABLED=true
ZOHO_ACCOUNTS_URL=https://accounts.zoho.<approved-data-centre>
ZOHO_CLIENT_ID=<secret-store reference>
ZOHO_CLIENT_SECRET=<secret-store reference>
ZOHO_REDIRECT_URI=https://<public-host>/api/auth/sso/zoho/callback

MAIL_PROVIDER=smtp
MAIL_FROM=WOW <no-reply@your-domain.com>
SMTP_HOST=<Zoho account SMTP host>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@your-domain.com
SMTP_PASSWORD=<secret-store reference>
APP_BASE_URL=https://<public-host>
```

Use the exact SMTP host shown by Zoho for the account and data centre. Port 465 uses implicit TLS. Port 587 uses STARTTLS and `SMTP_SECURE=false`.

## Final enablement sequence

Do this at the end of the release process, after application and infrastructure validation:

1. Verify the domain and publish SPF, DKIM and DMARC without weakening existing policies.
2. Create the Zoho OAuth web application with the exact production callback URI.
3. Protect the Zoho administrator/mailbox owner with Zoho MFA and create the SMTP application password.
4. Store SSO and SMTP secrets in the target platform; set only non-secret values through canonical configuration.
5. Keep the deployment restricted and test SSO for an administrator and one non-admin matching-email account.
6. Send verification, reset and administrator-alert messages to controlled inboxes. Confirm delivery, expiry, From/Reply-To identity, SPF/DKIM/DMARC alignment and redacted logs.
7. Select the public-beta tier only after those checks pass.

## Capacity and fallback

Zoho Mail is suitable for the initial low-volume beta, not high-volume bulk delivery. Create an `OPS-003` provider decision before sustained external traffic reaches 25 messages per hour, or immediately after any restriction, bounce spike or delayed security email.

Do not switch a public deployment to `MAIL_PROVIDER=log`. Roll back to the previous working SMTP secret/provider or pause email-dependent workflows until delivery is restored.

Official references:

- [Zoho OAuth web-server flow](https://www.zoho.com/developer/oauth/web-server-apps/overview.html)
- [Zoho OAuth authorization code](https://www.zoho.com/developer/oauth/web-server-apps/get-authorization-code.html)
- [Zoho OAuth user information](https://www.zoho.com/accounts/protocol/oauth/use-access-token.html)
- [Zoho SMTP configuration](https://www.zoho.com/mail/help/zoho-smtp.html)
- [Zoho Mail sending limits](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html)
