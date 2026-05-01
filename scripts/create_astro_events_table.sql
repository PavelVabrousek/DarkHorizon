-- Create a generic table for astronomical events (eclipses, transits, etc.)
CREATE TABLE IF NOT EXISTS public.astro_events (
  id text PRIMARY KEY, -- e.g., 'solar_eclipse_20240408'
  event_type text NOT NULL, -- e.g., 'solar_eclipse', 'lunar_eclipse', 'transit'
  event_date date NOT NULL,
  label text NOT NULL, -- e.g., 'Total Solar Eclipse 2024-04-08'
  kind text, -- e.g., 'Total', 'Annular', 'Partial'
  max_duration_sec numeric, -- duration in seconds
  metadata jsonb DEFAULT '{}'::jsonb, -- extra metadata like gamma, tan_f2, etc.
  path_geometry jsonb, -- GeoJSON representing the main area of visibility/totality
  centerline_geometry jsonb, -- GeoJSON representing the centerline
  details jsonb DEFAULT '[]'::jsonb, -- additional info like centerline details (time/duration)
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Note: We are using JSONB for geometries for simplicity and direct Leaflet compatibility.
-- If you enable PostGIS in the future, you can alter these to geometry(Geometry, 4326).

-- Enable Row Level Security (RLS)
ALTER TABLE public.astro_events ENABLE ROW LEVEL SECURITY;

-- Policy definitions are idempotent for repeatable local/project setup.
DROP POLICY IF EXISTS "Public read access for astro_events" ON public.astro_events;
DROP POLICY IF EXISTS "Allow inserts for anon" ON public.astro_events;
DROP POLICY IF EXISTS "Allow updates for anon" ON public.astro_events;

-- Allow public read access. Astronomical events are public reference data used by
-- the frontend map overlay.
CREATE POLICY "Public read access for astro_events"
  ON public.astro_events FOR SELECT
  USING (true);

-- SECURITY NOTE:
-- Do not allow anonymous INSERT/UPDATE for production. Import/update event data
-- from a trusted local script or CI job using the Supabase service-role key.
-- The service-role key bypasses RLS and must never be exposed to browser code.
