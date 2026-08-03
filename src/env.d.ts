/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  SURVEY_TOKEN: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}