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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseFirstResult(html: string, query: string): EbayBestSeller {
  const empty: EbayBestSeller = {
    query,
    title: null,
    price: null,
    currency: null,
    url: null,
    image: null,
    condition: null,
    seller: null,
    found: false,
  };

  // eBay search results are wrapped in <li class="s-item ..."> blocks.
  // Skip the first "s-item" which is often a hidden template.
  const itemRegex = /<li[^>]*class="[^"]*\bs-item\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(html)) !== null) {
    matches.push(m[1]);
    if (matches.length > 4) break;
  }
  if (matches.length === 0) return empty;

  // Find first item that has a real title (skip placeholder "Shop on eBay")
  for (const block of matches) {
    const titleMatch =
      block.match(/<div[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<span[^>]*>)?([^<]+)/i) ||
      block.match(/<span[^>]*role="heading"[^>]*>([^<]+)/i);
    const rawTitle = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;
    if (!rawTitle || /^shop on ebay$/i.test(rawTitle)) continue;

    const linkMatch = block.match(/<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/i);
    const url = linkMatch ? decodeEntities(linkMatch[1]) : null;

    const priceMatch = block.match(/<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([^<]+)/i);
    const priceText = priceMatch ? decodeEntities(priceMatch[1]).trim() : null;
    let price: number | null = null;
    let currency: string | null = null;
    if (priceText) {
      const numMatch = priceText.match(/([\d,]+\.?\d*)/);
      if (numMatch) price = Number(numMatch[1].replace(/,/g, ""));
      if (/\$/.test(priceText)) currency = "USD";
      else if (/£/.test(priceText)) currency = "GBP";
      else if (/€/.test(priceText)) currency = "EUR";
      else {
        const codeMatch = priceText.match(/\b([A-Z]{3})\b/);
        currency = codeMatch ? codeMatch[1] : null;
      }
    }

    const imgMatch =
      block.match(/<img[^>]*class="[^"]*s-item__image[^"]*"[^>]*src="([^"]+)"/i) ||
      block.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*s-item__image/i) ||
      block.match(/<img[^>]*src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/i);
    const image = imgMatch ? decodeEntities(imgMatch[1]) : null;

    const condMatch = block.match(/<span[^>]*class="[^"]*SECONDARY_INFO[^"]*"[^>]*>([^<]+)/i);
    const condition = condMatch ? decodeEntities(condMatch[1]).trim() : null;

    const sellerMatch = block.match(/<span[^>]*class="[^"]*s-item__seller-info-text[^"]*"[^>]*>([^<]+)/i);
    const seller = sellerMatch ? decodeEntities(sellerMatch[1]).trim() : null;

    return {
      query,
      title: rawTitle,
      price,
      currency,
      url,
      image,
      condition,
      seller,
      found: Boolean(url || price),
    };
  }

  return empty;
}

export const searchEbayBestSellers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data }): Promise<EbayBestSeller[]> => {
    const fetchOne = async (q: string): Promise<EbayBestSeller> => {
      try {
        // _sop=12 = Best Match (default eBay sort, weighs sales/relevance).
        const url = new URL("https://www.ebay.com/sch/i.html");
        url.searchParams.set("_nkw", q);
        url.searchParams.set("_sop", "12");
        url.searchParams.set("LH_BIN", "1"); // Buy It Now only

        const r = await fetch(url.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (!r.ok) {
          console.error("eBay scrape failed:", q, r.status);
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

        const html = await r.text();
        return parseFirstResult(html, q);
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
