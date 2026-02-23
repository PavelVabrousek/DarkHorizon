# DarkHorizon

**DarkHorizon** is a web application and Progressive Web App (PWA) for planning astronomical observations. Amateur astronomers use it to find the optimal observation site for a given night based on weather forecasts, long-term climate statistics, light pollution and astronomical conditions (Sun and Moon position).

Live: **[darkhorizon.app](https://darkhorizon.app)**

---

## Current state

The application is in active development. The interactive map, HUD overlays, geocoding search, location markers from Supabase and the database schema are all live. Scoring and weather integration is the next milestone.

### What works today

| Feature | Details |
|---|---|
| Interactive dark map | Three switchable base layers — physical overview, topographic detail, satellite imagery |
| Light pollution overlay | Lorenz 2024 atlas, adjustable opacity (10–90 %), lazy-loaded |
| Satellite / topo toggle | Enabled automatically at zoom ≥ 12 |
| Coordinate + elevation HUD | Real-time centre coordinates; elevation fetched from Open-Meteo after 5 s of stillness |
| Geocoding search bar | Photon API (OpenStreetMap data) — debounced autocomplete, keyboard navigation, flyTo / fitBounds |
| Scale bar | Dynamic metric scale bar updating on every zoom / pan |
| Street View button | Appears in Layers panel at zoom ≥ 15 — opens Google Maps Street View in a new tab at map centre |
| LP index (Bortle) | Canvas-sampled Bortle class at map centre shown in Site Score legend |
| Observation sites | Locations fetched from Supabase and rendered as colour-coded CircleMarkers with dark-theme popups |
| Database schema | All 6 tables created in Supabase (see [Database](#database)) |

---

## Scoring system

Once weather, Sun/Moon and climate data are populated the map markers will be coloured automatically:

| Score | Weight | Components |
|---|---|---|
| `weather_score` (0–100) | 50 % of final | Cloud cover 60 %, precipitation 25 %, stability 15 % |
| `darkness_score` (0–100) | 30 % of final | Sun position 70 %, Moon position / illumination 30 % |
| `clima_score` (0–100) | 20 % of final | Clear-sky probability 70 %, precipitation 20 %, wind 10 % |

`final_score = weather_score × 0.5 + darkness_score × 0.3 + clima_score × 0.2`

Map markers: **green** ≥ 70 · **yellow** 40–69 · **red** < 40 · **indigo** (no score yet)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Map | React Leaflet 4 + Leaflet 1.9 |
| Styling | Tailwind CSS 3 (custom `night-*`, `star-*`, `score-*` palette) |
| State | Zustand 5 |
| Data fetching | TanStack React Query 5 |
| Geocoding | Photon API (komoot.io) — free, no API key |
| Elevation | Open-Meteo elevation API — free, no API key |
| Backend | Supabase (PostgreSQL + PostGIS + Auth + Storage) |
| Hosting | Vercel (auto-deploy from GitHub `main`) |

---

## Map architecture

The map is built on a four-pane Leaflet system. Each pane has its own CSS dark filter and z-index so layers can be shown, hidden, or blended independently without re-mounting tile layer components.

### Base layers (only one visible at a time)

| Pane | z-index | Source | Active when |
|---|---|---|---|
| `paneEsri` | 200 | ESRI World Physical (hypsometric) | zoom < 3 |
| `paneTopo` | 201 | OpenTopoMap (contour lines + relief) | zoom 3–11, or zoom ≥ 12 in topo mode |
| `paneSat` | 202 | ESRI World Imagery (satellite / aerial) | zoom ≥ 12 **and** satellite mode active |

CSS dark filters applied per pane:

| Pane | Filter |
|---|---|
| `paneEsri` | `brightness(0.60) contrast(1.10) saturate(0.85)` |
| `paneTopo` | `brightness(0.50) contrast(1.10) saturate(0.65)` |
| `paneSat` | `brightness(0.82) contrast(1.06) saturate(0.88)` |
| global | `brightness(0.85) saturate(0.9)` on `.leaflet-tile-pane` |

### Overlay layers

| Pane | z-index | Source | Default |
|---|---|---|---|
| `paneLp` | 400 | Lorenz 2024 light pollution PNG (self-hosted) | off |

### HUD overlay elements (z-index 1000–1001)

| Element | Position | Description |
|---|---|---|
| Search bar | top-centre | Photon geocoding — debounced, dropdown, fly-to on select |
| Branding | top-left | DarkHorizon logo + name |
| Layer / satellite toggle pill | top-right | Shows active base layer name + zoom; clickable at zoom ≥ 12 |
| Coordinate + elevation bar | top-right (below toggle) | `lat · lng · elevation m` |
| Scale bar | bottom-centre | Dynamic metric scale (1 m – 2 000 km), recalculated on zoom / pan |
| Site Score legend | bottom-left | LP Bortle index sampled from the LP canvas + colour key |
| Layers panel | bottom-right | LP toggle + opacity slider + Street View button (zoom ≥ 15) |

---

## Light pollution overlay

**Source:** Lorenz 2024 Light Pollution Atlas — self-hosted as static PNGs under `public/lp/`, served by Vercel.

Leaflet `ImageOverlay` maps images linearly in Web Mercator screen space, but the source PNGs are in plate carrée. Without correction, the overlay would show LP data from ~1 700 km too far south at 50°N. The `scripts/download_lp.py` script reprojects each PNG from plate carrée → Web Mercator before saving.

Three copies of the world PNG are rendered simultaneously, shifted by ±360°, so the overlay wraps seamlessly when the user scrolls past the ±180° meridian.

| File | Bounds `[[sw],[ne]]` |
|---|---|
| `world_low3.png` (2.6 MB) | `[[-65,-180],[75,180]]` |
| `Europe2024.png` (1.9 MB) | `[[34,-32],[75,70]]` |
| `NorthAmerica.png` (1.9 MB) | `[[7,-180],[75,-51]]` |
| `SouthAmerica.png` (1.4 MB) | `[[-57,-93],[14,-33]]` |
| `Africa.png` (2.0 MB) | `[[-36,-26],[38,64]]` |
| `Asia.png` (2.6 MB) | `[[5,60],[75,180]]` |
| `Australia.png` (0.7 MB) | `[[-48,94],[8,180]]` |

**Generating assets (one-time):**
```bash
pip install pillow numpy
python scripts/download_lp.py
# → public/lp/*.png  (commit to git, Vercel serves as static files)
```

---

## Geocoding — Photon API

The search bar queries `https://photon.komoot.io/api/` (free, no API key, built on OSM Nominatim + Pelias data).

- Input debounced 350 ms before fetch
- Up to 6 results shown in dropdown
- Each result includes name, parent locality, type hint (city / peak / street …)
- On select: `fitBounds` to Photon's `extent` bbox if available, otherwise `flyTo` at zoom 12–15
- `Escape` closes dropdown; `↑` / `↓` navigate; `Enter` selects highlighted result
- Map ref is captured from inside `<MapContainer>` via `MapRefCapture` inner component and exposed via `useRef<L.Map>` to the outer HUD

---

## Scale bar

The scale bar label and bar width are recalculated on every zoom / pan using the Mercator formula:

```
metersPerPixel = (40 075 016.686 × cos(lat × π/180)) / (256 × 2^zoom)
```

The bar snaps to the largest "nice" distance (from the set `1 m, 2 m, 5 m, … 2 000 km`) that fits within 120 px. Width adjusts automatically in CSS pixels.

---

## Database

All tables live in `public` schema on Supabase (PostgreSQL + PostGIS). Row Level Security is enabled on every table.

### `locations` — observation sites

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` FK → `auth.users` | nullable — `NULL` = system / public record |
| `name` | `text` | Required |
| `description` | `text` | Optional |
| `latitude` | `double precision` | WGS-84 |
| `longitude` | `double precision` | WGS-84 |
| `elevation_m` | `double precision` | Metres above sea level |
| `bortle_class` | `smallint` | 1–9 |
| `horizon_profile` | `jsonb` | Array of `{azimuth, min_elevation}` segments |
| `is_public` | `boolean` | Default `true` |
| `created_at` | `timestamptz` | Auto |
| `updated_at` | `timestamptz` | Auto-updated by trigger |

### `weather_cache` — hourly forecast per location

`(location_id, forecast_time)` unique. Columns: `cloud_cover_pct`, `precipitation_mm`, `wind_speed_ms`, `temperature_c`, `humidity_pct`, `seeing_score`, `weather_score`.

### `sunmoon_cache` — hourly Sun/Moon positions per location

`(location_id, forecast_time)` unique. Columns: `sun_azimuth`, `sun_elevation`, `sun_twilight_type`, `moon_azimuth`, `moon_elevation`, `moon_illumination_pct`, `moon_phase_pct`, `darkness_score`.

### `clima_stat` — long-term climate statistics

`(location_id, day_of_year, hour_of_day)` unique. Columns: `cloud_cover_avg`, `clear_sky_probability`, `precipitation_prob`, `wind_speed_avg_ms`, `clima_score`, `sample_count`.

### `observations` — user observation logs

Columns: `user_id`, `location_id`, `observed_at`, `actual_sqm`, `notes`, `image_path`, `weather_score_actual`, `darkness_score_actual`.

### `user_preferences` — per-user settings

Columns: `home_latitude`, `home_longitude`, `max_distance_km`, `min_weather_score`, `min_darkness_score`, `preferred_bortle_max`.

---

## Development roadmap

| # | Feature | Status |
|---|---|---|
| 1 | Project scaffold (Vite + React + TS + Tailwind + Leaflet) | ✅ |
| 2 | Base map — ESRI Physical + OpenTopoMap with dark CSS filters | ✅ |
| 3 | Light pollution overlay (Lorenz 2024) + opacity slider | ✅ |
| 4 | Satellite view toggle for zoom ≥ 12 (ESRI World Imagery) | ✅ |
| 5 | Map controls HUD — Layers panel + `mapSettings` Zustand store | ✅ |
| 6 | Coordinate + elevation HUD (Open-Meteo) | ✅ |
| 7 | Geocoding search bar (Photon API) | ✅ |
| 8 | Scale bar | ✅ |
| 9 | Street View button (zoom ≥ 15) | ✅ |
| 10 | Supabase database schema (6 tables + RLS) | ✅ |
| 11 | Observation sites layer — Supabase fetch + CircleMarker popups | ✅ |
| **12** | **Weather score — Open-Meteo forecast → `weather_cache`** | next |
| 13 | Sun & Moon tracking + `darkness_score` | pending |
| 14 | Climate statistics per location + `clima_score` | pending |
| 15 | Site detail panel — click marker → hourly forecast cards | pending |
| 16 | User authentication + personal observation logs | pending |
| 17 | Sky Quality Meter estimation from astrophoto | pending |
| 18 | PWA manifest + service worker | pending |

---

## Project structure

```
src/
├── components/
│   ├── MapView.tsx          # Leaflet map, pane setup, tile layers, all HUD elements
│   ├── MapControls.tsx      # Layers panel: LP toggle + opacity, Street View button
│   ├── SearchBar.tsx        # Photon geocoding search bar with autocomplete dropdown
│   └── LocationMarkers.tsx  # CircleMarker + dark Popup per Supabase location
├── hooks/
│   └── useLocations.ts      # React Query hook — fetches all public locations
├── store/
│   └── mapSettings.ts       # Zustand: satelliteMode, lpVisible, lpOpacity
├── lib/
│   ├── supabase.ts          # Supabase client (typed with Database)
│   └── openmeteo.ts         # Open-Meteo API helper
├── utils/
│   └── lpSampler.ts         # Canvas LP pixel sampler → Bortle class
└── types/
    ├── database.ts           # Supabase table type shapes (all 6 tables)
    ├── location.ts           # Location, ScoredLocation, getScoreColor()
    ├── weather.ts            # Weather & climate types
    └── astronomy.ts          # TwilightType, MoonPhase, scoring types

public/
└── lp/
    ├── world_low3.png        # World overview 1/40° ≈ 2.5 km/px
    ├── Europe2024.png        # Continent 1/120° ≈ 750 m/px
    ├── NorthAmerica.png
    ├── SouthAmerica.png
    ├── Africa.png
    ├── Asia.png
    └── Australia.png

scripts/
├── download_lp.py            # Downloads + reprojects Lorenz PNGs to Web Mercator
└── generate_maps.py          # Optional: generates Natural Earth static map PNGs
```

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- A [Supabase](https://supabase.com/) project with the schema applied (see [Database](#database))

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/PavelVabrousek/DarkHorizon.git
cd DarkHorizon

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env — fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for production

```bash
npm run build
npm run preview
```

---

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL — e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) API key |

---

## License

MIT
