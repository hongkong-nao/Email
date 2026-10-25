import type { Env } from "../_lib/types";
import { hashIp } from "../_lib/http";
import { normalizeCode } from "../_lib/links";

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  const code = normalizeCode(params.code);
  if (!code) return notFound();

  const link = await env.DB.prepare(
    "SELECT id, url, status, expires_at FROM links WHERE code = ?",
  )
    .bind(code)
    .first<{ id: number; url: string; status: string; expires_at: number | null }>();

  if (!link || link.status !== "active") return notFound();
  if (link.expires_at && link.expires_at <= Date.now()) return notFound();

  if ((env.COUNT_HITS ?? "1").trim() !== "0") {
    const now = Date.now();
    const cf = request.cf as IncomingRequestCfProperties | undefined;
    const country = (cf?.country as string | undefined) ?? null;
    const city = (cf?.city as string | undefined) ?? null;
    const referer = request.headers.get("Referer")?.slice(0, 500) ?? null;
    const ua = request.headers.get("User-Agent")?.slice(0, 400) ?? null;
    const ipHash = await hashIp(request, env);

    waitUntil(
      env.DB.batch([
        env.DB.prepare("UPDATE links SET hits = hits + 1, last_click_at = ? WHERE id = ?").bind(now, link.id),
        env.DB.prepare(
          "INSERT INTO clicks (link_id, code, ts, country, city, referer, ua, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(link.id, code, now, country, city, referer, ua, ipHash),
      ]).catch(() => undefined),
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: link.url,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};

export const onRequestHead: PagesFunction<Env> = onRequestGet;
