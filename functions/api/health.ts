import type { Env } from "../_lib/types";
import { getSettings } from "../_lib/db";
import { json } from "../_lib/http";

/** GET /api/health —— 自检：数据库、迁移、密钥是否就绪（不泄露任何密钥） */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let db = false;
  let admins = 0;
  let error: string | null = null;

  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM admins").first<{ n: number }>();
    db = true;
    admins = row?.n || 0;
  } catch (err) {
    error = err instanceof Error ? err.message : "database unavailable";
  }

  let publicCreate = false;
  if (db) {
    try {
      const settings = await getSettings(env);
      publicCreate = settings.public_create === "1" || env.ALLOW_PUBLIC_CREATE === "1";
    } catch {
      /* 忽略 */
    }
  }

  return json({
    ok: db,
    service: "cf-pages-shortlink-admin",
    time: new Date().toISOString(),
    config: {
      db,
      dbError: error,
      admins,
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
      bootstrapPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      publicCreate,
      countHits: (env.COUNT_HITS ?? "1").trim() !== "0",
      baseUrl: (env.BASE_URL || "").trim() || "(auto: request origin)",
    },
    hint: db ? undefined : "请先执行 migrations/0001_init.sql（wrangler d1 migrations apply）",
  });
};
