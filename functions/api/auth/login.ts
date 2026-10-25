import type { AdminRow, Env } from "../../_lib/types";
import { errorResponse, hashIp, json, readJson, safeEqual } from "../../_lib/http";
import { createSessionCookie, hashPassword, verifyPassword } from "../../_lib/auth";
import { writeAudit } from "../../_lib/db";

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SESSION_SECRET) {
    return errorResponse(500, "not_configured", "缺少 SESSION_SECRET，请先配置密钥");
  }

  const body = await readJson<LoginBody>(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) {
    return errorResponse(400, "invalid_input", "请输入用户名和密码");
  }
  if (username.length > 64 || password.length > 200) {
    return errorResponse(400, "invalid_input", "输入内容过长");
  }

  const ipHash = await hashIp(request, env);
  const now = Date.now();

  // 同一 IP 10 分钟内失败 10 次即临时封禁
  const failed = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND ok = 0 AND ts > ?",
  )
    .bind(ipHash, now - 10 * 60 * 1000)
    .first<{ n: number }>();
  if ((failed?.n || 0) >= 10) {
    return errorResponse(429, "too_many_attempts", "尝试次数过多，请 10 分钟后再试");
  }

  const recordAttempt = async (ok: boolean) => {
    try {
      await env.DB.prepare("INSERT INTO login_attempts (ip_hash, ts, ok) VALUES (?, ?, ?)")
        .bind(ipHash, Date.now(), ok ? 1 : 0)
        .run();
      if (ok) {
        await env.DB.prepare("DELETE FROM login_attempts WHERE ts < ?").bind(Date.now() - 86400000).run();
      }
    } catch {
      /* 忽略 */
    }
  };

  const fail = async (message: string): Promise<Response> => {
    await recordAttempt(false);
    await writeAudit(env, {
      adminId: null,
      username,
      action: "login.failed",
      detail: message,
      ipHash,
    });
    return errorResponse(401, "invalid_credentials", message);
  };

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM admins").first<{ n: number }>();
  const isEmpty = (count?.n || 0) === 0;
  let admin: AdminRow | null = null;

  if (isEmpty) {
    // 首次初始化：用环境变量里的管理员账号创建数据库记录
    const expectedUser = (env.ADMIN_USERNAME || "admin").trim() || "admin";
    const expectedPass = env.ADMIN_PASSWORD || "";
    if (!expectedPass) {
      return errorResponse(
        500,
        "not_initialized",
        "数据库中没有管理员，请先给项目配置 ADMIN_PASSWORD 完成初始化",
      );
    }
    if (!safeEqual(username, expectedUser) || !safeEqual(password, expectedPass)) {
      return fail("用户名或密码错误");
    }
    if (password.length < 8) {
      return errorResponse(400, "weak_password", "初始管理员密码至少 8 位");
    }

    const hash = await hashPassword(password);
    try {
      await env.DB.prepare(
        "INSERT INTO admins (username, password_hash, role, created_at, last_login_at, disabled) VALUES (?, ?, 'admin', ?, ?, 0)",
      )
        .bind(expectedUser, hash, now, now)
        .run();
      await writeAudit(env, {
        adminId: null,
        username: expectedUser,
        action: "admin.bootstrap",
        detail: "使用环境变量初始化管理员",
        ipHash,
      });
    } catch {
      /* 并发初始化时忽略冲突，继续按普通登录处理 */
    }
    admin = await env.DB.prepare("SELECT * FROM admins WHERE username = ?")
      .bind(expectedUser)
      .first<AdminRow>();
  } else {
    admin = await env.DB.prepare("SELECT * FROM admins WHERE username = ?").bind(username).first<AdminRow>();
    if (!admin || admin.disabled) return fail("用户名或密码错误");
    if (!(await verifyPassword(password, admin.password_hash))) return fail("用户名或密码错误");
  }

  if (!admin) return fail("用户名或密码错误");
  if (admin.disabled) return fail("该账号已被禁用");

  await env.DB.prepare("UPDATE admins SET last_login_at = ? WHERE id = ?").bind(now, admin.id).run();
  await recordAttempt(true);
  await writeAudit(env, { adminId: admin.id, username: admin.username, action: "login", ipHash });

  const response = json({
    ok: true,
    admin: { id: admin.id, username: admin.username, role: admin.role },
  });
  response.headers.append("Set-Cookie", await createSessionCookie(admin, env, request));
  return response;
};
