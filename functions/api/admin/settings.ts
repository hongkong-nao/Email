import type { Env } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { clamp, errorResponse, hashIp, json, readJson } from "../../_lib/http";
import { getSettings, setSetting, writeAudit } from "../../_lib/db";

interface SettingsBody {
  public_create?: unknown;
  default_expire_days?: unknown;
}

/** GET /api/admin/settings */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const settings = await getSettings(env);
  return json({
    ok: true,
    data: {
      public_create: settings.public_create === "1",
      default_expire_days: Number(settings.default_expire_days) || 0,
    },
  });
};

/** PUT /api/admin/settings */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const body = await readJson<SettingsBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  if (body.public_create !== undefined) {
    const raw = body.public_create;
    const value = raw === true || raw === 1 || raw === "1" ? "1" : raw === false || raw === 0 || raw === "0" ? "0" : null;
    if (value === null) return errorResponse(400, "invalid_value", "public_create 必须是布尔值");
    await setSetting(env, "public_create", value);
  }

  if (body.default_expire_days !== undefined) {
    const days = Number(body.default_expire_days);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      return errorResponse(400, "invalid_value", "default_expire_days 需在 0-3650 之间，0 表示永久");
    }
    await setSetting(env, "default_expire_days", String(clamp(days, 0, 3650)));
  }

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "settings.update",
    detail: JSON.stringify(body),
    ipHash: await hashIp(request, env),
  });

  const settings = await getSettings(env);
  return json({
    ok: true,
    data: {
      public_create: settings.public_create === "1",
      default_expire_days: Number(settings.default_expire_days) || 0,
    },
  });
};
