// GET /api/config — public bootstrap for the admin page's Supabase Auth client.
// The anon key is public by design (RLS protects data); the service_role key is
// never exposed.

export default function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
}
