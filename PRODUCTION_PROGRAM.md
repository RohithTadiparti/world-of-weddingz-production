# World of Weddingz production program

This repository is the production delivery line for World of Weddingz. It is temporarily public so GitHub's free branch-protection and native security controls can be enforced. It starts from the committed source snapshot `07218b4ab02a8702a4d8d9fdab7dc26e579ab7b4` from `RohithTadiparti/WOW-MD` and intentionally has new Git history.

The application source remains recognizable, but production work follows the governance in `docs/governance/`. The canonical program registers live in `docs/tracking/registers/`. The Excel tracker is a generated management view, not the authoritative record.

## Deployment sequence

1. Close public-beta security and operability gates.
2. Centralize non-secret configuration and keep secrets outside Git.
3. Provision private S3 for real media.
4. Prepare and test Railway without attaching the production domain.
5. Add capacity alerts, the admin infrastructure portal and mock migration.
6. Rehearse AWS Option B and rollback.
7. Attach the production domain to Railway only at the final launch gate.
8. Migrate to AWS later through the protected admin action when commercial or technical thresholds require it.

Start with `docs/knowledge-matrix/README.md` and `docs/tracking/registers/open-items.csv`.
