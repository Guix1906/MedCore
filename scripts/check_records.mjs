import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const env = fs.readFileSync(".env", "utf8");
let url = "";
let key = "";
env.split("\n").forEach((l) => {
  const line = l.trim();
  if (line.startsWith("VITE_SUPABASE_URL=")) url = line.split("=")[1].replace(/['"]/g, "").trim();
  if (line.startsWith("VITE_SUPABASE_ANON_KEY=")) key = line.split("=")[1].replace(/['"]/g, "").trim();
});

const supabase = createClient(url, key);

async function main() {
  const { data: recs, error: rErr } = await supabase.from("medical_records").select("*");
  console.log("RECORDS COUNT:", recs ? recs.length : 0);
  console.log("RECORDS DATA:", JSON.stringify(recs, null, 2));
  if (rErr) console.error("RECORD ERROR:", rErr);

  const { data: pats, error: pErr } = await supabase.from("patients").select("id, name");
  console.log("PATIENTS COUNT:", pats ? pats.length : 0);
  console.log("PATIENTS DATA:", JSON.stringify(pats, null, 2));
}

main();
