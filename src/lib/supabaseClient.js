import { createClient } from "@supabase/supabase-js";

const env =
  (typeof import.meta !== "undefined" && import.meta.env) ||
  (typeof process !== "undefined" && process.env) ||
  {};

const supabaseUrl =
  env.VITE_SUPABASE_URL || "https://mnsqgpiupgelkkmknyex.supabase.co";

const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uc3FncGl1cGdlbGtrbWtueWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMDQ0NTYsImV4cCI6MjEwNTg4MDQ1Nn0.BqvUBfHQHxp5rvs6PG2kD6aW6k--tTlZBY4gp3b6pXs";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export default supabase;
