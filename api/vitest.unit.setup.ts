// Seed the minimum env that getEnv()/validateEnv() require, so importing any
// module that calls getEnv() at load time (logger, mediaPresign, …) does not
// trip env validation and process.exit(1). Individual tests can override
// process.env before a dynamic import where they need a different shape.
//
// DB_HOST MUST be local: middleware/auth.ts throws at import if AUTH_MODE=fake
// is paired with a non-local DB host.
process.env.NODE_ENV ??= "test";
process.env.AUTH_MODE ??= "fake";
process.env.DB_HOST ??= "localhost";
process.env.DB_PORT ??= "5432";
process.env.DB_NAME ??= "test";
process.env.DB_USER ??= "test";
process.env.DB_PASSWORD ??= "test";
process.env.FAKE_USER_SUB ??= "fake-alice-sub";
process.env.S3_BUCKET_MEDIA ??= "test-media-bucket";
process.env.S3_BUCKET_TOPO ??= "test-topo-bucket";
process.env.AWS_REGION ??= "ap-southeast-2";
process.env.LOG_LEVEL ??= "silent";
