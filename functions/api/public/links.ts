import type { Env } from "../../_lib/types";
import { errorResponse, hashIp, json, readJson } from "../../_lib/http";
import { getSettings } from "../../_lib/db";
import { createLink, resolveBaseUrl, toPublicLink } from "../../_lib/links";

interface PublicCreateBody {
  url?: unknown;
  code?: unknown;
  ttlDays?: unknown;
}

/** POST /api/public/links —— 仅在开启「公开创建」后可用 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const settings = await getSettings(env);
  const enabled = settings.public_create === "1" || env.ALLOW_PUBLIC_CREATE === "1";
  if (!enabled) {
    return errorResponse(403, "public_create_disabled", "本站未开放公共创建，请联系管理员");
  }

  const body = await readJson<PublicCreateBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  const ipHash = await hashIp(request, env);
  const now = Date.now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM links WHERE created_ip = ? AND created_at >= ?",
  )
    .bind(ipHash, now - 3600000)
    .first<{ n: number }>();
  if ((recent?.n || 0) >= 5) {
    return errorResponse(429, "rate_limited", "创建过于频繁，每小时最多 5 条");
  }

  const ttlDays = body.ttlDays ?? (Number(settings.default_expire_days) || 0);
  const result = await createLink(env, {
    url: body.url,
    code: body.code,
    ttlDays,
    ipHash,
    origin: new URL(request.url).origin,
  });
  if (!result.ok) {
    return errorResponse(result.status, result.error, result.message);
  }

  return json(
    {
      ok: true,
      item: toPublicLink(result.link, resolveBaseUrl(request, env)),
    },
    { status: 201 },
  );
};
