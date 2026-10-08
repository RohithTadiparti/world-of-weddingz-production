resource "aws_iam_user" "application" {
  name = var.application_iam_user_name
  path = "/world-of-weddingz/"
}

data "aws_iam_policy_document" "application_media" {
  statement {
    sid       = "ListApplicationPrefixes"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["users/*", "vendors/*", "bookings/*"]
    }
  }

  statement {
    sid    = "ManageApplicationMediaObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "${aws_s3_bucket.media.arn}/users/*",
      "${aws_s3_bucket.media.arn}/vendors/*",
      "${aws_s3_bucket.media.arn}/bookings/*",
    ]
  }
}

resource "aws_iam_user_policy" "application_media" {
  name   = "wow-private-media-object-access"
  user   = aws_iam_user.application.name
  policy = data.aws_iam_policy_document.application_media.json
}

# Deliberately no access-key resource: a generated secret would be
# written to Terraform state. Create one key only at activation time and place
# it directly in Railway's protected variable store.
