// src/pages/api/symliv-passes.ts
export const prerender = false;

import type { APIContext } from 'astro';

const API_ENDPOINT = 'https://8ftizrpawz.us-east-2.awsapprunner.com/graphql';
const COMMUNITY_ID = 'shoresofpanama';

const API_HEADERS_BASE = {
  'accept': '*/*',
  'content-type': 'application/json',
  'Origin': 'https://client-admin.symliv.com',
  'Referer': 'https://client-admin.symliv.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
};

async function authenticate(email: string, password: string): Promise<string> {
  const mutations = ['loginUser', 'login', 'signIn'];
  for (const mutName of mutations) {
    const body = {
      query: `
        mutation Auth($email: String!, $password: String!, $communityId: String) {
          ${mutName}(email: $email, password: $password, communityId: $communityId) {
            token
            accessToken
          }
        }
      `,
      variables: { email, password, communityId: COMMUNITY_ID },
    };
    try {
      const resp = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: API_HEADERS_BASE,
        body: JSON.stringify(body),
      });
      const json = await resp.json() as any;
      if (json?.errors) continue;
      const payload = json?.data?.[mutName];
      const token = payload?.token ?? payload?.accessToken;
      if (token) return token;
    } catch { continue; }
  }
  throw new Error('Symliv authentication failed — no mutation succeeded.');
}

async function fetchPasses(token: string): Promise<any[]> {
  const query = `
    query GetAllPasses {
      getAllPasses {
        success
        error
        data {
          paid
          status
          startDate
          endDate
          createdAt
          registrationId
          externalCredentialNumber
          communityRental { address }
          userInfo { firstName lastName email }
          passInfo { name }
        }
      }
    }
  `;
  const resp = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { ...API_HEADERS_BASE, authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: {} }),
  });
  const json = await resp.json() as any;
  if (json?.errors) throw new Error(JSON.stringify(json.errors));
  return json?.data?.getAllPasses?.data ?? [];
}

export async function GET({ request, cookies, locals }: APIContext) {
  const adminCookie = cookies.get('admin_auth')?.value;
  if (adminCookie !== 'shores-admin-ok') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const env = (locals as any).runtime?.env ?? {};
  const SYMLIV_EMAIL    = env.SYMLIV_EMAIL    ?? 'jim@shorescoa.com';
  const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD ?? 'Chester12C';

  const url        = new URL(request.url);
  const startBegin = url.searchParams.get('startBegin') ?? '';
  const startEnd   = url.searchParams.get('startEnd')   ?? '';

  try {
    const token  = await authenticate(SYMLIV_EMAIL, SYMLIV_PASSWORD);
    const passes = await fetchPasses(token);

    const filtered = passes.filter((p: any) => {
      const d = (p.startDate ?? '').slice(0, 10);
      if (startBegin && d < startBegin) return false;
      if (startEnd   && d > startEnd)   return false;
      return true;
    });

    const rows = filtered.map((p: any) => ({
      firstName:        p.userInfo?.firstName ?? '',
      lastName:         p.userInfo?.lastName  ?? '',
      email:            p.userInfo?.email     ?? '',
      unit:             p.communityRental?.address ?? '',
      startDate:        (p.startDate ?? '').slice(0, 10),
      endDate:          (p.endDate   ?? '').slice(0, 10),
      passType:         p.passInfo?.name ?? '',
      status:           p.status ?? '',
      paid:             p.paid ?? false,
      registrationId:   p.registrationId ?? '',
      credentialNumber: p.externalCredentialNumber ?? '',
    }));

    return new Response(JSON.stringify({ ok: true, rows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
