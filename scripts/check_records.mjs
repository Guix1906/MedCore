import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yqgafvblxxyksximctzk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZ2FmdmJseHh5a3N4aW1jdHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5MTYsImV4cCI6MjA5MjgzNjkxNn0.KsHS2h6eqfm9-suJ_yxpgSQLYw44bvqG4S6xUD-ZSX8";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  const { data: pats, error: pErr } = await supabase.from("patients").select("id, name, notes").limit(5);
  console.log("PATIENTS TEST:", pats, pErr);
}

main();
