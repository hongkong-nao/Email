import type { Env, LinkRow, PublicLink } from "./types";
import { clamp } from "./http";

export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
/** 去掉易混淆字符 */
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim();
  return CODE_PATTERN.test(code) ? code : null;
}

export function generateCode(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/** 接受 example.com/a、https://...；拒绝 javascript:、ftp: 等 */
export function validateUrl(input: unknown): URL | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
    if (/^(javascript|data|vbscript|file|blob|mailto|ftp):/i.test(trimmed)) return null;
    candidate = `https://${trimmed}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveBaseUrl(request: Request, env: Env): string {
  const configured = (env.BASE_URL || "").trim();
  if (configured) {
    try {
      const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
      return new URL(withScheme).origin;
    } catch {
      /* 配置不合法时回退 */
    }
  }
  return new URL(request.url).origin;
}

export function toPublicLink(row: LinkRow, baseUrl: string): PublicLink {
  return {
    id: row.id,
    code: row.code,
    url: row.url,
    note: row.note ?? null,
    status: row.status,
    hits: row.hits,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    lastClickAt: row.last_click_at ?? null,
    expired: Boolean(row.expires_at && row.expires_at <= Date.now()),
    shortUrl: `${baseUrl}/s/${row.code}`,
  };
}

export interface CreateLinkInput {
  url: unknown;
  code?: unknown;
  ttlDays?: unknown;
  note?: unknown;
  ipHash?: string | null;
  /** 当前站点 origin，用来拒绝「短链指向自己」造成的循环 */
  origin: string;
}

export type CreateLinkResult =
  | { ok: true; link: LinkRow }
  | { ok: false; status: number; error: string; message: string };

export async function createLink(env: Env, input: CreateLinkInput): Promise<CreateLinkResult> {
  const target = validateUrl(input.url);
  if (!target) {
    return {
      ok: false,
      status: 400,
      error: "invalid_url",
      message: "url 必须是合法的 http/https 地址，例如 https://example.com/path",
    };
  }

  try {
    const siteHost = new URL(input.origin).hostname;
    if (target.hostname === siteHost || target.hostname.endsWith(`.${siteHost}`)) {
      return { ok: false, status: 400, error: "self_reference", message: "目标地址不能指向本站，避免循环跳转" };
    }
  } catch {
    /* 忽略 */
  }

  const rawCode = input.code;
  const customCode = rawCode === undefined || rawCode === null || rawCode === "" ? null : normalizeCode(rawCode);
  if (rawCode !== undefined && rawCode !== null && rawCode !== "" && !customCode) {
    return {
      ok: false,
      status: 400,
      error: "invalid_code",
      message: "自定义短码只能包含字母、数字、- 和 _，长度 3-32",
    };
  }

  const maxLinks = Number(env.MAX_LINKS || 0);
  if (maxLinks > 0) {
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>();
    if ((total?.n || 0) >= maxLinks) {
      return { ok: false, status: 429, error: "limit_reached", message: `已达到 MAX_LINKS 上限（${maxLinks}）` };
    }
  }

  let code = customCode;
  if (code) {
    const exists = await env.DB.prepare("SELECT 1 AS x FROM links WHERE code = ?").bind(code).first();
    if (exists) {
      return { ok: false, status: 409, error: "code_taken", message: `短码 ${code} 已被占用` };
    }
  } else {
    for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
      const candidate = generateCode(7);
      const exists = await env.DB.prepare("SELECT 1 AS x FROM links WHERE code = ?").bind(candidate).first();
      if (!exists) code = candidate;
    }
  }
  if (!code) {
    return { ok: false, status: 500, error: "code_generation_failed", message: "生成短码失败，请重试" };
  }

  const ttlDays = Number(input.ttlDays || 0);
  const now = Date.now();
  const expiresAt = Number.isFinite(ttlDays) && ttlDays > 0 ? now + clamp(ttlDays, 1, 3650) * 86400000 : null;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 120) || null : null;

  try {
    await env.DB.prepare(
      "INSERT INTO links (code, url, note, status, hits, created_at, updated_at, expires_at, last_click_at, created_ip) VALUES (?, ?, ?, 'active', 0, ?, ?, ?, NULL, ?)",
    )
      .bind(code, target.toString(), note, now, now, expiresAt, input.ipHash ?? null)
      .run();
  } catch {
    return { ok: false, status: 409, error: "code_taken", message: "短码已被占用，请换一个" };
  }

  const link = await env.DB.prepare("SELECT * FROM links WHERE code = ?").bind(code).first<LinkRow>();
  if (!link) {
    return { ok: false, status: 500, error: "insert_failed", message: "写入失败，请重试" };
  }
  return { ok: true, link };
}
