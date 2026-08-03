# ============================================================
#  ShoreSCOA Survey – Bootstrap Script
#  Run from: D:\shorescoa-survey  (must be empty)
#  Usage: PowerShell -ExecutionPolicy Bypass -File bootstrap-shorescoa.ps1
# ============================================================

$root = "D:\shorescoa-survey"
Set-Location $root

function Write-ProjectFile($path, $content) {
    $full = Join-Path $root $path
    $dir  = Split-Path $full -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($full, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  created: $path"
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
    "astro": "astro",
    "setup-db": "node setup-db.js"
  },
  "dependencies": {
    "@astrojs/netlify": "^6.0.0",
    "@libsql/client": "^0.14.0",
    "astro": "^5.0.0",
    "dotenv": "^16.4.0"
  }
}
'@

# ── astro.config.mjs ─────────────────────────────────────────
Write-ProjectFile "astro.config.mjs" @'
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  output: 'server',
  adapter: netlify(),
});
'@

# ── tsconfig.json ────────────────────────────────────────────
Write-ProjectFile "tsconfig.json" @'
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
'@

# ── netlify.toml ─────────────────────────────────────────────
Write-ProjectFile "netlify.toml" @'
[build]
  command = "npm run build"
  publish = "dist"
'@

# ── .gitignore ───────────────────────────────────────────────
Write-ProjectFile ".gitignore" @'
.env
dist/
.astro/
.netlify/
node_modules/
.DS_Store
Thumbs.db
'@

# ── .env.example ─────────────────────────────────────────────
Write-ProjectFile ".env.example" @'
SURVEY_TOKEN=replace-with-a-strong-random-secret
TURSO_DB_URL=libsql://your-database-name.turso.io
TURSO_DB_TOKEN=your-turso-auth-token-here
'@

# ── setup-db.js ──────────────────────────────────────────────
Write-ProjectFile "setup-db.js" @'
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS survey_responses (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at        TEXT DEFAULT (datetime('now')),
    arrival_date        TEXT,
    departure_date      TEXT,
    unit_number         TEXT,
    q1_purpose          TEXT,
    q2_registration     INTEGER,
    q2_packet           INTEGER,
    q2_concierge        INTEGER,
    q2_patrol           INTEGER,
    q3_concierge        INTEGER,
    q3_patrol           INTEGER,
    q3_cac              INTEGER,
    q3_maintenance      INTEGER,
    q4_indoorpoolarea   INTEGER,
    q4_indoorpool       INTEGER,
    q4_indoorhottub     INTEGER,
    q4_outdoorpoolarea  INTEGER,
    q4_outdoorpool      INTEGER,
    q4_outdoorhottub    INTEGER,
    q4_lobby            INTEGER,
    q4_elevators        INTEGER,
    q4_restrooms        INTEGER,
    q4_garage           INTEGER,
    q4_stairs           INTEGER,
    q5_overall          INTEGER,
    q6_recommend        TEXT,
    q6_comments         TEXT
  )
`);

console.log('survey_responses table created successfully.');
db.close();
'@

# ── src/middleware.ts ─────────────────────────────────────────
Write-ProjectFile "src/middleware.ts" @'
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname === '/' || pathname === '') {
    const SURVEY_TOKEN = import.meta.env.SURVEY_TOKEN;

    if (!SURVEY_TOKEN) {
      return next();
    }

    const urlToken    = context.url.searchParams.get('token');
    const cookieToken = context.cookies.get('survey_auth')?.value;

    if (urlToken === SURVEY_TOKEN) {
      context.cookies.set('survey_auth', SURVEY_TOKEN, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      return next();
    } else if (cookieToken === SURVEY_TOKEN) {
      return next();
    } else {
      return context.redirect('/denied');
    }
  }

  return next();
});
'@

# ── src/lib/db.ts ────────────────────────────────────────────
Write-ProjectFile "src/lib/db.ts" @'
import { createClient } from '@libsql/client';

export function getDb() {
  const url       = import.meta.env.TURSO_DB_URL;
  const authToken = import.meta.env.TURSO_DB_TOKEN;

  if (!url) {
    throw new Error('TURSO_DB_URL is not set. Copy .env.example to .env and fill in your values.');
  }

  return createClient({ url, authToken });
}
'@

# ── src/pages/api/survey.ts ──────────────────────────────────
Write-ProjectFile "src/pages/api/survey.ts" @'
import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const data = await request.formData();

    const get    = (key: string) => (data.get(key) as string | null) ?? '';
    const getInt = (key: string) => {
      const v = parseInt(get(key), 10);
      return isNaN(v) ? null : v;
    };

    const db = getDb();

    await db.execute({
      sql: `INSERT INTO survey_responses (
        arrival_date, departure_date, unit_number,
        q1_purpose,
        q2_registration, q2_packet, q2_concierge, q2_patrol,
        q3_concierge, q3_patrol, q3_cac, q3_maintenance,
        q4_indoorpoolarea, q4_indoorpool, q4_indoorhottub,
        q4_outdoorpoolarea, q4_outdoorpool, q4_outdoorhottub,
        q4_lobby, q4_elevators, q4_restrooms, q4_garage, q4_stairs,
        q5_overall,
        q6_recommend, q6_comments
      ) VALUES (
        ?, ?, ?,
        ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?
      )`,
      args: [
        get('arrival_date'), get('departure_date'), get('unit_number'),
        get('q1_purpose'),
        getInt('q2_registration'), getInt('q2_packet'), getInt('q2_concierge'), getInt('q2_patrol'),
        getInt('q3_concierge'), getInt('q3_patrol'), getInt('q3_cac'), getInt('q3_maintenance'),
        getInt('q4_indoorpoolarea'), getInt('q4_indoorpool'), getInt('q4_indoorhottub'),
        getInt('q4_outdoorpoolarea'), getInt('q4_outdoorpool'), getInt('q4_outdoorhottub'),
        getInt('q4_lobby'), getInt('q4_elevators'), getInt('q4_restrooms'), getInt('q4_garage'), getInt('q4_stairs'),
        getInt('q5_overall'),
        get('q6_recommend'), get('q6_comments'),
      ],
    });

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

# ── src/pages/thankyou.astro ─────────────────────────────────
Write-ProjectFile "src/pages/thankyou.astro" @'
---
export const prerender = false;
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Thank You – Shores of Panama</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #f0f4f8; min-height: 100vh;
        display: flex; align-items: center; justify-content: center; padding: 1.5rem;
      }
      .card {
        background: #fff; border-radius: 14px;
        box-shadow: 0 2px 20px rgba(0,0,0,.09);
        padding: 3rem 2.5rem; max-width: 480px; width: 100%; text-align: center;
      }
      .icon { font-size: 3.5rem; margin-bottom: 1.25rem; }
      h1 { font-size: 1.7rem; font-weight: 800; color: #1a4f7a; margin-bottom: .6rem; }
      p { color: #4a5568; font-size: 1rem; line-height: 1.6; margin-bottom: .75rem; }
      .divider { border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
      .subtext { font-size: .85rem; color: #718096; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">🌊</div>
      <h1>Thank You!</h1>
      <p>Your feedback has been submitted successfully.<br />
         We truly appreciate you taking the time to share your experience at
         <strong>Shores of Panama</strong>.</p>
      <hr class="divider" />
      <p class="subtext">Your responses help us continue improving our facilities and service
         for every guest. We hope to see you again soon!</p>
    </div>
  </body>
</html>
'@

# ── src/pages/denied.astro ───────────────────────────────────
Write-ProjectFile "src/pages/denied.astro" @'
---
export const prerender = false;
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Access Restricted – Shores of Panama</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #f0f4f8; min-height: 100vh;
        display: flex; align-items: center; justify-content: center; padding: 1.5rem;
      }
      .card {
        background: #fff; border-radius: 14px;
        box-shadow: 0 2px 20px rgba(0,0,0,.09);
        padding: 3rem 2.5rem; max-width: 420px; width: 100%; text-align: center;
      }
      .icon { font-size: 3rem; margin-bottom: 1rem; }
      h1 { font-size: 1.5rem; font-weight: 800; color: #c53030; margin-bottom: .6rem; }
      p { color: #4a5568; font-size: .95rem; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">🔒</div>
      <h1>Access Restricted</h1>
      <p>This survey is only accessible via the QR code provided at check-in.
         Please scan the QR code at the front desk to access the survey.</p>
    </div>
  </body>
</html>
'@

# ── src/pages/index.astro ────────────────────────────────────
Write-ProjectFile "src/pages/index.astro" @'
---
export const prerender = false;
---
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Shores of Panama – Guest Survey</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f0f4f8; color: #2d3748; padding: 1.5rem 1rem 3rem; }
      .container { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.08); overflow: hidden; }
      .header { background: linear-gradient(135deg, #1a4f7a, #2e86c1); color: #fff; padding: 2rem 2rem 1.5rem; text-align: center; }
      .header h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .4rem; }
      .header p  { font-size: .95rem; opacity: .88; }
      form { padding: 1.75rem 2rem 2rem; }
      .stay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
      @media (max-width: 480px) { .stay-grid { grid-template-columns: 1fr; } }
      .field label { display: block; font-size: .82rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #4a5568; margin-bottom: .35rem; }
      .field input[type="date"], .field input[type="text"] { width: 100%; padding: .55rem .75rem; border: 1.5px solid #cbd5e0; border-radius: 6px; font-size: .95rem; transition: border-color .15s; }
      .field input:focus { outline: none; border-color: #2e86c1; }
      .section { margin-bottom: 1.75rem; }
      .section-title { font-size: 1rem; font-weight: 700; color: #1a4f7a; border-bottom: 2px solid #bee3f8; padding-bottom: .4rem; margin-bottom: 1rem; }
      .purpose-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
      @media (max-width: 400px) { .purpose-grid { grid-template-columns: 1fr; } }
      .purpose-option { display: flex; align-items: center; gap: .5rem; padding: .6rem .85rem; border: 1.5px solid #cbd5e0; border-radius: 7px; cursor: pointer; transition: border-color .15s, background .15s; font-size: .9rem; }
      .purpose-option:has(input:checked) { border-color: #2e86c1; background: #ebf8ff; }
      .purpose-option input { accent-color: #2e86c1; width: 16px; height: 16px; }
      .rating-row { display: flex; align-items: center; justify-content: space-between; padding: .65rem 0; border-bottom: 1px solid #edf2f7; gap: .5rem; flex-wrap: wrap; }
      .rating-row:last-child { border-bottom: none; }
      .rating-label { font-size: .9rem; font-weight: 500; flex: 1 1 140px; }
      .rating-buttons { display: flex; gap: .3rem; }
      .rating-buttons label { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; }
      .rating-buttons label span { font-size: .7rem; color: #718096; font-weight: 500; }
      .rating-buttons input[type="radio"] { appearance: none; width: 36px; height: 36px; border: 2px solid #cbd5e0; border-radius: 50%; cursor: pointer; position: relative; transition: border-color .15s, background .15s; display: flex; align-items: center; justify-content: center; }
      .rating-buttons input[type="radio"]::after { content: attr(data-val); position: absolute; font-size: .8rem; font-weight: 600; color: #4a5568; }
      .rating-buttons input[type="radio"]:checked { background: #2e86c1; border-color: #2e86c1; }
      .rating-buttons input[type="radio"]:checked::after { color: #fff; }
      .recommend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .5rem; }
      .recommend-option { display: flex; align-items: center; gap: .45rem; padding: .6rem .85rem; border: 1.5px solid #cbd5e0; border-radius: 7px; cursor: pointer; font-size: .88rem; transition: border-color .15s, background .15s; }
      .recommend-option:has(input:checked) { border-color: #2e86c1; background: #ebf8ff; }
      .recommend-option input { accent-color: #2e86c1; width: 15px; height: 15px; flex-shrink: 0; }
      textarea { width: 100%; border: 1.5px solid #cbd5e0; border-radius: 6px; padding: .65rem .75rem; font-size: .9rem; resize: vertical; min-height: 80px; font-family: inherit; margin-top: .75rem; }
      textarea:focus { outline: none; border-color: #2e86c1; }
      .submit-btn { display: block; width: 100%; padding: .9rem; background: #2e86c1; color: #fff; font-size: 1rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; margin-top: 1.5rem; transition: background .15s; letter-spacing: .02em; }
      .submit-btn:hover { background: #1a6fa8; }
      .rating-scale-hint { font-size: .72rem; color: #718096; margin-bottom: .5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Shores of Panama</h1>
        <p>Guest Experience Survey &mdash; Thank you for staying with us!</p>
      </div>
      <form method="post" action="/api/survey">
        <div class="stay-grid">
          <div class="field">
            <label for="arrival_date">Arrival Date</label>
            <input type="date" id="arrival_date" name="arrival_date" required />
          </div>
          <div class="field">
            <label for="departure_date">Departure Date</label>
            <input type="date" id="departure_date" name="departure_date" required />
          </div>
          <div class="field">
            <label for="unit_number">Unit Number</label>
            <input type="text" id="unit_number" name="unit_number" placeholder="e.g. 1204" required />
          </div>
        </div>
        <div class="section">
          <div class="section-title">1. Purpose of Visit</div>
          <div class="purpose-grid">
            <label class="purpose-option"><input type="radio" name="q1_purpose" value="Vacation / Leisure" required /> Vacation / Leisure</label>
            <label class="purpose-option"><input type="radio" name="q1_purpose" value="Special Occasion" /> Special Occasion</label>
            <label class="purpose-option"><input type="radio" name="q1_purpose" value="Business" /> Business</label>
            <label class="purpose-option"><input type="radio" name="q1_purpose" value="Family Gathering" /> Family Gathering</label>
            <label class="purpose-option"><input type="radio" name="q1_purpose" value="Other" /> Other</label>
          </div>
        </div>
        <div class="section">
          <div class="section-title">2. Registration Experience</div>
          <p class="rating-scale-hint">1 = Poor &bull; 5 = Excellent</p>
          <div class="rating-row">
            <span class="rating-label">Registration Process</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q2_registration" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q2_registration" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q2_registration" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q2_registration" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q2_registration" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Welcome Packet</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q2_packet" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q2_packet" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q2_packet" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q2_packet" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q2_packet" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Concierge Desk</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q2_concierge" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q2_concierge" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q2_concierge" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q2_concierge" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q2_concierge" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Security Patrol</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q2_patrol" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q2_patrol" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q2_patrol" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q2_patrol" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q2_patrol" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">3. Staff Ratings</div>
          <p class="rating-scale-hint">1 = Poor &bull; 5 = Excellent</p>
          <div class="rating-row">
            <span class="rating-label">Concierge</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q3_concierge" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q3_concierge" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q3_concierge" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q3_concierge" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q3_concierge" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Patrol</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q3_patrol" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q3_patrol" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q3_patrol" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q3_patrol" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q3_patrol" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">CAC Staff</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q3_cac" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q3_cac" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q3_cac" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q3_cac" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q3_cac" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Maintenance</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q3_maintenance" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q3_maintenance" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q3_maintenance" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q3_maintenance" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q3_maintenance" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">4. Facility Ratings</div>
          <p class="rating-scale-hint">1 = Poor &bull; 5 = Excellent</p>
          <div class="rating-row">
            <span class="rating-label">Indoor Pool Area</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_indoorpoolarea" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_indoorpoolarea" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_indoorpoolarea" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_indoorpoolarea" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_indoorpoolarea" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Indoor Pool</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_indoorpool" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_indoorpool" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_indoorpool" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_indoorpool" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_indoorpool" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Indoor Hot Tub</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_indoorhottub" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_indoorhottub" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_indoorhottub" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_indoorhottub" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_indoorhottub" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Outdoor Pool Area</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_outdoorpoolarea" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_outdoorpoolarea" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpoolarea" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpoolarea" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpoolarea" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Outdoor Pool</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_outdoorpool" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_outdoorpool" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpool" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpool" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_outdoorpool" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Outdoor Hot Tub</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_outdoorhottub" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_outdoorhottub" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_outdoorhottub" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_outdoorhottub" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_outdoorhottub" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Lobby</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_lobby" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_lobby" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_lobby" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_lobby" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_lobby" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Elevators</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_elevators" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_elevators" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_elevators" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_elevators" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_elevators" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Restrooms</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_restrooms" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_restrooms" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_restrooms" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_restrooms" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_restrooms" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Parking Garage</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_garage" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_garage" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_garage" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_garage" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_garage" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
          <div class="rating-row">
            <span class="rating-label">Stairwells</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q4_stairs" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q4_stairs" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q4_stairs" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q4_stairs" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q4_stairs" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">5. Overall Experience</div>
          <p class="rating-scale-hint">1 = Poor &bull; 5 = Excellent</p>
          <div class="rating-row">
            <span class="rating-label">Overall Rating</span>
            <div class="rating-buttons">
              <label><input type="radio" name="q5_overall" value="1" data-val="1" required /><span>Poor</span></label>
              <label><input type="radio" name="q5_overall" value="2" data-val="2" /><span></span></label>
              <label><input type="radio" name="q5_overall" value="3" data-val="3" /><span></span></label>
              <label><input type="radio" name="q5_overall" value="4" data-val="4" /><span></span></label>
              <label><input type="radio" name="q5_overall" value="5" data-val="5" /><span>Excellent</span></label>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">6. Would You Recommend Shores of Panama?</div>
          <div class="recommend-grid">
            <label class="recommend-option"><input type="radio" name="q6_recommend" value="Yes, definitely" required /> Yes, definitely</label>
            <label class="recommend-option"><input type="radio" name="q6_recommend" value="Probably yes" /> Probably yes</label>
            <label class="recommend-option"><input type="radio" name="q6_recommend" value="Not sure" /> Not sure</label>
            <label class="recommend-option"><input type="radio" name="q6_recommend" value="Probably not" /> Probably not</label>
            <label class="recommend-option"><input type="radio" name="q6_recommend" value="No" /> No</label>
          </div>
          <textarea name="q6_comments" placeholder="Any additional comments or suggestions? (optional)"></textarea>
        </div>
        <button type="submit" class="submit-btn">Submit Survey</button>
      </form>
    </div>
  </body>
</html>
'@

Write-Host ""
Write-Host "All files written successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next: run these commands to init git and push to GitHub" -ForegroundColor Cyan
Write-Host "  git init"
Write-Host "  git add -A"
Write-Host '  git commit -m "Initial commit - survey site"'
Write-Host "  git branch -M main"
Write-Host "  git remote add origin https://YOUR_USERNAME@github.com/YOUR_USERNAME/shorescoa-survey.git"
Write-Host "  git push -u origin main"
