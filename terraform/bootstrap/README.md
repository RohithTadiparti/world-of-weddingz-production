# Private media bootstrap

This isolated Terraform root creates only the durable S3 media boundary and its
least-privilege Railway IAM user. It deliberately does not load the AWS Option B
root in `terraform/`, so planning it cannot create EKS, Aurora, Redis, NAT or
load-balancer resources.

No IAM access key is created by Terraform because that would persist the secret
in state. Follow `docs/runbooks/s3-media.md` for planning, activation,
verification and rollback.

