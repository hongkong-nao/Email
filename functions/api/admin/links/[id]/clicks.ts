import type { Env } from "../../../../_lib/types";
import { guard } from "../../../../_lib/auth";
import { errorResponse, json } from "../../../../_lib/http";

/** GET /api/admin/links/:id/clicks —— 单条短链的最近点击 */
export const onRequestGet: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, "invalid_id", "无效的 id");

  const rows = await env.DB.prepare(
    "SELECT id, code, ts, country, city, referer, ua FROM clicks WHERE link_id = ? ORDER BY ts DESC LIMIT 100",
  )
    .bind(id)
    .all<{
      id: number;
      code: string;
      ts: number;
      country: string | null;
      city: string | null;
      referer: string | null;
      ua: string | null;
    }>();

  return json({ ok: true, items: rows.results || [] });
};
