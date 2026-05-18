#!/bin/bash
# Runs inside LocalStack container on startup via /etc/localstack/init/ready.d/
# Creates S3 buckets and SQS queue needed for local dev.
set -e

echo "Seeding LocalStack resources..."

awslocal s3 mb s3://logjam-media-local --region ap-southeast-2
awslocal s3 mb s3://logjam-topo-local --region ap-southeast-2

awslocal sqs create-queue \
  --queue-name logjam-topo-jobs-local \
  --region ap-southeast-2

echo "LocalStack seed complete."
