Here is a complete map of all **visible UI components** in the DarkHorizon app, organized by position on screen:

---

## 🗺️ Full-screen Map (base layer)
- **`MapView`** — the entire interactive map canvas (Leaflet)
  - **Layer: Physical** — ESRI hypsometric map (visible at zoom < 3)
  - **Layer: Topographic** — OpenTopoMap with contour lines (visible at zoom 3–11)
  - **Layer: Satellite** — ESRI World Imagery (visible at zoom ≥ 12, user-toggled)
  - **Layer: Light Pollution Overlay** — semi-transparent PNG heatmap of light pollution (user-toggled)
  - **Zoom Control** *(top-right corner)* — standard `+` / `−` buttons from Leaflet

---

## 📍 Location Markers (on the map)
- **`LocationMarkers`** — colored circle markers on the map (from Supabase DB)
  - **`LocationMarker` Popup** — appears on click, contains:
    - Site name
    - Score badge (currently `—`)
    - Bortle class + description
    - Elevation (m a.s.l.)
    - Optional note
    - Coordinates

---

## 🔍 Top Bar (HUD overlay)
- **`SearchBar`** *(top center)* — rounded pill input for searching locations
  - Search input field with placeholder `"Search location…"`
  - Search icon / Spinner icon (while loading)
  - Clear (✕) button (when text is entered)
  - **Dropdown results list** — up to 6 results, each with a pin icon, label and type hint

- **Branding pill** *(top left)* — DarkHorizon logo (SVG) + gradient text "DarkHorizon"

- **Layer indicator / Satellite toggle pill** *(top right, above zoom control)*
  - At zoom < 12: plain text showing current layer name + zoom level (e.g. `Topographic · zoom 8`)
  - At zoom ≥ 12: **clickable button** to toggle Satellite ↔ Topographic (with camera icon)

- **Coordinate + Elevation bar** *(top right, below the layer pill)*
  - Shows lat/lng of map center (e.g. `50.1234° N · 14.5678° E`)
  - Shows elevation in meters (fetched after 5 s of stillness); shows `…` while loading

---

## 📊 Bottom Bar (HUD overlay)
- **Site Score Legend** *(bottom left)*
  - "Site score" header
  - LP index row (Bortle class at map center)
  - Three colored dot rows: 🟢 Excellent / 🟡 Fair / 🔴 Poor

- **`MapControls` — Layers panel** *(bottom right)*
  - "Layers" header
  - **Light pollution** checkbox — toggles LP overlay on/off
    - **Opacity slider** — appears below checkbox when LP is enabled (10–90%)
  - **Street View button** — appears only at zoom ≥ 15, opens Google Street View in a new tab (pegman icon)

- **Scale bar** *(bottom center)* — shows a dynamic distance bar with label (e.g. `50 km`)

---

### Quick Reference by Component Name
| Component name | What to ask for |
|---|---|
| `SearchBar` | The search input at the top |
| `MapControls` | The "Layers" panel at bottom-right |
| `LocationMarkers` | The colored circle dots on the map |
| `LocationMarker Popup` | The popup that opens when clicking a marker |
| **Satellite toggle pill** | The layer mode button top-right |
| **Coordinate bar** | The lat/lng + elevation display |
| **Site Score Legend** | The colored dot legend bottom-left |
| **Scale bar** | The distance indicator at the bottom center |
| **Branding** | The DarkHorizon logo/name top-left |

You can now refer to any of these by name when requesting changes!
