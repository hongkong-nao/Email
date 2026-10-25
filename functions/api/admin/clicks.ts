import type { Env } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { clamp, json } from "../../_lib/http";

/** GET /api/admin/clicks?code=&limit=&offset= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().slice(0, 32);
  const limit = clamp(Number(url.searchParams.get("limit") ?? 100), 1, 200);
  const offset = clamp(Number(url.searchParams.get("offset") ?? 0), 0, 1000000);

  const where = code ? "WHERE c.code = ?" : "";
  const params = code ? [code] : [];

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM clicks c ${where}`)
    .bind(...params)
    .first<{ n: number }>();

  const rows = await env.DB.prepare(
    `SELECT c.id, c.code, c.ts, c.country, c.city, c.referer, c.ua, l.url
     FROM clicks c LEFT JOIN links l ON l.id = c.link_id
     ${where}
     ORDER BY c.ts DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<{
      id: number;
      code: string;
      ts: number;
      country: string | null;
      city: string | null;
      referer: string | null;
      ua: string | null;
      url: string | null;
    }>();

  return json({ ok: true, items: rows.results || [], total: total?.n || 0, limit, offset });
};
