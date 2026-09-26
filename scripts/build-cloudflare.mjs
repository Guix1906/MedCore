import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBuilder, loadEnv } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = loadEnv("production", root, "VITE_");
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Cloudflare build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
}
if (new URL(supabaseUrl).protocol !== "https:") {
  throw new Error("Cloudflare production requires an HTTPS Supabase URL.");
}
if (!supabaseKey.startsWith("sb_publishable_")) {
  const payload = supabaseKey.split(".")[1];
  if (!payload || JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role !== "anon") {
    throw new Error("Use only the Supabase publishable/anon key, never a service-role key.");
  }
}

process.env.NITRO_PRESET = "cloudflare-module";
const builder = await createBuilder({ root });
await builder.buildApp();

// Server functions need runtime bindings, not only Vite's client-side variables.
const configUrl = new URL("../.output/server/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
config.vars = {
  ...config.vars,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: supabaseKey,
};
await writeFile(configUrl, `${JSON.stringify(config, null, 2)}\n`);
console.log("Cloudflare build ready with Supabase public runtime bindings.");
