import type { Env, LinkRow } from "../../../_lib/types";
import { guard } from "../../../_lib/auth";
import { clamp, errorResponse, hashIp, json, readJson } from "../../../_lib/http";
import { writeAudit } from "../../../_lib/db";
import { resolveBaseUrl, toPublicLink, validateUrl } from "../../../_lib/links";

interface PatchBody {
  url?: unknown;
  note?: unknown;
  status?: unknown;
  ttlDays?: unknown;
}

async function findRow(env: Env, id: number): Promise<LinkRow | null> {
  return env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
}

/** PATCH /api/admin/links/:id */
export const onRequestPatch: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, "invalid_id", "无效的 id");

  const row = await findRow(env, id);
  if (!row) return errorResponse(404, "not_found", "短链不存在");

  const body = await readJson<PatchBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  let nextUrl = row.url;
  if (body.url !== undefined) {
    const target = validateUrl(body.url);
    if (!target) return errorResponse(400, "invalid_url", "url 必须是合法的 http/https 地址");
    try {
      const siteHost = new URL(request.url).hostname;
      if (target.hostname === siteHost || target.hostname.endsWith(`.${siteHost}`)) {
        return errorResponse(400, "self_reference", "目标地址不能指向本站");
      }
    } catch {
      /* 忽略 */
    }
    nextUrl = target.toString();
  }

  let nextNote = row.note;
  if (body.note !== undefined) {
    nextNote = typeof body.note === "string" ? body.note.trim().slice(0, 120) || null : null;
  }

  let nextStatus = row.status;
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") {
      return errorResponse(400, "invalid_status", "status 只能是 active 或 disabled");
    }
    nextStatus = body.status;
  }

  let nextExpires = row.expires_at;
  if (body.ttlDays !== undefined) {
    const days = Number(body.ttlDays);
    nextExpires = Number.isFinite(days) && days > 0 ? Date.now() + clamp(days, 1, 3650) * 86400000 : null;
  }

  await env.DB.prepare(
    "UPDATE links SET url = ?, note = ?, status = ?, expires_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(nextUrl, nextNote, nextStatus, nextExpires, Date.now(), id)
    .run();

  const updated = await findRow(env, id);
  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "link.update",
    target: row.code,
    detail: JSON.stringify({ url: nextUrl, status: nextStatus, expiresAt: nextExpires, note: nextNote }),
    ipHash: await hashIp(request, env),
  });

  return json({
    ok: true,
    item: updated ? toPublicLink(updated, resolveBaseUrl(request, env)) : null,
  });
};

/** DELETE /api/admin/links/:id */
export const onRequestDelete: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, "invalid_id", "无效的 id");

  const row = await findRow(env, id);
  if (!row) return errorResponse(404, "not_found", "短链不存在");

  await env.DB.prepare("DELETE FROM clicks WHERE link_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id).run();

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "link.delete",
    target: row.code,
    detail: row.url,
    ipHash: await hashIp(request, env),
  });

  return json({ ok: true, deleted: row.code });
};
