# DarkHorizon

**DarkHorizon** is a web application and Progressive Web App (PWA) for planning astronomical observations. Amateur astronomers use it to find the optimal observation site for a given night based on weather forecasts, long-term climate statistics, light pollution and astronomical conditions (Sun and Moon position).

## Features (planned)

- Interactive map of observation sites with color-coded quality scores
- Hourly weather forecast overlays (cloud cover, precipitation, wind, seeing)
- Sun & Moon position tracking with twilight type classification
- Long-term climate statistics per location
- Light pollution overlay (Lorenz 2024)
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
├── components/   # Reusable UI components
├── pages/        # Page-level components
├── hooks/        # Custom React hooks
├── store/        # Zustand stores
├── lib/
│   ├── supabase.ts   # Supabase client
│   └── openmeteo.ts  # Open-Meteo API client
└── types/
    ├── database.ts   # Supabase table types
    ├── location.ts   # Location & scoring types
    ├── weather.ts    # Weather & climate types
    └── astronomy.ts  # Sun/Moon & observation types
```

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous (public) API key |

## License

MIT
