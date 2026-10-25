/** 绑定到 Pages Functions 的环境变量与资源 */
export interface Env {
  /** D1 数据库绑定，对应 wrangler.toml 的 binding = "DB" */
  DB: D1Database;
  /** Pages 静态资源（一般不需要手动用） */
  ASSETS?: Fetcher;
  /** 会话签名密钥（Secret，必填） */
  SESSION_SECRET?: string;
  /** 可选的 API 令牌，便于 curl / 自动化（Secret） */
  ADMIN_TOKEN?: string;
  /** 首次初始化管理员用户名，默认 admin */
  ADMIN_USERNAME?: string;
  /** 首次初始化管理员密码（Secret） */
  ADMIN_PASSWORD?: string;
  /** 生成短链使用的站点地址，留空用请求 origin */
  BASE_URL?: string;
  /** 站点名称，显示在页面标题 */
  SITE_NAME?: string;
  /** 是否允许公开创建（"1" 开启），默认关闭 */
  ALLOW_PUBLIC_CREATE?: string;
  /** 最多短链条数，0 = 不限制 */
  MAX_LINKS?: string;
  /** 是否记录点击（"0" 关闭），默认开启 */
  COUNT_HITS?: string;
  /** IP 哈希盐，缺省回退到 SESSION_SECRET */
  IP_HASH_SALT?: string;
}

export type Role = "admin" | "viewer";

export interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  created_at: number;
  last_login_at: number | null;
  disabled: number;
}

export interface LinkRow {
  id: number;
  code: string;
  url: string;
  note: string | null;
  status: "active" | "disabled";
  hits: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  last_click_at: number | null;
  created_ip: string | null;
}

export interface PublicLink {
  id: number;
  code: string;
  url: string;
  note: string | null;
  status: "active" | "disabled";
  hits: number;
  createdAt: number;
  expiresAt: number | null;
  lastClickAt: number | null;
  expired: boolean;
  shortUrl: string;
}

export interface AppSettings {
  public_create: string;
  default_expire_days: string;
  [key: string]: string;
}

export interface SessionPayload {
  sub: number;
  u: string;
  r: Role;
  exp: number;
}

export interface Auth {
  id: number | null;
  username: string;
  role: Role;
  via: "session" | "token";
}
