import { createClient } from '@supabase/supabase-js';
export async function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env['SUPABASE_ANON_KEY'];
  const { DB_URL } = process.env;
  return createClient(url!, key!, { db: DB_URL });
}
export const dbg = globalThis.process?.env.DEBUG;
