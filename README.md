# DarkHorizon

**DarkHorizon** is a web application and Progressive Web App (PWA) for planning astronomical observations. Amateur astronomers use it to find the optimal observation site for a given night based on weather forecasts, long-term climate statistics, light pollution and astronomical conditions (Sun and Moon position).

## Features (planned)

- Interactive map with switchable base layers (physical overview, topographic detail, satellite imagery)
- Optional light pollution overlay (Lorenz 2024 atlas, adjustable opacity)
- Interactive map of observation sites with color-coded quality scores
- Hourly weather forecast overlays (cloud cover, precipitation, wind, seeing)
- Sun & Moon position tracking with twilight type classification
- Long-term climate statistics per location
- User authentication and personal observation logs
- Sky Quality Meter estimation from astrophoto analysis
- PWA installable on desktop and mobile

## Scoring system

| Score | Weight | Components |
|---|---|---|
| `weather_score` (0–100) | 50% of final | Cloud cover 60%, precipitation 25%, stability 15% |
| `darkness_score` (0–100) | 30% of final | Sun position 70%, Moon position/illumination 30% |
| `clima_score` (0–100) | 20% of final | Clear-sky probability 70%, precipitation 20%, wind 10% |

Map markers: **green** ≥ 70 · **yellow** 40–69 · **red** < 40

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Map | React Leaflet |
| Styling | Tailwind CSS |
| State | Zustand |
| Data fetching | TanStack React Query |
| Backend | Supabase (PostgreSQL + PostGIS + Auth + Storage) |
| Hosting | Vercel |

## Mapping layer architecture

The map is built on a four-pane Leaflet system. Each pane has its own CSS dark filter and z-index so layers can be shown, hidden, or blended independently without re-mounting the tile layer components.

### Base layers (only one visible at a time)

| Pane | z-index | Source | Active when |
|---|---|---|---|
| `paneEsri` | 200 | ESRI World Physical Map (hypsometric) | zoom < 3 |
| `paneTopo` | 201 | OpenTopoMap (contour lines + relief) | zoom 3–11, or zoom ≥ 12 in topo mode |
| `paneSat` | 202 | ESRI World Imagery (satellite) | zoom ≥ 12 **and** satellite mode active |

**ESRI World Physical** tile URL:
```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}
```
Max native zoom 8; Leaflet upscales beyond that. CSS filter: `brightness(0.60) contrast(1.10) saturate(0.85)`.

**OpenTopoMap** tile URL:
```
https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png
```
Max zoom 17. CSS filter: `brightness(0.50) contrast(1.10) saturate(0.65)`.

**ESRI World Imagery (satellite)** tile URL:
```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```
Free, no API key required. Max zoom 19. Attribution: *Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community.*

**Satellite / Topo mode toggle** lives in the HUD and is enabled (clickable) only when zoom ≥ 12. The selected mode is persisted in the Zustand `mapSettings` store; if the user zooms below 12 while in satellite mode the topo layer takes over automatically, and satellite resumes when they zoom back up.

### Overlay layers (togglable, stacked above base layers)

| Pane | z-index | Source | Default |
|---|---|---|---|
| `paneLp` | 400 | Lorenz 2024 LP — self-hosted `ImageOverlay` | off |
| `paneMarkers` | 500 | Observation site markers | — (future) |

**Lorenz 2024 Light Pollution Atlas** — self-hosted as static PNGs (global coverage), served by Vercel from `public/lp/`. The source PNGs from Lorenz are in **plate carree** (linear latitude), but Leaflet `ImageOverlay` stretches images linearly in **Web Mercator** screen space. Placing a plate-carree image directly in an ImageOverlay produces a severe N–S misalignment (at 50°N the overlay would show LP data from ~35°N, about 1 700 km too far south). The `download_lp.py` script corrects this by **reprojecting each PNG from plate carree to Web Mercator** before saving to `public/lp/`.

| File | Leaflet bounds `[[sw], [ne]]` | Size |
|---|---|---|
| `world_low3.png` | `[[-65,-180],[75,180]]` | 2.6 MB |
| `NorthAmerica.png` | `[[7,-180],[75,-51]]` | 2.2 MB |
| `SouthAmerica.png` | `[[-57,-93],[14,-33]]` | 1.6 MB |
| `Europe2024.png` | `[[34,-32],[75,70]]` | 2.3 MB |
| `Africa.png` | `[[-36,-26],[38,64]]` | 2.1 MB |
| `Asia.png` | `[[5,60],[75,180]]` | 3.2 MB |
| `Australia.png` | `[[-48,94],[8,180]]` | 0.7 MB |
| **Total** | | **14.7 MB** |

Resolution: 1/120° ≈ 750 m for continent maps; 1/40° ≈ 2.5 km for the world overview. The world overview is rendered at zoom 0–3; continent maps take over at zoom 4+ as they come into view.

All six continent `ImageOverlay` components are rendered simultaneously — Leaflet only fetches and paints those whose bounds intersect the current viewport. Attribution: *Light pollution data © David Lorenz, [djlorenz.github.io](https://djlorenz.github.io/astronomy/lp/).*

Color scale: zones 0–7b (black → grey → green → yellow → orange → red → white), compatible with the Bortle dark-sky scale used elsewhere in the app.

**Generating the assets (one-time, requires `pillow` and `numpy`):**
```bash
pip install pillow numpy
python scripts/download_lp.py
# Downloads originals to scripts/cache/lp/  (gitignored)
# Reprojects each to Web Mercator and saves to public/lp/  (~12.5 MB total)
# Commit public/lp/ to git — Vercel serves everything as static files.
```

LP overlay state (`lpVisible: boolean`, `lpOpacity: number 0–1, default 0.4`) lives in the Zustand `mapSettings` store. The HUD exposes an on/off toggle and an opacity slider.

### State management for map settings

A dedicated Zustand store (`src/store/mapSettings.ts`) owns all toggleable map-display state:

```ts
interface MapSettingsState {
  satelliteMode:  boolean           // false = topo, true = satellite (when zoom ≥ 12)
  lpVisible:      boolean           // light-pollution overlay on/off
  lpOpacity:      number            // 0–1, default 0.4
}
```

This keeps `MapView.tsx` as a pure display component that reads from the store, and lets future panels (e.g. a settings drawer) write to it without prop drilling.

### New component: MapControls

`src/components/MapControls.tsx` — floating HUD panel (bottom-right, above the Leaflet zoom control) that contains:

- **Topo / Satellite toggle** — icon button pair, satellite option disabled with tooltip when `zoom < 12`
- **Light Pollution toggle** — on/off icon button
- **LP Opacity slider** — visible only when LP is on; range 0–100%, step 5%

## Development roadmap

Steps marked ✅ are complete. Steps in **bold** are the current focus.

| # | Feature | Status |
|---|---|---|
| 1 | Project scaffold (Vite + React + TS + Tailwind + Leaflet) | ✅ |
| 2 | Base map — ESRI Physical + OpenTopoMap with dark CSS filters | ✅ |
| **3** | **Light pollution overlay (Lorenz 2024)** | pending |
| **4** | **Satellite view toggle for zoom ≥ 12 (ESRI World Imagery)** | pending |
| 5 | Map controls HUD component + `mapSettings` Zustand store | pending |
| 6 | Observation sites layer — Supabase fetch + color-coded markers | pending |
| 7 | Weather data integration — Open-Meteo API via React Query | pending |
| 8 | Site detail panel — click marker → hourly forecast | pending |
| 9 | Sun & Moon tracking + darkness score | pending |
| 10 | Climate statistics per location | pending |
| 11 | User authentication + personal observation logs | pending |
| 12 | Sky Quality Meter estimation | pending |
| 13 | PWA manifest + service worker | pending |

Steps 3–5 can be implemented together in a single session since they share the same Zustand store and `MapControls` component.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- A [Supabase](https://supabase.com/) project

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/dark-horizon.git
cd dark-horizon

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for production

```bash
npm run build
npm run preview
```

## Project structure

```
src/
├── components/
│   ├── MapView.tsx        # Leaflet map, pane setup, tile layers + LP ImageOverlay
│   └── MapControls.tsx    # HUD: satellite/topo toggle, LP toggle & opacity
├── pages/                 # Page-level components
├── hooks/                 # Custom React hooks
├── store/
│   └── mapSettings.ts     # Zustand: satelliteMode, lpVisible, lpOpacity
├── lib/
│   ├── supabase.ts        # Supabase client
│   └── openmeteo.ts       # Open-Meteo API client
└── types/
    ├── database.ts        # Supabase table types
    ├── location.ts        # Location & scoring types
    ├── weather.ts         # Weather & climate types
    └── astronomy.ts       # Sun/Moon & observation types

public/
└── lp/
    ├── world_low3.png     # World overview 1/40° (zoom 0–3)
    ├── NorthAmerica.png   # Continent maps 1/120° (zoom 4+)
    ├── SouthAmerica.png
    ├── Europe2024.png
    ├── Africa.png
    ├── Asia.png
    └── Australia.png      # All generated once by scripts/download_lp.py, then committed

scripts/
├── download_lp.py         # Downloads public/lp/Europe2024.png from Lorenz
└── generate_maps.py       # Generates Natural Earth static map PNGs (optional)
```

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous (public) API key |

## License

MIT
