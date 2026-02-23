import { z } from "zod";
import { buildServer } from "./http.js";
import { prisma } from "./prisma.js";
import { insertMessage, upsertConversation } from "./storage.js";
import { normalizeTelegramUpdate, verifyTelegramSecret, telegramSendMessage } from "./adapters/telegram.js";
import { normalizeInstagramEvent, verifyInstagramChallenge, verifyInstagramSignature, instagramSendMessage } from "./adapters/instagram.js";
import { env } from "./env.js";

export const app = buildServer();

// Debug endpoint to validate Instagram env/token setup.
// Calls: GET https://graph.facebook.com/${version}/me?fields=id,middle_name
// Uses token from INSTAGRAM_PAGE_ACCESS_TOKEN.
app.get("/debug/instagram/env-check", async (_req, reply) => {
  try {
    const accessToken = env.INSTAGRAM_PAGE_ACCESS_TOKEN;
    if (!accessToken) {
      return reply.code(400).send({ ok: false, error: "INSTAGRAM_PAGE_ACCESS_TOKEN is missing" });
    }

    const version = env.META_GRAPH_VERSION || "v25.0";
    const base = `https://graph.facebook.com/${version}/me?fields=id,middle_name`;
    const res = await fetch(`${base}&access_token=${encodeURIComponent(accessToken)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return reply.code(res.status).send({ ok: false, version, response: data });
    }

    return reply.send({ ok: true, version, result: data });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: e?.message || "Unknown error" });
  }
});

// Sync Instagram conversations + messages from Meta Graph API into DB.
// Triggered from the minimal UI on "/" when Instagram channel is selected.
app.post("/sync/instagram/conversations", async (_req, reply) => {
  try {
    const pageCompanyId = env.INSTAGRAM_PAGE_COMPANY_ID;
    if (!pageCompanyId) {
      return reply.code(400).send({ ok: false, error: "INSTAGRAM_PAGE_COMPANY_ID is missing" });
    }
    const token = env.INSTAGRAM_PAGE_ACCESS_TOKEN;
    if (!token) {
      return reply.code(400).send({ ok: false, error: "INSTAGRAM_PAGE_ACCESS_TOKEN is missing" });
    }

    const version = env.META_GRAPH_VERSION || "v25.0";
    const url = new URL(`https://graph.facebook.com/${version}/${pageCompanyId}/conversations`);
    url.searchParams.set("fields", "id,updated_time,participants,unread_count,messages{message,from,id,to,created_time}");
    url.searchParams.set("limit", "50");
    url.searchParams.set("platform", "instagram");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return reply.code(res.status).send({ ok: false, error: data });
    }

    const conversations = Array.isArray((data as any)?.data) ? (data as any).data : [];

    const parseMetaTime = (v: any) => {
      if (!v) return new Date();
      const s = String(v);
      // Meta often returns "2026-02-22T22:41:12+0000" (no colon in tz).
      const fixed = s
        .replace(/\+0000$/, "Z")
        .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
      const d = new Date(fixed);
      return isNaN(d.getTime()) ? new Date() : d;
    };
    let convUpserted = 0;
    let msgUpserted = 0;

    for (const c of conversations) {
      const participants = Array.isArray(c?.participants?.data) ? c.participants.data : [];
      const messages = Array.isArray(c?.messages?.data) ? c.messages.data : [];

      const selfIgId = env.INSTAGRAM_IG_USER_ID || "";

      // pick "other" participant to show in UI and to use as default recipient
      const other = participants.find((p: any) => (selfIgId ? String(p?.id) !== selfIgId : true)) || participants[0] || null;
      const otherId = other?.id ? String(other.id) : "unknown";
      const otherUsername = other?.username ? String(other.username) : null;

      const conv = await upsertConversation({
        channel: "instagram",
        accountName: "main",
        externalAccountId: pageCompanyId,
        externalThreadId: String(c?.id ?? "unknown"),
        externalUserId: otherId,
        username: otherUsername,
        phone: null,
        externalMessageId: `ig:sync:conv:${String(c?.id ?? "unknown")}`,
        direction: "inbound",
        messageType: "sync_marker",
        text: null,
        payload: null,
        sentAt: parseMetaTime(c?.updated_time),
      });
      convUpserted++;

      // Upsert each message inside conversation
      for (const m of messages) {
        const fromId = String(m?.from?.id ?? "unknown");
        const direction = selfIgId && fromId === selfIgId ? ("outbound" as const) : ("inbound" as const);

        const sentAt = parseMetaTime(m?.created_time);
        await insertMessage(conv.id, {
          channel: "instagram",
          accountName: "main",
          externalAccountId: pageCompanyId,
          externalThreadId: String(c?.id ?? "unknown"),
          externalUserId: otherId,
          username: otherUsername,
          phone: null,
          externalMessageId: String(m?.id ?? `ig:sync:${Date.now()}:${Math.random()}`),
          direction,
          messageType: "text",
          text: m?.message ? String(m.message) : null,
          payload: { raw: m },
          sentAt,
        });
        msgUpserted++;
      }
    }

    return reply.send({ ok: true, conversations: convUpserted, messages: msgUpserted });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: e?.message || "Unknown error" });
  }
});

// Minimal web UI (no build step) for browsing conversations & messages.
// Open: http://localhost:8080/
app.get("/", async (_req, reply) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Omnichannel Inbox</title>
    <style>
      :root{--bg:#0b0f17;--panel:#101826;--panel2:#0f1522;--text:#e7eefc;--muted:#9db0d1;--border:#21304a;--accent:#4aa3ff;--danger:#ff5c5c;}
      *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; background:var(--bg); color:var(--text)}
      .app{display:grid;grid-template-columns:360px 1fr; height:100vh}
      .left{border-right:1px solid var(--border);background:var(--panel);display:flex;flex-direction:column;min-width:300px}
      .right{background:var(--panel2);display:flex;flex-direction:column}
      header{padding:14px 14px 10px;border-bottom:1px solid var(--border)}
      h1{margin:0;font-size:14px;letter-spacing:.3px;color:var(--muted);font-weight:600}
      .controls{display:flex;gap:8px;margin-top:10px}
      input,select,button,textarea{background:#0c1220;border:1px solid var(--border);color:var(--text);border-radius:10px;padding:10px 12px;font:inherit}
      input,select{width:100%}
      button{cursor:pointer;user-select:none}
      button.primary{background:rgba(74,163,255,.15);border-color:rgba(74,163,255,.35)}
      button.primary:hover{border-color:rgba(74,163,255,.6)}
      .list{overflow:auto; padding:10px}
      .conv{padding:10px 10px;border:1px solid var(--border);border-radius:14px;background:#0c1220;margin-bottom:8px;cursor:pointer}
      .conv:hover{border-color:rgba(74,163,255,.45)}
      .conv.active{border-color:rgba(74,163,255,.9); box-shadow:0 0 0 1px rgba(74,163,255,.2) inset}
      .row{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .title{font-weight:650;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .meta{font-size:12px;color:var(--muted)}
      .pill{font-size:11px;padding:4px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
      .pill.tg{border-color:rgba(74,163,255,.35)}
      .pill.ig{border-color:rgba(255,132,74,.35)}
      .chatHeader{padding:14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}
      .chatTitle{display:flex;flex-direction:column;gap:2px}
      .chatTitle strong{font-size:16px}
      .chatTitle span{font-size:12px;color:var(--muted)}
      .messages{flex:1; overflow:auto; padding:14px; display:flex; flex-direction:column-reverse; gap:10px}
      .bubble{max-width:78%; padding:10px 12px;border-radius:14px;border:1px solid var(--border);background:#0c1220;white-space:pre-wrap;word-break:break-word}
      .bubble.in{align-self:flex-start;border-top-left-radius:6px}
      .bubble.out{align-self:flex-end;border-top-right-radius:6px;background:rgba(74,163,255,.08);border-color:rgba(74,163,255,.25)}
      .bubble .t{font-size:12px;color:var(--muted);margin-top:6px}
      .composer{border-top:1px solid var(--border); padding:12px; display:flex; gap:10px; align-items:flex-end}
      textarea{width:100%;min-height:44px;max-height:160px;resize:vertical}
      .muted{color:var(--muted)}
      .empty{padding:18px;color:var(--muted)}
      .err{padding:10px 12px;border:1px solid rgba(255,92,92,.35);background:rgba(255,92,92,.08);border-radius:12px;color:#ffd2d2;margin:10px}
      @media(max-width:900px){.app{grid-template-columns:1fr}.left{height:45vh}.right{height:55vh}}
    </style>
  </head>
  <body>
    <div class="app">
      <section class="left">
        <header>
          <h1>Omnichannel Inbox</h1>
          <div class="controls">
            <select id="channel">
              <option value="">All</option>
              <option value="telegram">Telegram</option>
              <option value="instagram">Instagram</option>
            </select>
            <input id="q" placeholder="Search: username / phone / thread" />
          </div>
          <div class="controls">
            <button id="reload" class="primary">Reload</button>
            <button id="syncIg" class="primary" style="display:none">Синхронизировать диалоги</button>
            <button id="loadMore">More</button>
          </div>
        </header>
        <div id="error" style="display:none" class="err"></div>
        <div id="list" class="list"></div>
      </section>

      <section class="right">
        <div class="chatHeader">
          <div class="chatTitle">
            <strong id="chatName" class="muted">Select a conversation</strong>
            <span id="chatMeta"></span>
          </div>
          <span id="chatPill" class="pill" style="display:none"></span>
        </div>
        <div id="messages" class="messages"><div class="empty">No conversation selected.</div></div>
        <div class="composer">
          <textarea id="text" placeholder="Type a message… (Ctrl/⌘ + Enter to send)" disabled></textarea>
          <button id="send" class="primary" disabled>Send</button>
        </div>
      </section>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);
      const state = { conv: null, convCursor: null, messagesCursor: null };

      function fmtTime(iso){
        try{
          const d = new Date(iso);
          return d.toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        }catch{ return iso }
      }
      function showError(msg){
        const el = $('error');
        if(!msg){ el.style.display='none'; el.textContent=''; return; }
        el.style.display='block'; el.textContent=msg;
      }

      async function api(path, opts){
        const res = await fetch(path, { headers: { 'content-type':'application/json' }, ...opts });
        const data = await res.json().catch(()=> ({}));
        if(!res.ok || data.ok === false){
          throw new Error(data?.error?.message || data?.error || res.statusText);
        }
        return data;
      }

      function convTitle(c){
        return c.username || c.phone || c.externalThreadId || c.id;
      }
      function channelClass(ch){ return ch === 'telegram' ? 'tg' : ch === 'instagram' ? 'ig' : '' }

      function renderConvs(items, append=false){
        const list = $('list');
        if(!append) list.innerHTML='';
        if(!items.length && !append){
          list.innerHTML = '<div class="empty">No conversations yet. Send a Telegram/Instagram webhook event first.</div>';
          return;
        }
        for(const c of items){
          const div = document.createElement('div');
          div.className = 'conv' + (state.conv?.id === c.id ? ' active' : '');
          div.dataset.id = c.id;
          div.innerHTML =
            '<div class="row">' +
              '<div class="title">' + escapeHtml(convTitle(c)) + '</div>' +
              '<span class="pill ' + channelClass(c.channel) + '">' + escapeHtml(c.channel) + '</span>' +
            '</div>' +
            '<div class="row" style="margin-top:6px">' +
              '<div class="meta">' + escapeHtml(c.externalThreadId || '') + '</div>' +
              '<div class="meta">' + escapeHtml(String(c._count?.messages ?? 0)) + ' msgs</div>' +
            '</div>' +
            '<div class="meta" style="margin-top:6px">Updated: ' + escapeHtml(fmtTime(c.updatedAt)) + '</div>';
          div.onclick = () => selectConversation(c.id, c);
          list.appendChild(div);
        }
      }

      function renderMessages(items, append=false){
        const box = $('messages');
        if(!append) box.innerHTML='';
        if(!items.length && !append){
          box.innerHTML = '<div class="empty">No messages yet.</div>';
          return;
        }
        for(const m of items){
          const div = document.createElement('div');
          div.className = 'bubble ' + (m.direction === 'outbound' ? 'out' : 'in');
          const text = m.text || (m.payload ? JSON.stringify(m.payload) : '');
          div.innerHTML =
            '<div>' + escapeHtml(text) + '</div>' +
            '<div class="t">' + escapeHtml(m.direction) + ' • ' + escapeHtml(fmtTime(m.sentAt || m.receivedAt)) + '</div>';
          box.appendChild(div);
        }
      }

      function escapeHtml(str){
        return String(str ?? '').replace(/[&<>\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      }

      async function loadConversations({append=false}={}){
        showError('');
        const ch = $('channel').value || undefined;
        const q = $('q').value?.trim() || undefined;
        const params = new URLSearchParams();
        if(ch) params.set('channel', ch);
        if(q) params.set('q', q);
        params.set('limit', '50');
        if(append && state.convCursor) params.set('cursor', state.convCursor);

        const data = await api('/conversations?' + params.toString());
        state.convCursor = data.nextCursor;
        renderConvs(data.items, append);
      }

      async function selectConversation(id, c){
        showError('');
        const listEl = $('list');
        [...listEl.querySelectorAll('.conv')].forEach(x => x.classList.toggle('active', x.dataset.id === id));

        state.messagesCursor = null;
        state.conv = { id, channel: c?.channel, username: c?.username, externalThreadId: c?.externalThreadId };

        $('chatName').textContent = convTitle(c || { id });
        $('chatPill').style.display = 'inline-flex';
        $('chatPill').className = 'pill ' + channelClass(c?.channel);
        $('chatPill').textContent = c?.channel || '';
        $('chatMeta').textContent = c?.externalThreadId ? ('Thread: ' + c.externalThreadId) : '';

        $('text').disabled = false;
        $('send').disabled = false;
        await loadMessages({append:false});
      }

      async function loadMessages({append=false}={}){
        if(!state.conv?.id) return;
        const params = new URLSearchParams();
        params.set('limit', '50');
        if(append && state.messagesCursor) params.set('cursor', state.messagesCursor);
        const data = await api('/conversations/' + state.conv.id + '/messages?' + params.toString());
        state.messagesCursor = data.nextCursor;
        renderMessages(data.items, append);
      }

      async function send(){
        const text = $('text').value.trim();
        if(!text || !state.conv?.id) return;
        $('send').disabled = true;
        try{
          await api('/messages/send', { method:'POST', body: JSON.stringify({ conversationId: state.conv.id, text }) });
          $('text').value='';
          await loadMessages({append:false});
          await loadConversations({append:false});
        }catch(e){
          showError('Send failed: ' + e.message);
        }finally{
          $('send').disabled = false;
        }
      }

      $('reload').onclick = () => { state.convCursor=null; loadConversations({append:false}).catch(e=>showError(e.message)); };
      $('syncIg').onclick = async () => {
        showError('');
        const btn = $('syncIg');
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Sync…';
        try{
          // Our api() helper always sets Content-Type: application/json.
          // Fastify returns 400 if a JSON request has an empty body, so we send an empty JSON object.
          await api('/sync/instagram/conversations', { method:'POST', body: '{}' });
          state.convCursor=null;
          await loadConversations({append:false});
        }catch(e){
          showError('Sync failed: ' + e.message);
        }finally{
          btn.disabled = false;
          btn.textContent = prev;
        }
      };
      $('loadMore').onclick = () => loadConversations({append:true}).catch(e=>showError(e.message));
      $('send').onclick = () => send();
      $('q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ state.convCursor=null; loadConversations({append:false}).catch(er=>showError(er.message)); }});
      function updateIgSyncVisibility(){
        const ch = $('channel').value;
        $('syncIg').style.display = ch === 'instagram' ? 'inline-flex' : 'none';
      }

      $('channel').onchange = () => {
        updateIgSyncVisibility();
        state.convCursor=null;
        loadConversations({append:false}).catch(e=>showError(e.message));
      };
      $('text').addEventListener('keydown', (e)=>{
        if((e.ctrlKey || e.metaKey) && e.key==='Enter'){ send(); }
      });

      // Infinite scroll for older messages: when scrolled to top (remember column-reverse)
      $('messages').addEventListener('scroll', (e)=>{
        const el = e.target;
        if(el.scrollTop === 0 && state.messagesCursor){
          loadMessages({append:true}).catch(()=>{});
        }
      });

      loadConversations({append:false}).catch(e=>showError(e.message));
      updateIgSyncVisibility();
    </script>
  </body>
</html>`;

  return reply.header("content-type", "text/html; charset=utf-8").send(html);
});

app.get("/health", async () => ({ ok: true }));

// Telegram webhook
app.post("/webhooks/telegram", async (req, reply) => {
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  const ok = verifyTelegramSecret(typeof secretHeader === "string" ? secretHeader : undefined);
  if (!ok) return reply.code(401).send({ ok: false, error: "Bad secret token" });

  const normalized = normalizeTelegramUpdate(req.body);
  for (const m of normalized) {
    const conv = await upsertConversation(m);
    await insertMessage(conv.id, m);
  }

  return { ok: true, stored: normalized.length };
});

// Instagram webhook verification
app.get("/webhooks/instagram", async (req, reply) => {
  const res = verifyInstagramChallenge(req.query as any);
  return reply.code(res.status).send(res.body);
});

// Instagram webhook events (with optional signature validation)
app.post(
  "/webhooks/instagram",
  { config: { rawBody: true } },
  async (req, reply) => {
    const sig = req.headers["x-hub-signature-256"];
    const raw = (req as any).rawBody as string | undefined;

    const ok = verifyInstagramSignature(raw || "", typeof sig === "string" ? sig : undefined);
    if (!ok) return reply.code(401).send({ ok: false, error: "Bad signature" });

    const normalized = normalizeInstagramEvent(req.body as any);
    for (const m of normalized) {
      const conv = await upsertConversation(m);
      await insertMessage(conv.id, m);
    }
    return { ok: true, stored: normalized.length };
  }
);

// List conversations
app.get("/conversations", async (req, reply) => {
  const Query = z.object({
    channel: z.string().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().min(1).max(200).optional().default(50),
    cursor: z.string().datetime().optional(), // updatedAt < cursor
  });

  const parsed = Query.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const { channel, q, limit, cursor } = parsed.data;

  const where: any = {};
  if (channel) where.channel = channel;
  if (cursor) where.updatedAt = { lt: new Date(cursor) };

  if (q) {
    where.OR = [
      { username: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { externalThreadId: { contains: q } },
    ];
  }

  const items = await prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      channel: true,
      username: true,
      phone: true,
      externalThreadId: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  const nextCursor = items.length ? items[items.length - 1].updatedAt.toISOString() : null;
  return { ok: true, items, nextCursor };
});

// List messages for conversation
app.get("/conversations/:id/messages", async (req, reply) => {
  const Params = z.object({ id: z.string().uuid() });
  const Query = z.object({
    limit: z.coerce.number().min(1).max(200).optional().default(50),
    cursor: z.string().datetime().optional(), // sentAt < cursor
  });

  const p = Params.safeParse(req.params);
  const q = Query.safeParse(req.query);
  if (!p.success) return reply.code(400).send({ ok: false, error: p.error.flatten() });
  if (!q.success) return reply.code(400).send({ ok: false, error: q.error.flatten() });

  const { id } = p.data;
  const { limit, cursor } = q.data;

  const where: any = { conversationId: id };
  if (cursor) where.sentAt = { lt: new Date(cursor) };

  const items = await prisma.message.findMany({
    where,
    orderBy: { sentAt: "desc" },
    take: limit,
    select: {
      id: true,
      direction: true,
      messageType: true,
      text: true,
      payload: true,
      externalMessageId: true,
      sentAt: true,
      receivedAt: true,
    },
  });

  const nextCursor = items.length ? items[items.length - 1].sentAt.toISOString() : null;
  return { ok: true, items, nextCursor };
});

// Send outbound message (telegram implemented)
app.post("/messages/send", async (req, reply) => {
  const Body = z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1),
    messageType: z.string().optional().default("text"),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const { conversationId, text, messageType } = parsed.data;

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) return reply.code(404).send({ ok: false, error: "Conversation not found" });

  if (conv.channel === "telegram") {
    await telegramSendMessage(conv.externalThreadId, text);

    const outbound = {
      channel: "telegram",
      accountName: "main",
      externalAccountId: null,
      externalThreadId: conv.externalThreadId,
      externalUserId: conv.externalUserId,
      username: conv.username,
      phone: conv.phone,
      externalMessageId: `tg:out:${conv.externalThreadId}:${Date.now()}`,
      direction: "outbound" as const,
      messageType,
      text,
      payload: null,
      sentAt: new Date(),
    };

    await insertMessage(conv.id, outbound);
    return { ok: true };
  }



if (conv.channel === "instagram") {
  // Instagram recipient resolution:
  // 1) If INSTAGRAM_RECIPIENT_ID is set -> use it (explicit override as requested).
  // 2) Otherwise, try to infer recipient from latest inbound message payload (raw.from.id).
  //    This is the most reliable for Messenger API for Instagram.
  // 3) Fallback to conversation.externalUserId.
  let recipientId = env.INSTAGRAM_RECIPIENT_ID || "";

  if (!recipientId) {
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: conv.id, direction: "inbound" },
      orderBy: { sentAt: "desc" },
      select: { payload: true },
    });
    const fromId = (lastInbound as any)?.payload?.raw?.from?.id;
    if (fromId) recipientId = String(fromId);
  }

  if (!recipientId) {
    recipientId = conv.externalUserId;
  }

  if (!recipientId || recipientId === "unknown") {
    return reply.code(400).send({
      ok: false,
      error:
        "Instagram recipientId not resolved. Set INSTAGRAM_RECIPIENT_ID or INSTAGRAM_IG_USER_ID (to store correct participant during sync).",
    });
  }
  await instagramSendMessage(recipientId, text);

  const outbound = {
    channel: "instagram",
    accountName: "main",
    externalAccountId: env.INSTAGRAM_PAGE_COMPANY_ID || null,
    externalThreadId: conv.externalThreadId,
    externalUserId: recipientId,
    username: conv.username,
    phone: conv.phone,
    externalMessageId: `ig:out:${conv.externalThreadId}:${Date.now()}`,
    direction: "outbound" as const,
    messageType,
    text,
    payload: null,
    sentAt: new Date(),
  };

  await insertMessage(conv.id, outbound);
  return { ok: true };
}

  return reply.code(400).send({ ok: false, error: `Sending not implemented for channel: ${conv.channel}` });
});
