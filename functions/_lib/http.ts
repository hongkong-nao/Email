import type { Env } from "./types";

const encoder = new TextEncoder();

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

export function errorResponse(status: number, error: string, message?: string): Response {
  return json({ ok: false, error, message: message || error }, { status });
}

export function unauthorized(message = "请先登录"): Response {
  return errorResponse(401, "unauthorized", message);
}

export function forbidden(message = "权限不足"): Response {
  return errorResponse(403, "forbidden", message);
}

/** 定长比较，避免逐字符试探 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "0.0.0.0";
  return "0.0.0.0";
}

/** 只保存 IP 的哈希，避免明文留存访客地址 */
export async function hashIp(request: Request, env: Env): Promise<string> {
  const salt = env.IP_HASH_SALT || env.SESSION_SECRET || "shortlink";
  return (await sha256Hex(`${salt}:${getClientIp(request)}`)).slice(0, 32);
}

/** 浏览器发起的写请求必须同源，配合 SameSite=Lax 防 CSRF */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // curl / 服务端调用不带 Origin
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
