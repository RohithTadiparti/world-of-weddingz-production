# Private S3 media runbook

## Boundary

All non-local deployments store authoritative media in one private S3 bucket in
`ap-south-1`. Database values remain provider-neutral `media://...` references.
The browser receives only short-lived signed PUT/GET URLs. Current objects have
no expiry; versioning and 30-day noncurrent retention provide recovery.

The bootstrap uses SSE-S3 (`AES256`) to avoid a KMS monthly-key charge during
pre-revenue operation. Public ACLs and policies are blocked, object ownership is
bucket-enforced, and the bucket policy denies non-TLS traffic.

## Prerequisites

- AWS account owner enables MFA and supplies a short-lived provisioning role.
- Terraform 1.6+ and AWS provider 6.x are available on the operator machine.
- A protected Terraform state backend is selected. Never commit state or plan
  files. For the first bootstrap, keep local state only on an encrypted operator
  disk, then migrate it to the approved protected backend before team use.
- The final beta frontend origin is known. Do not use `*` for CORS.

## Plan without consuming Railway hosting time

```powershell
Set-Location terraform/bootstrap
Copy-Item terraform.tfvars.example terraform.tfvars
# Edit the globally unique bucket name and exact HTTPS origin.
terraform init
terraform fmt -check
terraform validate
terraform plan -out s3-bootstrap.tfplan
terraform show -json s3-bootstrap.tfplan > s3-bootstrap.plan.json
```

Review the JSON plan. It must contain S3 and IAM resources only—no EKS, RDS,
ElastiCache, NAT gateway, load balancer or IAM access key. Store the reviewed
plan as restricted CI evidence, not in Git.

## Apply and activate

1. Apply the reviewed plan: `terraform apply s3-bootstrap.tfplan`.
2. Confirm public-access block, default AES256 encryption, versioning, lifecycle,
   exact CORS origins and the TLS-deny policy in AWS.
3. Create one access key for the output IAM user using an MFA-protected AWS
   administrator session. Do not display it in chat, tickets, logs or Terraform.
4. Place the values directly in the protected Railway backend service:
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION=ap-south-1`,
   `MEDIA_STORAGE_PROVIDER=s3`, `S3_PRESIGN_EXPIRY=900`, `S3_GET_EXPIRY=3600`.
5. Redeploy the backend and run an upload/download/delete integration cycle with
   a synthetic image. Restart/redeploy the backend between upload and download;
   the object must remain available.
6. Verify anonymous object and bucket requests return 403, a second user cannot
   obtain an authorized read, unsupported content and payloads above 10 MiB fail,
   and signed URLs expire.

## Exact reconciliation

Run read-only reconciliation with the backend dependencies installed:

```powershell
node scripts/storage/reconcile-media.mjs
```

The JSON report compares every `media://` database reference with every bucket
object. `missingObjects` or `orphanObjects` makes the command exit 2. It never
deletes or changes data. Investigate each mismatch; use `--allow-drift` only when
capturing a known-mismatch report, never as a release-gate pass.

## Rotation and rollback

- Rotate by creating a second IAM access key, updating Railway, verifying one
  upload/read cycle, then disabling and deleting the old key. Keep at most two
  keys only during rotation.
- Application rollback changes the backend image, not the bucket. Do not switch
  back to ephemeral mock storage after any real account uploads media.
- If activation fails before real uploads, set the provider back only in the
  disposable test environment and remove its synthetic objects manually.
- `prevent_destroy` intentionally blocks bucket destruction. Recover or migrate
  every current and noncurrent object before any separately reviewed teardown.

## Pending live evidence

S3-001 is not operationally complete until an authorized operator records the
Terraform plan/apply evidence, AWS privacy checks, credential rotation evidence,
redeploy persistence cycle and an exact reconciliation report. Repository tests
validate the contract but cannot prove the remote account state.
