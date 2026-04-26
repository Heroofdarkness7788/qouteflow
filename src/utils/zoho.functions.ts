import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const LineSchema = z.object({
  sku: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  margin_pct: z.number(),
  discount_pct: z.number(),
  unit: z.string().optional(),
  line_total: z.number(),
});

const PushInput = z.object({
  quotation_number: z.string().min(1).max(100),
  date: z.string(),
  customer_name: z.string().max(500).default(""),
  customer_email: z.string().max(500).default(""),
  currency: z.string().min(3).max(8),
  notes: z.string().max(5000).optional().default(""),
  lines: z.array(LineSchema).min(1).max(200),
});

export type ZohoPushResult = {
  estimate_id: string;
  estimate_number: string;
};

function regionDomain(region: string | undefined): string {
  // Zoho regional domains. Default to .com
  switch ((region || "com").toLowerCase()) {
    case "eu":
      return "eu";
    case "in":
      return "in";
    case "au":
      return "com.au";
    case "jp":
      return "jp";
    case "ca":
      return "ca";
    case "sa":
      return "sa";
    case "uk":
      return "uk";
    default:
      return "com";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Zoho credentials are not configured");
  }
  const region = regionDomain(process.env.ZOHO_REGION);
  const url = `https://accounts.zoho.${region}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!resp.ok || !json.access_token) {
    throw new Error(
      `Zoho token refresh failed: ${json.error || resp.statusText}`,
    );
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function findOrCreateContact(
  token: string,
  region: string,
  orgId: string,
  name: string,
  email: string,
): Promise<string> {
  const base = `https://www.zohoapis.${region}/books/v3`;
  // Try to find by name first
  const search = await fetch(
    `${base}/contacts?organization_id=${orgId}&contact_name_contains=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
  );
  if (search.ok) {
    const data = (await search.json()) as {
      contacts?: Array<{ contact_id: string; contact_name: string }>;
    };
    const exact = data.contacts?.find(
      (c) => c.contact_name.toLowerCase() === name.toLowerCase(),
    );
    if (exact) return exact.contact_id;
    if (data.contacts && data.contacts.length > 0) return data.contacts[0].contact_id;
  }
  // Create
  const createResp = await fetch(
    `${base}/contacts?organization_id=${orgId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contact_name: name,
        contact_persons: email
          ? [{ email, is_primary_contact: true }]
          : undefined,
      }),
    },
  );
  const createJson = (await createResp.json()) as {
    contact?: { contact_id: string };
    message?: string;
  };
  if (!createResp.ok || !createJson.contact?.contact_id) {
    throw new Error(
      `Zoho contact create failed: ${createJson.message || createResp.statusText}`,
    );
  }
  return createJson.contact.contact_id;
}

export const pushQuotationToZoho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PushInput.parse(input))
  .handler(async ({ data }): Promise<ZohoPushResult> => {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    if (!orgId) throw new Error("ZOHO_ORGANIZATION_ID is not configured");
    const region = regionDomain(process.env.ZOHO_REGION);

    const token = await getAccessToken();
    const customerName = data.customer_name?.trim() || "Walk-in Customer";

    const contactId = await findOrCreateContact(
      token,
      region,
      orgId,
      customerName,
      data.customer_email?.trim() || "",
    );

    const line_items = data.lines.map((l) => {
      const sellPrice = +(
        l.unit_price * (1 + (l.margin_pct || 0) / 100)
      ).toFixed(4);
      return {
        name: l.description.slice(0, 100) || l.sku,
        description: l.sku,
        rate: sellPrice,
        quantity: l.quantity,
        unit: l.unit || "pcs",
        discount: l.discount_pct ? `${l.discount_pct}%` : undefined,
      };
    });

    const payload = {
      customer_id: contactId,
      estimate_number: data.quotation_number,
      date: data.date,
      currency_code: data.currency,
      line_items,
      notes: data.notes || undefined,
      is_discount_before_tax: true,
      discount_type: "item_level",
    };

    const url = `https://www.zohoapis.${region}/books/v3/estimates?organization_id=${orgId}&ignore_auto_number_generation=true`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as {
      estimate?: { estimate_id: string; estimate_number: string };
      message?: string;
      code?: number;
    };
    if (!resp.ok || !json.estimate?.estimate_id) {
      throw new Error(
        `Zoho estimate create failed: ${json.message || resp.statusText}`,
      );
    }
    return {
      estimate_id: json.estimate.estimate_id,
      estimate_number: json.estimate.estimate_number,
    };
  });
