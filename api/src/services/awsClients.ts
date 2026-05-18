import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { SESClient } from "@aws-sdk/client-ses";

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const sesRegion = process.env.COGNITO_REGION ?? region;
const endpoint = process.env.AWS_ENDPOINT_URL;

export const s3 = new S3Client({
  region,
  ...(endpoint && { endpoint, forcePathStyle: true }),
});

export const sqs = new SQSClient({
  region,
  ...(endpoint && { endpoint }),
});

export const ecs = new ECSClient({
  region,
  ...(endpoint && { endpoint }),
});

export const ses = new SESClient({
  region: sesRegion,
  ...(endpoint && { endpoint }),
});
