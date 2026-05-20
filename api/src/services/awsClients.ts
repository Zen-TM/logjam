import { S3Client } from "@aws-sdk/client-s3";
import { ECSClient } from "@aws-sdk/client-ecs";
import { SESClient } from "@aws-sdk/client-ses";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const region = process.env.AWS_REGION ?? "ap-southeast-2";
const sesRegion = process.env.COGNITO_REGION ?? region;
const endpoint = process.env.AWS_ENDPOINT_URL;

export const s3 = new S3Client({
  region,
  ...(endpoint && { endpoint, forcePathStyle: true }),
});

export const ecs = new ECSClient({
  region,
  ...(endpoint && { endpoint }),
});

export const ses = new SESClient({
  region: sesRegion,
  ...(endpoint && { endpoint }),
});

const cognitoRegion = process.env.COGNITO_REGION ?? region;
export const cognitoIdp = new CognitoIdentityProviderClient({
  region: cognitoRegion,
  ...(endpoint && { endpoint }),
});
