-- ── DarkHorizon: Row Level Security policies for the `locations` table ────────
--
-- Run this script once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/<your-project-id>/sql/new
--
-- Context:
--   The app uses the anonymous (anon) key — there is no user authentication.
--   Without explicit policies, RLS blocks all INSERT/SELECT for the anon role.
--   The policies below allow:
--     • Anyone to READ public locations (needed for the map markers layer)
--     • Anyone to INSERT a public location with no user_id (Save Location feature)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Allow anonymous users to read all public locations
--    (the map marker layer calls .select() with the anon key)
CREATE POLICY "Public locations are readable by anyone"
  ON public.locations
  FOR SELECT
  USING (is_public = true);

-- 2. Allow anonymous users to insert a new public location
--    (the Save Location modal calls .insert() with the anon key)
--    Guard: only rows with is_public=true and user_id IS NULL are accepted.
CREATE POLICY "Anyone can insert a public location"
  ON public.locations
  FOR INSERT
  WITH CHECK (is_public = true AND user_id IS NULL);
