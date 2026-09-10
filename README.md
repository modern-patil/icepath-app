# ICEPATH — PS26059 Frontend Prototype

Antarctic sea-ice / iceberg trajectory / navigation decision-support demo UI.
All data in `src/App.jsx` (`FORECAST`, `ICEBERGS`, `ROUTES`, `ALERTS_SEED`) is
mocked — wire it up to your real GEE / FIRMS / ocean-model outputs later. 

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Build for deployment

```bash
npm run build
npm run preview
```

## Project layout

```
index.html          entry HTML
src/main.jsx         React root
src/App.jsx           all UI + logic (map, routes, alerts, forecast chart, 3D vessel)
src/App.css           theme (colors, type, layout)
```

## Next steps to go "full on"

1. Replace mock arrays with live API calls (satellite ice concentration,
   iceberg tracking, oceanographic/weather feeds).
2. Swap the stylised SVG map for a real geo-map (Leaflet/Mapbox) once
   real lat/lng data is flowing.
3. Replace the hardcoded route stats with real routing-optimization output.
4. Push alerts from a backend/websocket instead of the static seed list.
