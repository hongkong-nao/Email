import type { Env, LinkRow } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { clamp, errorResponse, hashIp, json, readJson } from "../../_lib/http";
import { getSettings, writeAudit } from "../../_lib/db";
import { createLink, resolveBaseUrl, toPublicLink } from "../../_lib/links";

const SORTABLE: Record<string, string> = {
  created_at: "created_at",
  updated_at: "updated_at",
  hits: "hits",
  code: "code",
  last_click_at: "last_click_at",
};

/** GET /api/admin/links?q=&status=&sort=&order=&page=&pageSize= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const status = url.searchParams.get("status") || "";
  const sort = SORTABLE[url.searchParams.get("sort") || "created_at"] || "created_at";
  const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
  const page = clamp(Number(url.searchParams.get("page") ?? 1), 1, 100000);
  const pageSize = clamp(Number(url.searchParams.get("pageSize") ?? 20), 1, 100);

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push("(code LIKE ? OR url LIKE ? OR IFNULL(note, '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === "active" || status === "disabled") {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM links ${whereSql}`)
    .bind(...params)
    .first<{ n: number }>();
  const total = totalRow?.n || 0;

  const rows = await env.DB.prepare(
    `SELECT * FROM links ${whereSql} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all<LinkRow>();

  const baseUrl = resolveBaseUrl(request, env);
  return json({
    ok: true,
    items: (rows.results || []).map((row) => toPublicLink(row, baseUrl)),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  });
};

interface CreateBody {
  url?: unknown;
  code?: unknown;
  ttlDays?: unknown;
  note?: unknown;
}

/** POST /api/admin/links */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const body = await readJson<CreateBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  const settings = await getSettings(env);
  const ttlDays = body.ttlDays ?? (Number(settings.default_expire_days) || 0);

  const result = await createLink(env, {
    url: body.url,
    code: body.code,
    ttlDays,
    note: body.note,
    ipHash: await hashIp(request, env),
    origin: new URL(request.url).origin,
  });
  if (!result.ok) {
    return errorResponse(result.status, result.error, result.message);
  }

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "link.create",
    target: result.link.code,
    detail: result.link.url,
    ipHash: await hashIp(request, env),
  });

  return json(
    { ok: true, item: toPublicLink(result.link, resolveBaseUrl(request, env)) },
    { status: 201 },
  );
};
