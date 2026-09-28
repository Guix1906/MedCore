import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getSiteOrigin = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const req = getRequest();
    if (req?.headers) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") || "https";
      if (host) {
        return `${proto}://${host}`;
      }
    }
  } catch {}

  const vercelProject = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProject) {
    return `https://${vercelProject}`;
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return "https://meedcore.vercel.app";
});

