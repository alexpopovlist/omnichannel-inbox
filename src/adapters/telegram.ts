import { z } from "zod";
import { NormalizedMessage } from "../types.js";
import { env } from "../env.js";

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    date: z.number(),
    chat: z.object({
      id: z.number(),
      type: z.string().optional(),
    }),
    from: z.object({
      id: z.number(),
      is_bot: z.boolean().optional(),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      phone_number: z.string().optional(),
    }).optional(),
    text: z.string().optional(),
    contact: z.object({
      phone_number: z.string(),
    }).optional(),
    caption: z.string().optional(),
    photo: z.array(z.any()).optional(),
    document: z.any().optional(),
    sticker: z.any().optional(),
    voice: z.any().optional(),
    video: z.any().optional(),
  }).optional(),
});

export function verifyTelegramSecret(headerValue: string | undefined) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  return headerValue === env.TELEGRAM_WEBHOOK_SECRET;
}

export function normalizeTelegramUpdate(body: unknown): NormalizedMessage[] {
  const parsed = TelegramUpdateSchema.safeParse(body);
  if (!parsed.success) return [];

  const u = parsed.data;
  if (!u.message) return [];

  const msg = u.message;
  const from = msg.from;

  const chatId = String(msg.chat.id);
  const messageId = String(msg.message_id);
  const sentAt = new Date(msg.date * 1000);

  let messageType = "text";
  let text: string | null | undefined = msg.text ?? null;
  let payload: Record<string, unknown> | null = null;

  if (msg.photo) {
    messageType = "image";
    text = msg.caption ?? null;
    payload = { photo: msg.photo };
  } else if (msg.document) {
    messageType = "file";
    text = msg.caption ?? null;
    payload = { document: msg.document };
  } else if (msg.sticker) {
    messageType = "sticker";
    payload = { sticker: msg.sticker };
  } else if (msg.voice) {
    messageType = "voice";
    payload = { voice: msg.voice };
  } else if (msg.video) {
    messageType = "video";
    text = msg.caption ?? null;
    payload = { video: msg.video };
  } else if (!msg.text) {
    messageType = "unknown";
    payload = { raw: msg };
  }

  const phone = msg.contact?.phone_number ?? from?.phone_number ?? null;

  const displayName = [from?.first_name, from?.last_name].filter(Boolean).join(" ");

    const username = from?.username ?? (displayName || null);

  const externalUserId = from ? String(from.id) : "unknown";

  const normalized: NormalizedMessage = {
    channel: "telegram",
    accountName: "main",
    externalAccountId: null,

    externalThreadId: chatId,
    externalUserId,
    username,
    phone,

    externalMessageId: `tg:${chatId}:${messageId}`,
    direction: "inbound",
    messageType,
    text,
    payload,
    sentAt,
  };

  return [normalized];
}

export async function telegramSendMessage(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<any>;
}
