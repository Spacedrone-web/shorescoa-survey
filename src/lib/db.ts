import { createClient } from '@libsql/client';

export function getDb() {
  const url       = import.meta.env.TURSO_DB_URL;
  const authToken = import.meta.env.TURSO_DB_TOKEN;

  if (!url) {
    throw new Error('TURSO_DB_URL is not set. Copy .env.example to .env and fill in your values.');
  }

  return createClient({ url, authToken });
}