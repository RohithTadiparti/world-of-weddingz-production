# Security policy

Report vulnerabilities through the repository's private security-advisory form. Do not create an ordinary issue containing exploit details, credentials or personal information.

Supported production work is tracked on `main`. Public beta and release candidates are not approved while any P0 security gate remains open.

Never commit secrets. If a credential is exposed, revoke or rotate it first, then remove it from the current tree and investigate history and logs. Deleting the text alone is not remediation.
