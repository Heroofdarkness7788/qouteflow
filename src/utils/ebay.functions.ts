import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Forward Supabase token from client localStorage, then verify on server.
const requireAuth = createMiddleware({ type: "function" })
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

// Cache the OAuth token in module scope (per worker instance) to avoid
// re-authenticating on every search. Token typically lasts ~2 hours.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getEbayAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("eBay credentials not configured");
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("eBay OAuth failed:", resp.status, text);
    throw new Error(
      `eBay authentication failed (${resp.status}). Check EBAY_CLIENT_ID/EBAY_CLIENT_SECRET are valid Production keys.`,
    );
  }

  const json = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return json.access_token;
}

export type EbayBestSeller = {
  query: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  url: string | null;
  image: string | null;
  condition: string | null;
  seller: string | null;
  found: boolean;
};

const SearchInput = z.object({
  queries: z.array(z.string().min(1).max(200)).min(1).max(50),
});

export const searchEbayBestSellers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data }): Promise<EbayBestSeller[]> => {
    const token = await getEbayAccessToken();

    const fetchOne = async (q: string): Promise<EbayBestSeller> => {
      try {
        const url = new URL(
          "https://api.ebay.com/buy/browse/v1/item_summary/search",
        );
        url.searchParams.set("q", q);
        url.searchParams.set("limit", "1");
        // Sort by best match (default) — eBay's algorithm weights sales velocity.
        url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

        const r = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "Content-Type": "application/json",
          },
        });

        if (!r.ok) {
          console.error("eBay search failed:", q, r.status);
          return {
            query: q,
            title: null,
            price: null,
            currency: null,
            url: null,
            image: null,
            condition: null,
            seller: null,
            found: false,
          };
        }

        const json = (await r.json()) as {
          itemSummaries?: Array<{
            title?: string;
            price?: { value?: string; currency?: string };
            itemWebUrl?: string;
            image?: { imageUrl?: string };
            thumbnailImages?: Array<{ imageUrl?: string }>;
            condition?: string;
            seller?: { username?: string };
          }>;
        };

        const top = json.itemSummaries?.[0];
        if (!top) {
          return {
            query: q,
            title: null,
            price: null,
            currency: null,
            url: null,
            image: null,
            condition: null,
            seller: null,
            found: false,
          };
        }

        return {
          query: q,
          title: top.title ?? null,
          price: top.price?.value ? Number(top.price.value) : null,
          currency: top.price?.currency ?? null,
          url: top.itemWebUrl ?? null,
          image:
            top.image?.imageUrl ?? top.thumbnailImages?.[0]?.imageUrl ?? null,
          condition: top.condition ?? null,
          seller: top.seller?.username ?? null,
          found: true,
        };
      } catch (e) {
        console.error("eBay lookup error:", q, e);
        return {
          query: q,
          title: null,
          price: null,
          currency: null,
          url: null,
          image: null,
          condition: null,
          seller: null,
          found: false,
        };
      }
    };

    // Run lookups in parallel but cap concurrency at 5 to stay polite.
    const results: EbayBestSeller[] = [];
    const queue = [...data.queries];
    const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
      while (queue.length) {
        const q = queue.shift();
        if (!q) break;
        results.push(await fetchOne(q));
      }
    });
    await Promise.all(workers);

    // Preserve original input order
    const order = new Map<string, number>(data.queries.map((q: string, i: number) => [q, i]));
    results.sort((a, b) => (order.get(a.query) ?? 0) - (order.get(b.query) ?? 0));
    return results;
  });
