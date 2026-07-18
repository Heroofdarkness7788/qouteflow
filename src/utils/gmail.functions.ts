import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Same auth middleware pattern as orders.functions.ts — forwards the
// Supabase access token from the browser and verifies it server-side.
const requireTeamMember = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    if (typeof window === "undefined") return next();
    let token: string | null = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            token = parsed?.access_token ?? null;
          }
          break;
        }
      }
    } catch {
      // ignore
    }
    return next(token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  })
  .server(async ({ next }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Response("Server misconfigured", { status: 500 });
    }
    const request = getRequest();
    const authHeader = request?.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Response("Unauthorized", { status: 401 });
    }
    const token = authHeader.slice("Bearer ".length);
    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: claims, error } = await sb.auth.getClaims(token);
    if (error || !claims?.claims?.sub) {
      throw new Response("Unauthorized", { status: 401 });
    }
    return next({ context: { userId: claims.claims.sub as string } });
  });

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_mail";

// ---------- OAuth start (popup flow) ----------
export const startGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireTeamMember])
  .inputValidator((targetOrigin: unknown) => z.string().url().parse(targetOrigin))
  .handler(async ({ data: targetOrigin, context }) => {
    const clientKey = process.env.GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY;
    if (!clientKey) throw new Error("Gmail connector is not configured");
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl: targetOrigin,
      responseMode: "web_message",
      webMessageTargetOrigin: targetOrigin,
      credentialsConfiguration: {
        scopes: [
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
      },
    });
    return { authorizationUrl };
  });

// ---------- Save the connection key after popup succeeds ----------
export const saveGmailConnection = createServerFn({ method: "POST" })
  .middleware([requireTeamMember])
  .inputValidator((input: unknown) =>
    z.object({ connectionAPIKey: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { saveConnectionKeyForUser } = await import("@/lib/appUserConnections.server");
    await saveConnectionKeyForUser(context.userId, CONNECTOR_ID, data.connectionAPIKey);
    return { ok: true };
  });

// ---------- Connection status ----------
export const getGmailStatus = createServerFn({ method: "GET" })
  .middleware([requireTeamMember])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser } = await import("@/lib/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!key) return { connected: false as const, email: null as string | null };
    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path: "/gmail/v1/users/me/profile",
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`Gmail profile lookup failed (${res.status}): ${text.slice(0, 300)}`);
      return { connected: true as const, email: null };
    }
    const body = (await res.json()) as { emailAddress?: string };
    return { connected: true as const, email: body.emailAddress ?? null };
  });

// ---------- Disconnect ----------
export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireTeamMember])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser, deleteConnectionForUser } =
      await import("@/lib/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (key) {
      try {
        const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
        await disconnectAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: key,
          connectorId: CONNECTOR_ID,
        });
      } catch (e) {
        console.warn("Gateway disconnect failed", e);
      }
    }
    await deleteConnectionForUser(context.userId, CONNECTOR_ID);
    return { ok: true };
  });

// ---------- List recent unread ----------
export type GmailListItem = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

export const listRecentGmail = createServerFn({ method: "GET" })
  .middleware([requireTeamMember])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().max(200).default("is:unread newer_than:30d"),
        max: z.number().int().min(1).max(50).default(15),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<GmailListItem[]> => {
    const { getConnectionKeyForUser } = await import("@/lib/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!key) throw new Error("Gmail is not connected");
    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");

    const listRes = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path: `/gmail/v1/users/me/messages?maxResults=${data.max}&q=${encodeURIComponent(data.query)}`,
    });
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(formatGmailGatewayError("Gmail list failed", listRes.status, t));
    }
    const list = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }> };
    const ids = list.messages ?? [];

    const items = await Promise.all(
      ids.map(async (m) => {
        const r = await callAsAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: key,
          connectorId: CONNECTOR_ID,
          path: `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        });
        if (!r.ok) return null;
        const msg = (await r.json()) as {
          id: string;
          threadId: string;
          snippet?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        const h = (n: string) =>
          msg.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
        return {
          id: msg.id,
          threadId: msg.threadId,
          from: h("From"),
          subject: h("Subject"),
          snippet: msg.snippet ?? "",
          date: h("Date"),
        } satisfies GmailListItem;
      }),
    );
    return items.filter((x): x is GmailListItem => x !== null);
  });

// ---------- Fetch a single message body + attachments ----------
export type GmailMessage = {
  id: string;
  subject: string;
  from: string;
  body: string;
  attachments: Array<{ name: string; mime_type: string; data: string; size: number }>;
};

function decodeBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function base64UrlToBase64(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return s.replace(/-/g, "+").replace(/_/g, "/") + pad;
}

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

export const fetchGmailMessage = createServerFn({ method: "POST" })
  .middleware([requireTeamMember])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<GmailMessage> => {
    const { getConnectionKeyForUser } = await import("@/lib/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!key) throw new Error("Gmail is not connected");
    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: key,
      connectorId: CONNECTOR_ID,
      path: `/gmail/v1/users/me/messages/${data.messageId}?format=full`,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(formatGmailGatewayError("Gmail fetch failed", res.status, t));
    }
    const msg = (await res.json()) as {
      id: string;
      payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
    };
    const h = (n: string) =>
      msg.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";

    // Walk parts
    let textBody = "";
    let htmlBody = "";
    const attachments: GmailMessage["attachments"] = [];

    const walk = async (p?: GmailPart) => {
      if (!p) return;
      const mime = p.mimeType ?? "";
      if (p.filename && (p.body?.attachmentId || p.body?.data)) {
        // attachment
        let base64Std = "";
        let size = p.body?.size ?? 0;
        if (p.body?.data) {
          base64Std = base64UrlToBase64(p.body.data);
        } else if (p.body?.attachmentId) {
          const ar = await callAsAppUser({
            gatewayBaseUrl: GATEWAY_BASE_URL,
            connectionAPIKey: key,
            connectorId: CONNECTOR_ID,
            path: `/gmail/v1/users/me/messages/${msg.id}/attachments/${p.body.attachmentId}`,
          });
          if (ar.ok) {
            const aj = (await ar.json()) as { data?: string; size?: number };
            if (aj.data) base64Std = base64UrlToBase64(aj.data);
            size = aj.size ?? size;
          }
        }
        if (base64Std && size <= 8 * 1024 * 1024) {
          attachments.push({
            name: p.filename,
            mime_type: mime || "application/octet-stream",
            data: base64Std,
            size,
          });
        }
        return;
      }
      if (mime === "text/plain" && p.body?.data) {
        textBody += new TextDecoder().decode(decodeBase64Url(p.body.data));
      } else if (mime === "text/html" && p.body?.data) {
        htmlBody += new TextDecoder().decode(decodeBase64Url(p.body.data));
      }
      if (p.parts) for (const child of p.parts) await walk(child);
    };
    await walk(msg.payload);

    let body = textBody.trim();
    if (!body && htmlBody) {
      // crude HTML strip
      body = htmlBody
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    return {
      id: msg.id,
      subject: h("Subject"),
      from: h("From"),
      body,
      attachments: attachments.slice(0, 5),
    };
  });

function formatGmailGatewayError(prefix: string, status: number, body: string): string {
  const details = body.slice(0, 500);
  if (/insufficient authentication scopes/i.test(body)) {
    return `${prefix} (${status}): Gmail read permission was not granted. Disconnect Gmail, connect again, and approve read-only Gmail access.`;
  }
  if (
    /accessNotConfigured|has not been used in project|it is disabled|API has not been used/i.test(
      body,
    )
  ) {
    return `${prefix} (${status}): Gmail API is not enabled on the Google OAuth project. Enable the Gmail API in Google Cloud, then refresh.`;
  }
  if (status === 401 || /invalid.?credentials|unauthorized/i.test(body)) {
    return `${prefix} (${status}): This Gmail connection expired or was revoked. Disconnect Gmail and connect it again.`;
  }
  if (status === 403) {
    return `${prefix} (${status}): Google blocked Gmail access for this OAuth app. Check that the account is an approved tester and that Gmail read-only scope is allowed.`;
  }
  return `${prefix} (${status}): ${details}`;
}
