import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Auth middleware: forward Supabase access token from client, then verify
// on the server AND that the user is on the allow-list.
const requireTeamMember = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    if (typeof window === "undefined") return next();
    // Read token directly from supabase-js localStorage (cheaper than dynamic import)
    let token: string | null = null;
    try {
      // Find any sb-*-auth-token key
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

const ExtractInput = z.object({
  email_subject: z.string().max(500).default(""),
  email_body: z.string().min(1).max(50000),
  attachments: z
    .array(
      z.object({
        name: z.string().max(255),
        mime_type: z.string().max(100),
        // base64-encoded content
        data: z.string().max(10_000_000),
      }),
    )
    .max(5)
    .default([]),
});

export type ExtractedItem = {
  sku: string;
  quantity: number;
  raw_name?: string;
};

export type ExtractResult = {
  customer_name: string | null;
  customer_email: string | null;
  items: ExtractedItem[];
  notes: string | null;
};

export const extractOrderFromEmail = createServerFn({ method: "POST" })
  .middleware([requireTeamMember])
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data }): Promise<ExtractResult> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const userParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
      | { type: "file"; file: { filename: string; file_data: string } }
    > = [
      {
        type: "text",
        text:
          `Subject: ${data.email_subject}\n\nBody:\n${data.email_body}\n\n` +
          (data.attachments.length
            ? `Attachments included: ${data.attachments
                .map((a) => a.name)
                .join(", ")}`
            : ""),
      },
    ];

    for (const att of data.attachments) {
      const isExcel =
        att.mime_type.includes("spreadsheet") ||
        att.mime_type === "application/vnd.ms-excel" ||
        /\.(xlsx|xls|csv)$/i.test(att.name);
      if (isExcel) {
        try {
          const XLSX = await import("xlsx");
          const buf = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
          const wb = XLSX.read(buf, { type: "array" });
          const sheets = wb.SheetNames.map((name) => {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            return `--- Sheet: ${name} ---\n${csv}`;
          }).join("\n\n");
          userParts.push({
            type: "text",
            text: `Attachment "${att.name}" (parsed as CSV):\n${sheets}`,
          });
        } catch (e) {
          console.error("Failed to parse spreadsheet attachment", att.name, e);
        }
        continue;
      }
      const dataUrl = `data:${att.mime_type};base64,${att.data}`;
      if (att.mime_type.startsWith("image/")) {
        userParts.push({ type: "image_url", image_url: { url: dataUrl } });
      } else {
        userParts.push({
          type: "file",
          file: { filename: att.name, file_data: dataUrl },
        });
      }
    }


    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are an order-extraction assistant. Extract structured order line items from a customer email and any attachments. " +
            "Each line must have an exact SKU/product code (uppercase, no spaces) and a positive integer quantity. " +
            "If the customer wrote a description without a clear SKU, copy the closest SKU-looking token you see. " +
            "If the email is NOT an order (e.g. spam, marketing, support), return an empty items array. " +
            "Always call the return_order tool exactly once.",
        },
        { role: "user", content: userParts },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_order",
            description: "Return the extracted order details.",
            parameters: {
              type: "object",
              properties: {
                customer_name: { type: ["string", "null"] },
                customer_email: { type: ["string", "null"] },
                notes: {
                  type: ["string", "null"],
                  description:
                    "Any special instructions, delivery requirements, or comments from the customer.",
                },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sku: { type: "string" },
                      quantity: { type: "number" },
                      raw_name: { type: ["string", "null"] },
                    },
                    required: ["sku", "quantity"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["customer_name", "customer_email", "items", "notes"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_order" } },
    };

    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429)
        throw new Error("AI rate limit reached — please try again in a minute.");
      if (resp.status === 402)
        throw new Error(
          "AI credits exhausted — add funds in Settings → Workspace → Usage.",
        );
      console.error("AI gateway error:", resp.status, text);
      throw new Error(`AI extraction failed (${resp.status})`);
    }

    const json = await resp.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI returned no structured output");
    }
    const parsed = JSON.parse(toolCall.function.arguments);

    return {
      customer_name: parsed.customer_name ?? null,
      customer_email: parsed.customer_email ?? null,
      notes: parsed.notes ?? null,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter(
              (i: { sku?: unknown; quantity?: unknown }) =>
                typeof i.sku === "string" && Number(i.quantity) > 0,
            )
            .map((i: { sku: string; quantity: number; raw_name?: string }) => ({
              sku: String(i.sku).trim().toUpperCase(),
              quantity: Math.floor(Number(i.quantity)),
              raw_name: i.raw_name ?? undefined,
            }))
        : [],
    };
  });
