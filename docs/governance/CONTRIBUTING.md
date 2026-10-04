# Contributing

- Work from a linked issue and one identified open item.
- Use a short-lived `codex/` branch and a pull request.
- Never push directly to `main` after protection is enabled.
- Add tests before implementation for behavior changes.
- Do not commit credentials, production data, `.env` files, cloud state, logs, Playwright traces or local artifacts.
- Update requirements, tests, risks, documents and PR handoff registers when affected.
- Required CI and security checks must pass before merge.
- Use squash merge unless preserving a deliberately structured migration history is justified in the PR.
