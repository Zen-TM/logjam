# CloudFront distributions (config pinned to live via -generate-config-out).
#   web (E22J79PHZM2K): logjamnsw.com + www — multi-origin, serves the frontend
#     SPA bucket (default behavior) AND topo tiles from logjam-topo-jobs under
#     /master/* (ordered behavior). This is TOPO_CDN_BASE_URL (https://logjamnsw.com).
#   api (E29GLTTDM6CXX4): api.logjamnsw.com — fronts the Elastic Beanstalk API.
#
# The OAC ids (E1WNCNLBS8VU / E23DDV2YT80WV) and the CloudFront-created WAF web
# ACLs are referenced as literals, not managed here (optional later adoption).
# CI only ever invalidates these (not a TF-tracked field), so no ignore_changes
# is needed. prevent_destroy guards the public domains + cert bindings.

resource "aws_cloudfront_distribution" "web" {
  aliases             = ["logjamnsw.com", "www.logjamnsw.com"]
  default_root_object = "index.html"
  enabled             = true
  http_version        = "http2"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_All"
  retain_on_delete    = false
  staging             = false
  tags = {
    Name = "logjam-frontend-distribution"
  }
  wait_for_deployment = true
  web_acl_id          = "arn:aws:wafv2:us-east-1:620853681701:global/webacl/CreatedByCloudFront-1abfc8e5/bf94aa3e-ff2d-4152-9e79-e38f51b04f33"

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    default_ttl                = 0
    max_ttl                    = 0
    min_ttl                    = 0
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
    smooth_streaming           = false
    target_origin_id           = "logjam-frontend-620853681701-ap-southeast-2-an.s3.ap-southeast-2.amazonaws.com-mn1lqt3k67c"
    trusted_key_groups         = []
    trusted_signers            = []
    viewer_protocol_policy     = "redirect-to-https"
    grpc_config {
      enabled = false
    }
  }

  ordered_cache_behavior {
    allowed_methods          = ["GET", "HEAD"]
    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    default_ttl              = 0
    max_ttl                  = 0
    min_ttl                  = 0
    origin_request_policy_id = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
    path_pattern             = "/master/*"
    smooth_streaming         = false
    target_origin_id         = "logjam-topo-jobs.s3.ap-southeast-2.amazonaws.com"
    trusted_key_groups       = []
    trusted_signers          = []
    viewer_protocol_policy   = "redirect-to-https"
    grpc_config {
      enabled = false
    }
  }

  origin {
    connection_attempts      = 3
    connection_timeout       = 10
    domain_name              = "logjam-frontend-620853681701-ap-southeast-2-an.s3.ap-southeast-2.amazonaws.com"
    origin_access_control_id = "E1WNCNLBS8VU"
    origin_id                = "logjam-frontend-620853681701-ap-southeast-2-an.s3.ap-southeast-2.amazonaws.com-mn1lqt3k67c"
  }

  origin {
    connection_attempts      = 3
    connection_timeout       = 10
    domain_name              = "logjam-topo-jobs.s3.ap-southeast-2.amazonaws.com"
    origin_access_control_id = "E23DDV2YT80WV"
    origin_id                = "logjam-topo-jobs.s3.ap-southeast-2.amazonaws.com"
  }

  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = "arn:aws:acm:us-east-1:620853681701:certificate/8dd40670-1feb-46fe-8878-eac0097b0582"
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudfront_distribution" "api" {
  aliases          = ["api.logjamnsw.com"]
  enabled          = true
  http_version     = "http2"
  is_ipv6_enabled  = true
  price_class      = "PriceClass_All"
  retain_on_delete = false
  staging          = false
  tags = {
    Name = "logjam-api-distribution"
  }
  wait_for_deployment = true
  web_acl_id          = "arn:aws:wafv2:us-east-1:620853681701:global/webacl/CreatedByCloudFront-7d98928a/f0fe94a8-5bfa-433e-a66a-0c862e154e6a"

  default_cache_behavior {
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    default_ttl              = 0
    max_ttl                  = 0
    min_ttl                  = 0
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
    smooth_streaming         = false
    target_origin_id         = "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com-mn1lh8nq4kl"
    trusted_key_groups       = []
    trusted_signers          = []
    viewer_protocol_policy   = "redirect-to-https"
    grpc_config {
      enabled = false
    }
  }

  origin {
    connection_attempts = 3
    connection_timeout  = 10
    domain_name         = "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com"
    origin_id           = "logjam-api-prod.eba-iwmwkydz.ap-southeast-2.elasticbeanstalk.com-mn1lh8nq4kl"
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_keepalive_timeout = 5
      origin_protocol_policy   = "http-only"
      origin_read_timeout      = 30
      origin_ssl_protocols     = ["SSLv3", "TLSv1", "TLSv1.1", "TLSv1.2"]
    }
  }

  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = "arn:aws:acm:us-east-1:620853681701:certificate/8dd40670-1feb-46fe-8878-eac0097b0582"
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  lifecycle {
    prevent_destroy = true
  }
}
