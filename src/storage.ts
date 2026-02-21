import { prisma } from "./prisma.js";
import { NormalizedMessage } from "./types.js";
import { MessageDirection } from "@prisma/client";

export async function ensureAccount(channel: string, accountName: string, externalAccountId?: string | null) {
  return prisma.channelAccount.upsert({
    where: { channel_accountName: { channel, accountName } },
    create: { channel, accountName, externalAccountId: externalAccountId ?? null },
    update: { externalAccountId: externalAccountId ?? null },
  });
}

export async function upsertConversation(m: NormalizedMessage) {
  const account = await ensureAccount(m.channel, m.accountName, m.externalAccountId ?? null);

  const conv = await prisma.conversation.upsert({
    where: { accountId_externalThreadId: { accountId: account.id, externalThreadId: m.externalThreadId } },
    create: {
      channel: m.channel,
      accountId: account.id,
      externalThreadId: m.externalThreadId,
      externalUserId: m.externalUserId,
      username: m.username ?? null,
      phone: m.phone ?? null,
    },
    update: {
      externalUserId: m.externalUserId,
      username: m.username ?? undefined,
      phone: m.phone ?? undefined,
    },
  });

  return conv;
}

export async function insertMessage(conversationId: string, m: NormalizedMessage) {
  const direction: MessageDirection = m.direction === "inbound" ? "inbound" : "outbound";

  // idempotent insert using unique constraint (conversationId, externalMessageId)
  return prisma.message.upsert({
    where: { conversationId_externalMessageId: { conversationId, externalMessageId: m.externalMessageId } },
    create: {
      conversationId,
      direction,
      messageType: m.messageType,
      text: m.text ?? null,
      payload: m.payload ?? undefined,
      externalMessageId: m.externalMessageId,
      sentAt: m.sentAt,
    },
    update: {
      // If duplicate arrives, we do nothing meaningful
      text: m.text ?? undefined,
      payload: m.payload ?? undefined,
      sentAt: m.sentAt,
    },
  });
}
