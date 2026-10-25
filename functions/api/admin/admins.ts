import type { AdminRow, Env, Role } from "../../_lib/types";
import { guard } from "../../_lib/auth";
import { errorResponse, hashIp, json, readJson } from "../../_lib/http";
import { hashPassword } from "../../_lib/auth";
import { writeAudit } from "../../_lib/db";

interface CreateAdminBody {
  username?: unknown;
  password?: unknown;
  role?: unknown;
}

/** GET /api/admin/admins */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env);
  if (!checked.ok) return checked.response;

  const rows = await env.DB.prepare(
    "SELECT id, username, role, created_at, last_login_at, disabled FROM admins ORDER BY id ASC",
  ).all<{
    id: number;
    username: string;
    role: Role;
    created_at: number;
    last_login_at: number | null;
    disabled: number;
  }>();

  return json({ ok: true, items: rows.results || [] });
};

/** POST /api/admin/admins */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const checked = await guard(request, env, { write: true });
  if (!checked.ok) return checked.response;

  const body = await readJson<CreateAdminBody>(request);
  if (!body) return errorResponse(400, "invalid_json", "请求体必须是 JSON");

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: Role = body.role === "viewer" ? "viewer" : "admin";

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return errorResponse(400, "invalid_username", "用户名只能是 3-32 位字母、数字、_ . -");
  }
  if (password.length < 8 || password.length > 200) {
    return errorResponse(400, "weak_password", "密码长度需在 8-200 位之间");
  }

  const exists = await env.DB.prepare("SELECT 1 AS x FROM admins WHERE username = ?").bind(username).first();
  if (exists) return errorResponse(409, "username_taken", "用户名已存在");

  const hash = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO admins (username, password_hash, role, created_at, last_login_at, disabled) VALUES (?, ?, ?, ?, NULL, 0)",
  )
    .bind(username, hash, role, Date.now())
    .run();

  const created = await env.DB.prepare(
    "SELECT id, username, role, created_at, last_login_at, disabled FROM admins WHERE username = ?",
  )
    .bind(username)
    .first<AdminRow>();

  await writeAudit(env, {
    adminId: checked.auth.id,
    username: checked.auth.username,
    action: "admin.create",
    target: username,
    detail: `role=${role}`,
    ipHash: await hashIp(request, env),
  });

  return json({ ok: true, item: created }, { status: 201 });
};
