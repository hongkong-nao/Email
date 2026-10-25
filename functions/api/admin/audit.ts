import type { Env } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { clamp, json } from "../../_lib/http";

/** GET /api/admin/audit?limit=&offset= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const limit = clamp(Number(url.searchParams.get("limit") ?? 100), 1, 200);
  const offset = clamp(Number(url.searchParams.get("offset") ?? 0), 0, 1000000);

  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs").first<{ n: number }>();
  const rows = await env.DB.prepare(
    "SELECT id, username, action, target, detail, ip_hash, ts FROM audit_logs ORDER BY ts DESC LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all<{
      id: number;
      username: string;
      action: string;
      target: string | null;
      detail: string | null;
      ip_hash: string | null;
      ts: number;
    }>();

  return json({ ok: true, items: rows.results || [], total: total?.n || 0, limit, offset });
};
