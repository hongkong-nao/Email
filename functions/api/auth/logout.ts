import type { Env } from "../../_lib/types";
import { authenticate, clearSessionCookie } from "../../_lib/auth";
import { hashIp, json } from "../../_lib/http";
import { writeAudit } from "../../_lib/db";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticate(request, env);
  if (auth) {
    await writeAudit(env, {
      adminId: auth.id,
      username: auth.username,
      action: "logout",
      ipHash: await hashIp(request, env),
    });
  }
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookie());
  return response;
};
