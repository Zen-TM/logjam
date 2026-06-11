// Composes a Postgres connection string from discrete DB_* env vars.
//
// The DB password lives only in AWS Secrets Manager (RDS-managed secret,
// {"username","password"}). ECS task defs inject DB_USER/DB_PASSWORD via the
// ECS secrets mechanism; the EB API container resolves DB_SECRET_ID into
// DB_USER/DB_PASSWORD at boot (see src/boot.ts). Nothing should read
// DATABASE_URL — compose it here instead.
//
// User and password are URL-encoded because RDS-generated passwords contain
// characters like "!" that are not valid unescaped in a URL.

export interface DatabaseUrlParts {
  host: string;
  port?: number | string;
  name: string;
  user: string;
  password: string;
}

export function composeDatabaseUrl(parts: DatabaseUrlParts): string {
  const { host, name, user, password } = parts;
  const port = parts.port ?? 5432;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

export function databaseUrlFromEnv(): string {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  const missing: string[] = [];
  if (!host) missing.push("DB_HOST");
  if (!name) missing.push("DB_NAME");
  if (!user) missing.push("DB_USER");
  if (!password) missing.push("DB_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for database connection: ${missing.join(", ")}`,
    );
  }

  return composeDatabaseUrl({
    host: host as string,
    port: port ?? 5432,
    name: name as string,
    user: user as string,
    password: password as string,
  });
}
