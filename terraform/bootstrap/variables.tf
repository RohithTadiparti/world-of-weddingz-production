variable "aws_region" {
  description = "AWS region containing the durable media bucket."
  type        = string
  default     = "ap-south-1"
}

variable "bucket_name" {
  description = "Globally unique private media bucket name."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be a valid 3-63 character S3 bucket name."
  }
}

variable "application_iam_user_name" {
  description = "IAM user whose access key is created out of band and stored only in Railway."
  type        = string
  default     = "wow-railway-media"
}

variable "allowed_web_origins" {
  description = "Exact HTTPS browser origins allowed to use presigned upload/download URLs."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for origin in var.allowed_web_origins : can(regex("^https://[^/]+$", origin))
    ])
    error_message = "Every allowed_web_origins value must be an exact HTTPS origin without a path."
  }
}

variable "noncurrent_version_retention_days" {
  description = "Days to retain superseded versions for recovery. Current objects never expire."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_version_retention_days >= 30
    error_message = "Superseded media versions must be retained for at least 30 days."
  }
}

variable "incomplete_multipart_retention_days" {
  description = "Days before abandoned multipart uploads are removed."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Tags applied to every bootstrap resource."
  type        = map(string)
  default = {
    Application = "world-of-weddingz"
    Environment = "beta"
    ManagedBy   = "terraform"
    DataClass   = "private-user-media"
  }
}

