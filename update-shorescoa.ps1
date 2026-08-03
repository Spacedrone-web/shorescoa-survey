# ============================================================
#  ShoreSCOA Survey – Update Script (Netlify → Cloudflare D1)
#  Run from: D:\shorescoa-survey
#  Usage: PowerShell -ExecutionPolicy Bypass -File update-shorescoa.ps1
# ============================================================

$root = "D:\shorescoa-survey"
Set-Location $root

function Write-ProjectFile($path, $content) {
    $full = Join-Path $root $path
    $dir  = Split-Path $full -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($full, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  updated: $path"
}

# ── Remove Netlify/Turso files ────────────────────────────────
$toDelete = @("netlify.toml", "setup-db.js", "src\lib\db.ts")
foreach ($f in $toDelete) {
    $fp = Join-Path $root $f
    if (Test-Path $fp) { Remove-Item $fp -Force; Write-Host "  deleted: $f" }
}

# ── package.json ─────────────────────────────────────────────
Write-ProjectFile "package.json" @'
{
  "name": "shorescoa-survey",
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "@astrojs/cloudflare": "^12.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "astro": "^5.0.0"
  }
}
'@

# ── astro.config.mjs ─────────────────────────────────────────
Write-ProjectFile "astro.config.mjs" @'
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
});
'@

# ── wrangler.toml ────────────────────────────────────────────
Write-ProjectFile "wrangler.toml" @'
name = "shorescoa-survey"
compatibility_date = "2024-09-23"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "shorescoa_survey"
database_id = "REPLACE_WITH_YOUR_DATABASE_ID"
'@

# ── src/env.d.ts ─────────────────────────────────────────────
Write-ProjectFile "src/env.d.ts" @'
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
'@

# ── src/pages/api/survey.ts ──────────────────────────────────
Write-ProjectFile "src/pages/api/survey.ts" @'
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  try {
    const data = await request.formData();

    const get    = (key: string) => (data.get(key) as string | null) ?? '';
    const getInt = (key: string) => {
      const v = parseInt(get(key), 10);
      return isNaN(v) ? null : v;
    };

    const env = (locals as any).runtime?.env;
    const db  = env?.DB;

    if (!db) {
      console.error('D1 binding "DB" not found. Check wrangler.toml and Cloudflare Pages bindings.');
      return new Response('Database not configured.', { status: 500 });
    }

    await db.prepare(`
      INSERT INTO survey_responses (
        arrival_date, departure_date, unit_number,
        q1_purpose,
        q2_registration, q2_packet, q2_concierge, q2_patrol,
        q3_concierge, q3_patrol, q3_cac, q3_maintenance,
        q4_indoorpoolarea, q4_indoorpool, q4_indoorhottub,
        q4_outdoorpoolarea, q4_outdoorpool, q4_outdoorhottub,
        q4_lobby, q4_elevators, q4_restrooms, q4_garage, q4_stairs,
        q5_overall,
        q6_recommend, q6_comments,
        submitted_at
      ) VALUES (
        ?, ?, ?,
        ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?,
        datetime('now')
      )
    `).bind(
      get('arrival_date'), get('departure_date'), get('unit_number'),
      get('q1_purpose'),
      getInt('q2_registration'), getInt('q2_packet'), getInt('q2_concierge'), getInt('q2_patrol'),
      getInt('q3_concierge'), getInt('q3_patrol'), getInt('q3_cac'), getInt('q3_maintenance'),
      getInt('q4_indoorpoolarea'), getInt('q4_indoorpool'), getInt('q4_indoorhottub'),
      getInt('q4_outdoorpoolarea'), getInt('q4_outdoorpool'), getInt('q4_outdoorhottub'),
      getInt('q4_lobby'), getInt('q4_elevators'), getInt('q4_restrooms'), getInt('q4_garage'), getInt('q4_stairs'),
      getInt('q5_overall'),
      get('q6_recommend'), get('q6_comments'),
    ).run();

    return redirect('/thankyou', 302);
  } catch (err) {
    console.error('Survey submission error:', err);
    return new Response('An error occurred while saving your response. Please try again.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
};
'@

Write-Host ""
Write-Host "All files updated. Now committing and pushing..."
Write-Host ""

git add -A
git commit -m "Switch to Cloudflare Pages adapter and D1 database"
git push

Write-Host ""
Write-Host "Done! Check GitHub to confirm the push."
