import type { AppSettings, Env } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  public_create: "0",
  default_expire_days: "0",
};

export async function getSettings(env: Env): Promise<AppSettings> {
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows.results || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(key, value)
    .run();
}

export interface AuditEntry {
  adminId: number | null;
  username: string;
  action: string;
  target?: string | null;
  detail?: string | null;
  ipHash?: string | null;
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO audit_logs (admin_id, username, action, target, detail, ip_hash, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        entry.adminId,
        entry.username,
        entry.action,
        entry.target ?? null,
        entry.detail ?? null,
        entry.ipHash ?? null,
        Date.now(),
      )
      .run();
  } catch {
    /* 审计失败不影响主流程 */
  }
}
