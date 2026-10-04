---
title: Zoho Mail SMTP operating guide
status: approved-candidate
owner: security-and-operations
related: [SEC-001, CFG-001, OPS-003]
---

# Zoho Mail SMTP operating guide

## Decision

Zoho Mail is feasible for the initial low-volume beta because the backend already uses authenticated SMTP through Nodemailer. No Zoho-specific SDK or application-code dependency is required.

It is not the application MFA factor. Administrator MFA remains authenticator-based TOTP with recovery codes. Zoho delivers verification, invitation, password-reset, RSVP and operational email.

Zoho Mail is not the long-term high-volume transactional endpoint. Zoho documents a reputation-dependent external limit of roughly 50–500 messages per rolling hour and does not support bulk/burst sending. Zoho recommends ZeptoMail for automated transactional messages. Create an `OPS-003` migration decision before sustained traffic reaches 25 external messages/hour, or immediately after any rate restriction, bounce spike or delayed security email.

Official references:

- [Zoho SMTP server configuration](https://www.zoho.com/mail/help/zoho-smtp.html)
- [Zoho Mail sending limits](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html)
- [Zoho Mail usage policy](https://www.zoho.com/mail/help/usage-policy.html)
- [Zoho ZeptoMail transactional SMTP/API](https://www.zoho.com/zeptomail/)

## Required account and access

The owner creates a domain mailbox such as `no-reply@your-domain.com` and keeps human access protected by Zoho MFA. The application uses a separately generated app-specific password, never the human account password.

Required permissions and setup:

- verified sending domain;
- access to publish SPF, DKIM and DMARC DNS records;
- mailbox/alias used by `MAIL_FROM` and `SMTP_USER`;
- Zoho MFA enabled for the mailbox owner;
- revocable app-specific password for the application;
- access to Zoho sending/security reports and restriction notices.

Store `SMTP_USER` and `SMTP_PASSWORD` only in Railway/GitHub/Kubernetes secret storage. Record owners and verification dates in `access.csv`, never credential values.

## Configuration

Use the exact server shown in the Zoho account's **Server Configuration** because it varies by account type and data centre.

```text
DEPLOYMENT_TIER=public-beta
MAIL_PROVIDER=smtp
MAIL_FROM=WOW <no-reply@your-domain.com>
SMTP_HOST=<Zoho account SMTP host>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@your-domain.com
SMTP_PASSWORD=<app-specific password from secret store>
APP_BASE_URL=https://<public application host>
```

Port `465` uses implicit TLS and requires `SMTP_SECURE=true`. Port `587` uses a TLS upgrade and requires `SMTP_SECURE=false`. The authenticated address must match the sender address or a configured alias.

## Enablement sequence

1. Verify the domain and publish SPF, DKIM and DMARC without weakening existing policies.
2. Enable MFA on the Zoho owner account and create an application-specific password.
3. Store the two SMTP secrets in the target platform; set non-secret values through canonical configuration.
4. Keep `DEPLOYMENT_TIER=staging` and send verification, password-reset and administrator-alert messages to controlled inboxes.
5. Confirm delivery, link host, expiry, From/Reply-To identity, SPF/DKIM/DMARC alignment and redacted application logs.
6. Enrol every administrator in TOTP MFA.
7. Select `DEPLOYMENT_TIER=public-beta`; boot must fail if mail or security settings are unsafe.
8. Monitor send failures, restriction notices, bounces and time-to-delivery.

## Rotation and rollback

To rotate, create a new app-specific password, update the platform secret, restart one candidate instance, perform the controlled delivery checks, then revoke the old password.

If Zoho is unavailable, do not switch a public deployment to `MAIL_PROVIDER=log`: that would expose reset/invitation links to logs and the boot policy correctly rejects it. Roll back to the previous working SMTP secret/provider or temporarily pause workflows that require email. Existing tokens retain their normal expiry and may be resent after service recovery.
