output "media_bucket_name" {
  description = "Railway S3_BUCKET value."
  value       = aws_s3_bucket.media.id
}

output "media_bucket_region" {
  description = "Railway S3_REGION value."
  value       = var.aws_region
}

output "application_iam_user_name" {
  description = "IAM principal for the one-time Railway access key."
  value       = aws_iam_user.application.name
}

output "application_iam_user_arn" {
  description = "IAM principal ARN for access review evidence."
  value       = aws_iam_user.application.arn
}

