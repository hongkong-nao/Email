import type { Env } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { clamp, json } from "../../_lib/http";

interface Totals {
  links: number;
  active: number;
  clicks: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const days = clamp(Number(url.searchParams.get("days") ?? 14), 7, 90);
  const now = Date.now();
  const dayStart = Math.floor(now / 86400000) * 86400000;
  const rangeStart = dayStart - (days - 1) * 86400000;

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS links,
            COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(hits), 0) AS clicks
     FROM links`,
  ).first<Totals>();

  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks WHERE ts >= ?")
    .bind(dayStart)
    .first<{ n: number }>();

  const trendRows = await env.DB.prepare(
    `SELECT ts / 86400000 * 86400000 AS day, COUNT(*) AS c
     FROM clicks WHERE ts >= ?
     GROUP BY day ORDER BY day`,
  )
    .bind(rangeStart)
    .all<{ day: number; c: number }>();

  const top = await env.DB.prepare(
    "SELECT id, code, url, hits, status FROM links ORDER BY hits DESC, created_at DESC LIMIT 8",
  ).all<{ id: number; code: string; url: string; hits: number; status: string }>();

  const recent = await env.DB.prepare(
    `SELECT c.id, c.code, c.ts, c.country, l.url
     FROM clicks c LEFT JOIN links l ON l.id = c.link_id
     ORDER BY c.ts DESC LIMIT 8`,
  ).all<{ id: number; code: string; ts: number; country: string | null; url: string | null }>();

  const trendMap = new Map((trendRows.results || []).map((r) => [r.day, r.c]));
  const trend: { day: number; count: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = rangeStart + i * 86400000;
    trend.push({ day, count: trendMap.get(day) || 0 });
  }

  return json({
    ok: true,
    totals: {
      links: totals?.links || 0,
      active: totals?.active || 0,
      clicks: totals?.clicks || 0,
    },
    today: today?.n || 0,
    trend,
    top: top.results || [],
    recent: recent.results || [],
  });
};
