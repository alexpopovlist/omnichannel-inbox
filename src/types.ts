export type Channel = "telegram" | "instagram" | (string & {});
export type Direction = "inbound" | "outbound";

export interface NormalizedMessage {
  channel: Channel;
  accountName: string;              // which configured account (e.g. "main")
  externalAccountId?: string | null;

  externalThreadId: string;          // telegram chat_id, instagram thread id
  externalUserId: string;            // sender id
  username?: string | null;
  phone?: string | null;

  externalMessageId: string;         // dedupe key per conversation
  direction: Direction;
  messageType: string;               // text|image|...
  text?: string | null;
  payload?: Record<string, unknown> | null;

  sentAt: Date;                      // time from channel
}
