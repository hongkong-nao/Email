import type { Env } from "../../_lib/types";
import { json } from "../../_lib/http";
import { getSettings } from "../../_lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await getSettings(env);
  return json({
    ok: true,
    data: {
      siteName: env.SITE_NAME || "短链服务",
      publicCreate: settings.public_create === "1" || env.ALLOW_PUBLIC_CREATE === "1",
      maxLinks: Number(env.MAX_LINKS || 0) || 0,
    },
  });
};
