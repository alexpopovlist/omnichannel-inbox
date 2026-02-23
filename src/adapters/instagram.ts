import { NormalizedMessage } from "../types.js";
import { env } from "../env.js";
import * as crypto from "crypto";

/**
 * Validate Meta webhook signature (X-Hub-Signature-256: "sha256=<hex>")
 * Uses INSTAGRAM_APP_SECRET. If secret is empty, validation can be skipped by the caller.
 */
export function verifyInstagramSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!env.INSTAGRAM_APP_SECRET) return true;
  if (!signatureHeader) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const their = signatureHeader.slice(prefix.length).trim();

  const ours = crypto
    .createHmac("sha256", env.INSTAGRAM_APP_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  // constant-time compare
  try {
    return crypto.timingSafeEqual(Buffer.from(ours, "hex"), Buffer.from(their, "hex"));
  } catch {
    return false;
  }
}

/**
 * Send Instagram DM via Meta Graph API (Messenger API for Instagram).
 * Requires INSTAGRAM_PAGE_ACCESS_TOKEN.
 * recipientId is usually the incoming webhook sender.id (IGSID/PSID).
 */
export async function instagramSendMessage(recipientId: string, text: string) {
  if (!env.INSTAGRAM_PAGE_ACCESS_TOKEN) {
    throw new Error("INSTAGRAM_PAGE_ACCESS_TOKEN is not set");
  }
  if (!env.INSTAGRAM_PAGE_COMPANY_ID) {
    throw new Error("INSTAGRAM_PAGE_COMPANY_ID is not set");
  }
  const version = env.META_GRAPH_VERSION || "v25.0";
  // Requested endpoint:
  // POST https://graph.facebook.com/v25.0/<INSTAGRAM_PAGE_COMPANY_ID>/messages
  // JSON body: { recipient:{id}, message:{text} }
  // access_token passed as urlencoded/query param
  const url = new URL(`https://graph.facebook.com/${version}/${env.INSTAGRAM_PAGE_COMPANY_ID}/messages`);
  url.searchParams.set("access_token", env.INSTAGRAM_PAGE_ACCESS_TOKEN);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram sendMessage failed: ${res.status} ${body}`);
  }
  return res.json();
}


/**
 * Instagram webhook verification:
 * GET /webhooks/instagram?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
export function verifyInstagramChallenge(query: Record<string, any>) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (!env.INSTAGRAM_VERIFY_TOKEN) return { ok: false, status: 500, body: "INSTAGRAM_VERIFY_TOKEN not set" };
  if (mode === "subscribe" && token === env.INSTAGRAM_VERIFY_TOKEN) {
    return { ok: true, status: 200, body: String(challenge ?? "") };
  }
  return { ok: false, status: 403, body: "Forbidden" };
}

/**
 * NOTE: This is a starter parser. Instagram / Meta payload formats vary depending on product
 * (Messenger API for Instagram, Instagram Graph API, etc.). You should adjust this function
 * based on the exact webhook "object" and "fields" you subscribe to.
 *
 * For now, we store raw events as messageType "raw_event" so you can start collecting data immediately,
 * then iterate on proper normalization.
 */
export function normalizeInstagramEvent(body: any): NormalizedMessage[] {
  // Try best-effort extraction for common "messaging" pattern.
  const out: NormalizedMessage[] = [];

  const now = new Date();

  // If we can detect messaging events:
  const entries = body?.entry;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      const messaging = e?.messaging;
      if (Array.isArray(messaging)) {
        for (const m of messaging) {
          const senderId = String(m?.sender?.id ?? "unknown");
          const recipientId = String(m?.recipient?.id ?? "unknown");
          const timestamp = m?.timestamp ? new Date(m.timestamp) : now;
          const text = m?.message?.text ?? null;

          const threadId = `${senderId}:${recipientId}`;

          out.push({
            channel: "instagram",
            accountName: "main",
            externalAccountId: recipientId,

            externalThreadId: threadId,
            externalUserId: senderId,
            username: null,
            phone: null,

            externalMessageId: `ig:${senderId}:${m?.message?.mid ?? m?.timestamp ?? String(Math.random())}`,
            direction: "inbound",
            messageType: text ? "text" : "raw_event",
            text,
            payload: { raw: m },
            sentAt: timestamp,
          });
        }
      }
    }
  }

  // Fallback: store the whole event
  if (out.length === 0) {
    out.push({
      channel: "instagram",
      accountName: "main",
      externalAccountId: null,

      externalThreadId: "unknown",
      externalUserId: "unknown",
      username: null,
      phone: null,

      externalMessageId: `ig:raw:${Date.now()}`,
      direction: "inbound",
      messageType: "raw_event",
      text: null,
      payload: { raw: body },
      sentAt: now,
    });
  }

  return out;
}
