// Verify a Supabase Auth JWT and confirm the user is in the admins allowlist.
import { createClient } from "@supabase/supabase-js";

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function requireAdmin(req) {
  const sb = serviceClient();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, sb, user: null };
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { status: 401, sb, user: null };
  const { data: row } = await sb.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) return { status: 403, sb, user: data.user };
  return { status: 200, sb, user: data.user };
}
