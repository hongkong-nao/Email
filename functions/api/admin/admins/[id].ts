import type { AdminRow, Env, Role } from "../../../_lib/types";
import { guard, hashPassword } from "../../../_lib/auth";
import { errorResponse, hashIp, json, readJson } from "../../../_lib/http";
import { writeAudit } from "../../../_lib/db";

interface PatchAdminBody {
  password?: unknown;
  role?: unknown;
  disabled?: unknown;
}

async function findAdmin(env: Env, id: number): Promise<AdminRow | null> {
  return env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first<AdminRow>();
}

async function activeAdminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND disabled = 0",
  ).first<{ n: number }>();
  return row?.n || 0;
}

/** PATCH /api/admin/admins/:id */
export const onRequestPatch: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, "invalid_id", "无效的 id");

  const target = await findAdmin(env, id);
  if (!target) return errorResponse(404, "not_found", "管理员不存在");

  const body = await readJson<PatchAdminBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  let role: Role = target.role;
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "viewer") {
      return errorResponse(400, "invalid_role", "role 只能是 admin 或 viewer");
    }
    role = body.role;
  }

  let disabled = target.disabled;
  if (body.disabled !== undefined) {
    disabled = body.disabled === true || body.disabled === 1 ? 1 : 0;
  }

  if (checked.auth.id === target.id && (disabled === 1 || role !== "admin")) {
    return errorResponse(400, "self_lockout", "不能禁用自己或把自己降级为只读");
  }

  const losesAdmin = target.role === "admin" && target.disabled === 0 && (role !== "admin" || disabled === 1);
  if (losesAdmin) {
    const remaining = await activeAdminCount(env);
    if (remaining <= 1) {
      return errorResponse(400, "last_admin", "至少需要保留一个启用的管理员");
    }
  }

  let hash = target.password_hash;
  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) {
      return errorResponse(400, "weak_password", "密码长度需在 8-200 位之间");
    }
    hash = await hashPassword(body.password);
  }

  await env.DB.prepare("UPDATE admins SET password_hash = ?, role = ?, disabled = ? WHERE id = ?")
    .bind(hash, role, disabled, id)
    .run();

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "admin.update",
    target: target.username,
    detail: JSON.stringify({
      role,
      disabled: Boolean(disabled),
      passwordChanged: body.password !== undefined,
    }),
    ipHash: await hashIp(request, env),
  });

  const updated = await findAdmin(env, id);
  return json({
    ok: true,
    item: updated
      ? {
          id: updated.id,
          username: updated.username,
          role: updated.role,
          created_at: updated.created_at,
          last_login_at: updated.last_login_at,
          disabled: updated.disabled,
        }
      : null,
  });
};

/** DELETE /api/admin/admins/:id */
export const onRequestDelete: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, "invalid_id", "无效的 id");
  if (checked.auth.id === id) return errorResponse(400, "self_lockout", "不能删除当前登录的账号");

  const target = await findAdmin(env, id);
  if (!target) return errorResponse(404, "not_found", "管理员不存在");

  if (target.role === "admin" && target.disabled === 0) {
    const remaining = await activeAdminCount(env);
    if (remaining <= 1) return errorResponse(400, "last_admin", "至少需要保留一个启用的管理员");
  }

  await env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "admin.delete",
    target: target.username,
    ipHash: await hashIp(request, env),
  });

  return json({ ok: true, deleted: target.username });
};
