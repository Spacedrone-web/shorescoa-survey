export const prerender = false;
import type { APIContext } from "astro";

const SMTP_HOST  = "server1.shorescoa.com";
const SMTP_PORT  = 465;
const SMTP_USER  = "survey@shorescoa.com";
const SMTP_PASS  = "Shores9900!!";
const SURVEY_URL = "https://survey.shorescoa.com/go";

async function smtpSend(to: string, subject: string, body: string): Promise<void> {
  // @ts-ignore — cloudflare:sockets is available at runtime in CF Pages/Workers
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";

  async function readLine(): Promise<string> {
    while (true) {
      const i = buf.indexOf("\n");
      if (i !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("SMTP connection closed unexpectedly");
      buf += dec.decode(value, { stream: true });
    }
  }

  async function readResp(): Promise<string> {
    let last = "";
    while (true) {
      last = await readLine();
      if (last.length < 4 || last[3] !== "-") break;
    }
    return last;
  }

  async function cmd(line: string): Promise<string> {
    await writer.write(enc.encode(line + "\r\n"));
    return readResp();
  }

  try {
    await readResp();                                     // 220 greeting
    await cmd("EHLO shorescoa.com");                      // handshake
    await cmd("AUTH LOGIN");                              // start auth
    await cmd(btoa(SMTP_USER));                           // base64 username
    const ar = await cmd(btoa(SMTP_PASS));                // base64 password
    if (!ar.startsWith("235")) throw new Error("SMTP auth failed: " + ar);

    await cmd(`MAIL FROM:<${SMTP_USER}>`);
    const rr = await cmd(`RCPT TO:<${to}>`);
    if (!rr.startsWith("250")) throw new Error("Recipient rejected: " + rr);

    await cmd("DATA");

    const msg = [
      `Date: ${new Date().toUTCString()}`,
      `From: Shores of Panama COA <${SMTP_USER}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
      ".",
    ].join("\r\n") + "\r\n";

    await writer.write(enc.encode(msg));
    const dr = await readResp();
    if (!dr.startsWith("250")) throw new Error("DATA rejected: " + dr);

    await cmd("QUIT");
  } finally {
    try { writer.releaseLock(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { (socket as any).close(); } catch {}
  }
}

export async function POST({ request, cookies }: APIContext) {
  const j = (d: any, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

  if (cookies.get("admin_auth")?.value !== "shores-admin-ok")
    return j({ ok: false, error: "Unauthorized" }, 401);

  try {
    const { to, guestName, isTest } = (await request.json()) as {
      to: string; guestName?: string; isTest?: boolean;
    };
    if (!to) return j({ ok: false, error: "Missing recipient" }, 400);

    const name    = guestName || "Guest";
    const subject = (isTest ? "[TEST] " : "") + "Shores of Panama \u2013 We\u2019d Love Your Feedback!";
    const body    = (isTest ? "[THIS IS A TEST EMAIL \u2014 PLEASE IGNORE]\n\n" : "")
      + `Dear ${name},\n\n`
      + `Thank you for staying at Shores of Panama! We hope you had a wonderful visit.\n\n`
      + `We would love to hear about your experience. Please take a moment to complete our brief guest survey:\n\n`
      + `${SURVEY_URL}\n\n`
      + `Your feedback helps us continue to improve the property and services for all guests.\n\n`
      + `Thank you,\nShores of Panama COA`;

    await smtpSend(to, subject, body);
    return j({ ok: true });
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
