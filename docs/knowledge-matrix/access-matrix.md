# Account and access matrix

Never send credentials in chat, commit them, or place them in the Excel tracker. Add them directly to the named platform's secret store.

## GitHub

Required account: repository owner or administrator for `RohithTadiparti/world-of-weddingz-production`.

Required capabilities:

- manage repository settings, collaborators, Actions, environments, secrets and rulesets;
- create issues, branches, pull requests and releases;
- enable Dependabot, CodeQL, secret scanning and push protection;
- configure the `railway-beta`, `aws-rehearsal` and `production` environments;
- create an AWS OIDC trust relationship without storing AWS access keys.

## Railway

Required account: project owner initially; later grant a least-privilege deployer role where the plan permits.

Required capabilities:

- create one project and four services: frontend, backend, PostgreSQL and Redis;
- connect the private GitHub repository;
- manage variables, private networking, volumes, health checks, deploys and rollback;
- view usage/cost and configure soft/hard spending alerts;
- create a project token for GitHub Actions only when deployment automation is enabled;
- attach the production domain only at the final launch gate.

Do not share the account password. Store `RAILWAY_TOKEN`, project ID and service IDs as GitHub environment secrets when needed.

## AWS

Required human access:

- root account retained by the owner with MFA and no routine use;
- an administrator/Identity Center account for one-time account setup;
- billing and budget visibility;
- ability to create IAM roles, GitHub OIDC trust, S3, KMS and budget alarms.

Required machine access:

- `github-bootstrap` role: limited to bootstrap S3/KMS/state/OIDC resources;
- `github-aws-rehearsal` role: Option B rehearsal account/environment;
- `github-production-deploy` role: protected production Terraform/deploy operations;
- Railway runtime IAM principal: only the media bucket/prefix actions required by the application.

Preferred connection is AWS CLI through SSO for humans and GitHub OIDC for automation. Do not create a general-purpose administrator access key.

## DNS/domain

Required account: administrator for the authoritative DNS provider for the production domain.

Required token:

- zone read and DNS edit for the single domain only;
- no account-wide global API key;
- stored in the protected GitHub production environment;
- available only when rehearsal and final cutover workflows run.

The DNS provider and zone ID must be recorded in `access.csv`. The token value must not be recorded.

## Email and integrations

For the current phase, mail, SMS, WhatsApp, push, payment and identity verification remain mock/log providers. Before each is made live, create a separate account, sandbox/production credential pair, webhook secret, allowed-origin/IP policy, budget limit, owner and incident contact.

## Access handover checklist

- Named human owner exists.
- MFA is enabled.
- Least privilege role/token exists.
- Secret is stored in the platform secret store.
- Expiry/rotation date is known.
- Recovery contact exists.
- Access was verified without printing the secret.
- Removal procedure is documented.
