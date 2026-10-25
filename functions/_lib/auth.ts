import type { AdminRow, Auth, Env, Role, SessionPayload } from "./types";
import { errorResponse, safeEqual, sameOrigin, unauthorized, forbidden } from "./http";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = "sl_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;

function b64urlEncode(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(signature));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 存储格式：pbkdf2$迭代次数$salt$hash（salt/hash 为 base64url） */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const saltText = parts[2];
  const hashText = parts[3];
  if (!Number.isFinite(iterations) || iterations < 10_000 || !saltText || !hashText) return false;
  try {
    const salt = b64urlDecode(saltText);
    const expected = b64urlDecode(hashText);
    const actual = await pbkdf2(password, salt, iterations);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i += 1) diff |= actual[i]! ^ expected[i]!;
    return diff === 0;
  } catch {
    return false;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export async function createSessionCookie(admin: AdminRow, env: Env, request: Request): Promise<string> {
  const secret = env.SESSION_SECRET || "";
  const payload: SessionPayload = {
    sub: admin.id,
    u: admin.username,
    r: admin.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(secret, `v1.${body}`);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=v1.${body}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readSession(request: Request, env: Env): Promise<SessionPayload | null> {
  const secret = env.SESSION_SECRET || "";
  if (!secret) return null;
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = await hmac(secret, `v1.${parts[1]}`);
  if (!safeEqual(expected, parts[2] || "")) return null;

  try {
    const payload = JSON.parse(decoder.decode(b64urlDecode(parts[1]!))) as SessionPayload;
    if (!payload || typeof payload.sub !== "number" || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    if (payload.r !== "admin" && payload.r !== "viewer") return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * 认证：优先 Bearer ADMIN_TOKEN（给脚本用），其次 HttpOnly 会话 Cookie。
 * 每次都会回查数据库，禁用/降权立即生效。
 */
export async function authenticate(request: Request, env: Env): Promise<Auth | null> {
  const header = request.headers.get("Authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const expected = (env.ADMIN_TOKEN || "").trim();
  if (token && expected && safeEqual(token, expected)) {
    return { id: null, username: "api-token", role: "admin", via: "token" };
  }

  const session = await readSession(request, env);
  if (!session) return null;

  const row = await env.DB.prepare("SELECT id, username, role, disabled FROM admins WHERE id = ?")
    .bind(session.sub)
    .first<{ id: number; username: string; role: Role; disabled: number }>();
  if (!row || row.disabled) return null;

  return { id: row.id, username: row.username, role: row.role, via: "session" };
}

export type Guard = { ok: true; auth: Auth } | { ok: false; response: Response };

export async function guard(
  request: Request,
  env: Env,
  options: { write?: boolean } = {},
): Promise<Guard> {
  const auth = await authenticate(request, env);
  if (!auth) return { ok: false, response: unauthorized() };

  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (isWrite && auth.via === "session" && !sameOrigin(request)) {
    return {
      ok: false,
      response: errorResponse(403, "bad_origin", "跨站请求被拒绝（Origin 校验失败）"),
    };
  }
  if (options.write && auth.role !== "admin") {
    return { ok: false, response: forbidden("只读管理员无法执行此操作") };
  }
  return { ok: true, auth };
}
