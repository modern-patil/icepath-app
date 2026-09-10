import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Bell, X, Ship, Waves, Route as RouteIcon, TriangleAlert, Box, Satellite, Plus, RotateCcw,
  ZoomIn, ZoomOut,
} from "lucide-react";
import "./App.css";

// ---------------------------------------------------------------------------
// tiny seeded PRNG so the ice-dot field is stable across re-renders
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// elliptical zones roughly matching where the old ice-blob shapes sat
const ICE_ZONES = [
  { cx: 29, cy: 45, rx: 17, ry: 14 },
  { cx: 58, cy: 30, rx: 13, ry: 9 },
  { cx: 69, cy: 52, rx: 9, ry: 7 },
];

function generateIceDots(seed) {
  const rand = mulberry32(seed);
  const dots = [];
  ICE_ZONES.forEach((zone, zi) => {
    const count = 90;
    for (let i = 0; i < count; i++) {
      // rejection-sample a point inside the ellipse
      let x, y, dist;
      do {
        const ax = (rand() * 2 - 1);
        const ay = (rand() * 2 - 1);
        dist = ax * ax + ay * ay;
        x = zone.cx + ax * zone.rx;
        y = zone.cy + ay * zone.ry;
      } while (dist > 1);
      dots.push({ id: `${zi}-${i}`, x, y, r: 0.35 + rand() * 0.55, phase: rand(), op: 0.55 + rand() * 0.35 });
    }
  });
  return dots;
}

function generateTrafficShips(count) {
  const colors = ["#41586b", "#516a80", "#3c4f60"];
  const ships = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2.6 + Math.random() * 3.2;
    ships.push({
      id: `traffic-${i}`,
      x: 8 + Math.random() * 84,
      y: 8 + Math.random() * 84,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[i % colors.length],
    });
  }
  return ships;
}

// ---------------------------------------------------------------------------
// Mock data — swap for real GEE / satellite / ocean model outputs later
// ---------------------------------------------------------------------------
const FORECAST = [
  { day: "D1", ice: 62 }, { day: "D2", ice: 65 }, { day: "D3", ice: 70 },
  { day: "D4", ice: 74 }, { day: "D5", ice: 71 }, { day: "D6", ice: 68 },
  { day: "D7", ice: 66 }, { day: "D8", ice: 69 }, { day: "D9", ice: 73 },
  { day: "D10", ice: 77 }, { day: "D11", ice: 80 }, { day: "D12", ice: 78 },
  { day: "D13", ice: 75 }, { day: "D14", ice: 72 }, { day: "D15", ice: 70 },
  { day: "D16", ice: 74 }, { day: "D17", ice: 79 }, { day: "D18", ice: 83 },
  { day: "D19", ice: 81 }, { day: "D20", ice: 77 }, { day: "D21", ice: 73 },
];;

const ICEBERGS = [
  { id: "B-42", risk: "high", x: 62, y: 34, size: 9, note: "25 nm from route" },
  { id: "A-76", risk: "medium", x: 40, y: 58, size: 7, note: "33 nm from route" },
  { id: "C-19", risk: "low", x: 74, y: 62, size: 5, note: "76 nm from route" },
  { id: "D-33", risk: "medium", x: 30, y: 30, size: 6, note: "59 nm from route" },
];

const INITIAL_ROUTES = {
  fastest: {
    label: "Fastest",
    color: "#a78bfa",
    points: [[18, 78], [34, 60], [50, 46], [66, 30], [82, 16]],
    distance: "1,240 nm", eta: "3d 6h", fuel: 842, risk: 71,
  },
  safest: {
    label: "Safest",
    color: "#5eead4",
    points: [[18, 78], [28, 66], [38, 68], [52, 52], [60, 40], [72, 26], [82, 16]],
    distance: "1,365 nm", eta: "3d 19h", fuel: 738, risk: 24,
  },
};

// pool of extra routes the "+ Route" button pulls from
const ROUTE_PRESETS = [
  {
    id: "direct", label: "Direct", color: "#9b8cd6",
    points: [[18, 78], [40, 54], [60, 34], [82, 16]],
    distance: "1,180 nm", eta: "3d 1h", fuel: 905, risk: 88,
  },
  {
    id: "coastal", label: "Coastal", color: "#7fd49a",
    points: [[18, 78], [22, 60], [34, 44], [46, 40], [58, 34], [70, 26], [82, 16]],
    distance: "1,410 nm", eta: "4d 2h", fuel: 705, risk: 15,
  },
  {
    id: "polar-express", label: "Polar Express", color: "#e8875f",
    points: [[18, 78], [36, 70], [54, 58], [68, 40], [78, 22], [82, 16]],
    distance: "1,300 nm", eta: "3d 12h", fuel: 790, risk: 47,
  },
];

const SHIP_COLOR_POOL = ["#f4f6f7", "#fbbf24", "#5eead4", "#a78bfa", "#34d399", "#fb7185"];

// pool of ships the "+ Ship" button pulls from — first two are seeded already
const SHIP_POOL = [
  { name: "Aurora Australis", code: "AUS-1102" },
  { name: "Polar Star", code: "USCG-01" },
  { name: "Nathaniel B. Palmer", code: "NBP-09" },
  { name: "Akademik Fedorov", code: "RUS-77" },
  { name: "RSV Nuyina", code: "AUS-2201" },
];

const INITIAL_SHIPS = [
  { id: "ship-1", name: SHIP_POOL[0].name, code: SHIP_POOL[0].code, routeId: "safest", color: SHIP_COLOR_POOL[0] },
  { id: "ship-2", name: SHIP_POOL[1].name, code: SHIP_POOL[1].code, routeId: "fastest", color: SHIP_COLOR_POOL[1] },
];

const ALERTS_SEED = [
  { id: 1, level: "danger", text: "Iceberg B-42 crosses fastest route in ~6h" },
  { id: 2, level: "warning", text: "Dense ice ahead near 68°S — reroute advised" },
  { id: 3, level: "info", text: "Storm system 340 nm north-west, tracking away" },
  { id: 4, level: "danger", text: "Growler cluster detected 12 nm off safest route" },
  
];

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}  

// ---------------------------------------------------------------------------

export default function App() {
  const [day, setDay] = useState(4);
  const [alerts, setAlerts] = useState(ALERTS_SEED);
  const [show3D, setShow3D] = useState(false);
  const [satelliteView, setSatelliteView] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [selectedBergId, setSelectedBergId] = useState(null);
  const [selectedShipId, setSelectedShipId] = useState(null);

  const [routes, setRoutes] = useState(INITIAL_ROUTES);
  const [focusedRouteId, setFocusedRouteId] = useState("safest");
  const [routePool, setRoutePool] = useState(ROUTE_PRESETS);

  const [ships, setShips] = useState(INITIAL_SHIPS);
  const [shipPool, setShipPool] = useState(SHIP_POOL.slice(2));
  const [shipT, setShipT] = useState({ "ship-1": 0, "ship-2": 0.35 });

  const [trafficShips, setTrafficShips] = useState(() => generateTrafficShips(6));
  const iceDots = useMemo(() => generateIceDots(42), []);

  const [view, setView] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef(null);
  const svgRef = useRef(null);

  const canvasRef = useRef(null);
  const shipsRef = useRef(ships);
  shipsRef.current = ships;

  const selectedBerg = ICEBERGS.find((b) => b.id === selectedBergId) || null;
  const selectedShip = ships.find((s) => s.id === selectedShipId) || null;

  // live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ship progress along each ship's route, looping — one shared tick for all ships
  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setShipT((prev) => {
        const next = { ...prev };
        shipsRef.current.forEach((s) => {
          next[s.id] = ((prev[s.id] || 0) + dt * 0.05) % 1;
        });
        return next;
      });
      setTrafficShips((prev) =>
        prev.map((s) => {
          let { x, y, vx, vy } = s;
          // gentle random wander
          vx += (Math.random() - 0.5) * dt * 1.4;
          vy += (Math.random() - 0.5) * dt * 1.4;
          const speed = Math.hypot(vx, vy) || 1;
          const targetSpeed = 3.4;
          vx = (vx / speed) * targetSpeed;
          vy = (vy / speed) * targetSpeed;
          x += vx * dt;
          y += vy * dt;
          if (x < 4) { x = 4; vx = Math.abs(vx); }
          if (x > 96) { x = 96; vx = -Math.abs(vx); }
          if (y < 4) { y = 4; vy = Math.abs(vy); }
          if (y > 96) { y = 96; vy = -Math.abs(vy); }
          return { ...s, x, y, vx, vy };
        })
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const iceOpacity = 0.25 + (FORECAST[day - 1].ice / 100) * 0.55;
  const iceConcentration = FORECAST[day - 1].ice / 100;

  const fuelSaved = useMemo(() => {
    const vals = Object.values(routes).map((r) => r.fuel);
    const a = Math.max(...vals), b = Math.min(...vals);
    return (((a - b) / a) * 100).toFixed(1);
  }, [routes]);

  const cheapestRouteId = useMemo(() => {
    return Object.entries(routes).sort((a, b) => a[1].fuel - b[1].fuel)[0][0];
  }, [routes]);

  // three.js vessel view
 useEffect(() => {
    if (!show3D || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.clientWidth, height = canvas.clientHeight;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050b13, 6, 16);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 6);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 5, 2);
    scene.add(ambient, dir);

    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x0d2436, wireframe: true, transparent: true, opacity: 0.6 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.6;
    scene.add(ocean);

    // ---------- materials ----------
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xd9541e, roughness: 0.45, metalness: 0.1 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.6 });
    const superMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x1a4d44, emissiveIntensity: 0.6, roughness: 0.3 });
    const funnelMat = new THREE.MeshStandardMaterial({ color: 0x2b3542, roughness: 0.5 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x0e3a34, emissiveIntensity: 0.4 });

    const ship = new THREE.Group();
    const geoms = []; // track for disposal

    // ---------- hull (tapered bow via extruded shape) ----------
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.3, -0.45);
    hullShape.lineTo(-1.3, 0.45);
    hullShape.lineTo(0.6, 0.45);
    hullShape.quadraticCurveTo(1.25, 0.42, 1.55, 0.03);
    hullShape.quadraticCurveTo(1.25, -0.42, 0.6, -0.45);
    hullShape.lineTo(-1.3, -0.45);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.center();
    geoms.push(hullGeo);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.15;

    // dark boot stripe along waterline
    const bootGeo = new THREE.BoxGeometry(2.75, 0.08, 0.86);
    geoms.push(bootGeo);
    const boot = new THREE.Mesh(bootGeo, bootMat);
    boot.position.y = -0.1;

    // ---------- bridge / superstructure (tiered, toward stern) ----------
    const tier1Geo = new THREE.BoxGeometry(0.9, 0.32, 0.75);
    const tier2Geo = new THREE.BoxGeometry(0.62, 0.3, 0.6);
    const tier3Geo = new THREE.BoxGeometry(0.4, 0.24, 0.42);
    geoms.push(tier1Geo, tier2Geo, tier3Geo);
    const tier1 = new THREE.Mesh(tier1Geo, superMat);
    tier1.position.set(-0.55, 0.42, 0);
    const tier2 = new THREE.Mesh(tier2Geo, superMat);
    tier2.position.set(-0.55, 0.72, 0);
    const tier3 = new THREE.Mesh(tier3Geo, trimMat);
    tier3.position.set(-0.55, 0.98, 0);

    // bridge windows strip (glowing)
    const windowGeo = new THREE.BoxGeometry(0.64, 0.07, 0.78);
    geoms.push(windowGeo);
    const windowStrip = new THREE.Mesh(windowGeo, glassMat);
    windowStrip.position.set(-0.55, 0.58, 0);

    // ---------- funnel with stripe ----------
    const funnelGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.42, 12);
    const stripeGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.1, 12);
    geoms.push(funnelGeo, stripeGeo);
    const funnel = new THREE.Mesh(funnelGeo, funnelMat);
    funnel.position.set(-0.95, 0.85, 0);
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(-0.95, 1.02, 0);

    // ---------- mast + radar ----------
    const mastGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6);
    const radarGeo = new THREE.SphereGeometry(0.07, 10, 10);
    geoms.push(mastGeo, radarGeo);
    const mast = new THREE.Mesh(mastGeo, trimMat);
    mast.position.set(-0.55, 1.35, 0);
    const radar = new THREE.Mesh(radarGeo, trimMat);
    radar.position.set(-0.55, 1.62, 0);

    // ---------- bow crane (research vessels carry these) ----------
    const craneGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6);
    geoms.push(craneGeo);
    const crane = new THREE.Mesh(craneGeo, trimMat);
    crane.rotation.z = Math.PI / 3.2;
    crane.position.set(0.85, 0.4, 0.25);

    // ---------- helideck at stern ----------
    const deckGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.03, 24);
    geoms.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, trimMat);
    deck.position.set(-1.1, 0.2, 0);

    ship.add(hull, boot, tier1, tier2, tier3, windowStrip, funnel, stripe, mast, radar, crane, deck);
    ship.position.y = 0.2;
    ship.scale.set(0.95, 0.95, 0.95);
    scene.add(ship);

    let raf;
    const start = performance.now();
    const animate = (now) => {
      const time = (now - start) / 1000;
      ship.position.y = 0.2 + Math.sin(time * 1.4) * 0.05;
      ship.rotation.z = Math.sin(time * 1.1) * 0.03;
      ship.rotation.x = Math.sin(time * 0.9) * 0.02;
      camera.position.x = Math.sin(time * 0.25) * 5.5;
      camera.position.z = Math.cos(time * 0.25) * 5.5;
      camera.lookAt(0, 0.3, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      geoms.forEach((g) => g.dispose());
      [hullMat, bootMat, superMat, trimMat, glassMat, funnelMat, stripeMat].forEach((m) => m.dispose());
      ocean.geometry.dispose(); ocean.material.dispose();
    };
  }, [show3D]);

  const dismissAlert = (id) => setAlerts((a) => a.filter((al) => al.id !== id));

  const addRoute = () => {
    if (routePool.length === 0) return;
    const [next, ...rest] = routePool;
    setRoutes((r) => ({ ...r, [next.id]: next }));
    setRoutePool(rest);
  };

  const removeRoute = (routeId) => {
    if (Object.keys(routes).length <= 1) return;
    const remainingIds = Object.keys(routes).filter((id) => id !== routeId);
    const fallback = remainingIds[0];
    setShips((prev) => prev.map((s) => (s.routeId === routeId ? { ...s, routeId: fallback } : s)));
    setRoutes((r) => {
      const next = { ...r };
      delete next[routeId];
      return next;
    });
    if (focusedRouteId === routeId) setFocusedRouteId(fallback);
  };

  const addShip = () => {
    if (shipPool.length === 0) return;
    const [next, ...rest] = shipPool;
    const id = `ship-${Date.now()}`;
    const color = SHIP_COLOR_POOL[ships.length % SHIP_COLOR_POOL.length];
    const defaultRoute = Object.keys(routes)[0];
    setShips((s) => [...s, { id, name: next.name, code: next.code, routeId: defaultRoute, color }]);
    setShipT((t) => ({ ...t, [id]: Math.random() }));
    setShipPool(rest);
  };

  const removeShip = (id) => {
    if (ships.length <= 1) return;
    setShips((s) => s.filter((sh) => sh.id !== id));
    if (selectedShipId === id) setSelectedShipId(null);
  };

  const reassignShipRoute = (id, routeId) => {
    setShips((s) => s.map((sh) => (sh.id === id ? { ...sh, routeId } : sh)));
  };

  const handlePanStart = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    setIsPanning(true);
  };

  const handlePanMove = (e) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.x) / rect.width) * view.w;
    const dy = ((e.clientY - dragRef.current.y) / rect.height) * view.h;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({
      ...v,
      x: clamp(v.x - dx, -40, 140 - v.w),
      y: clamp(v.y - dy, -40, 140 - v.h),
    }));
  };

  const handlePanEnd = () => {
    dragRef.current = null;
    setIsPanning(false);
  };

  // native (non-passive) wheel listener — this is the fix for zoom fighting
  // with page scroll. React's synthetic onWheel plus a scrollable page body
  // was the cause of "zoom not working well".
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        const newW = clamp(v.w * factor, 18, 100);
        const newH = clamp(v.h * factor, 18, 100);
        const focusX = v.x + px * v.w;
        const focusY = v.y + py * v.h;
        return {
          w: newW,
          h: newH,
          x: clamp(focusX - px * newW, -40, 140 - newW),
          y: clamp(focusY - py * newH, -40, 140 - newH),
        };
      });
    };
    svgEl.addEventListener("wheel", onWheel, { passive: false });
    return () => svgEl.removeEventListener("wheel", onWheel);
  }, []);

  // button-driven zoom, zooms toward the current center
  const zoomBy = (factor) => {
    setView((v) => {
      const newW = clamp(v.w * factor, 18, 100);
      const newH = clamp(v.h * factor, 18, 100);
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return {
        w: newW,
        h: newH,
        x: clamp(cx - newW / 2, -40, 140 - newW),
        y: clamp(cy - newH / 2, -40, 140 - newH),
      };
    });
  };

  const resetView = () => setView({ x: 0, y: 0, w: 100, h: 100 });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Waves size={20} />
          <span>ICEPATH</span>
          <span className="brand-sub">Antarctic Decision Support — PS26059</span>
        </div>
        <div className="topbar-right">
          <span className="clock">{clock.toUTCString().slice(17, 25)} UTC</span>
          <button className="icon-btn" aria-label="alerts">
            <Bell size={17} />
            {alerts.length > 0 && <span className="badge">{alerts.length}</span>}
          </button>
        </div>
      </header>

      <main className="layout">
        {/* MAP */}
        <section className="map-panel">
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid slice"
            className={`map-svg ${isPanning ? "panning" : ""}`}
            onMouseDown={handlePanStart}
            onMouseMove={handlePanMove}
            onMouseUp={handlePanEnd}
            onMouseLeave={handlePanEnd}
          >
            <defs>
              <radialGradient id="ocean" cx="46%" cy="40%" r="80%">
                <stop offset="0%" stopColor="#0d2436" />
                <stop offset="55%" stopColor="#081726" />
                <stop offset="100%" stopColor="#050b13" />
              </radialGradient>
              <radialGradient id="oceanSat" cx="42%" cy="36%" r="85%">
                <stop offset="0%" stopColor="#0f241f" />
                <stop offset="55%" stopColor="#0a1815" />
                <stop offset="100%" stopColor="#050b13" />
              </radialGradient>
              <linearGradient id="coastShade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#26374a" />
                <stop offset="100%" stopColor="#161f2c" />
              </linearGradient>
              <linearGradient id="coastShadeSat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3a3324" />
                <stop offset="100%" stopColor="#211d14" />
              </linearGradient>
              <filter id="iceTexture" x="-30%" y="-30%" width="160%" height="160%">
                <feTurbulence type="fractalNoise" baseFrequency="0.09 0.14" numOctaves="2" seed="7" result="noise" />
                <feColorMatrix in="noise" type="matrix"
                  values="0 0 0 0 0.93  0 0 0 0 0.97  0 0 0 0 1  0 0 0 0.9 0" result="tinted" />
                <feComposite in="tinted" in2="SourceGraphic" operator="in" />
              </filter>
              <filter id="grain" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="2" seed="4" result="n" />
                <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
              </filter>
              <filter id="pinShadow" x="-60%" y="-40%" width="220%" height="220%">
                <feDropShadow dx="0" dy="0.5" stdDeviation="0.4" floodColor="#0d1b2a" floodOpacity="0.35" />
              </filter>
              <filter id="routeShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0.3" stdDeviation="0.3" floodColor="#0d1b2a" floodOpacity="0.25" />
              </filter>
              <clipPath id="frame"><rect x="0" y="0" width="100" height="100" /></clipPath>
            </defs>

            <rect x="0" y="0" width="100" height="100" fill={satelliteView ? "url(#oceanSat)" : "url(#ocean)"} />

            {/* polar graticule */}
            <g clipPath="url(#frame)" stroke="#1f5c73" fill="none" opacity={satelliteView ? 0.18 : 1}>
              {[28, 52, 76, 100, 124].map((r) => (
                <circle key={r} cx="46" cy="146" r={r} strokeWidth="0.22" opacity="0.5" />
              ))}
              {[-40, -20, 0, 20, 40].map((deg) => {
                const rad = (deg * Math.PI) / 180;
                const x2 = 46 + Math.sin(rad) * 140;
                const y2 = 146 - Math.cos(rad) * 140;
                return <line key={deg} x1="46" y1="146" x2={x2} y2={y2} strokeWidth="0.18" opacity="0.4" />;
              })}
            </g>
            <text x="46" y="16" className="map-tick">70°S</text>
            <text x="46" y="40" className="map-tick">72°S</text>

            {/* coastline */}
            <path
              d="M-4,104 L-3,78 Q3,66 12,63 Q18,61 24,64 Q30,67 36,63 Q42,59 48,60 Q56,61 60,55 Q64,49 70,50 Q78,52 82,46 Q88,39 94,41 Q99,42.5 104,45 L104,104 Z"
              fill={satelliteView ? "url(#coastShadeSat)" : "url(#coastShade)"}
              stroke={satelliteView ? "#332c1c" : "#324457"} strokeWidth="0.35"
              filter={satelliteView ? "url(#iceTexture)" : undefined}
            />
            <path
              d="M-3,78 Q3,66 12,63 Q18,61 24,64 Q30,67 36,63 Q42,59 48,60 Q56,61 60,55 Q64,49 70,50 Q78,52 82,46 Q88,39 94,41"
              fill="none" stroke="#5eead4" strokeOpacity="0.35" strokeWidth="0.3" strokeDasharray="0.2,1.6" strokeLinecap="round"
            />

            {/* ice concentration field — scattered dots, density follows forecast day */}
            <g>
              {iceDots.map((d) => (
                <circle
                  key={d.id}
                  cx={d.x} cy={d.y} r={d.r}
                  fill="#ffffff"
                  opacity={d.op * iceConcentration * (0.6 + 0.4 * Math.sin(d.phase * 6.28))}
                />
              ))}
            </g>

            {/* satellite grain overlay */}
            {satelliteView && (
              <rect x="0" y="0" width="100" height="100" filter="url(#grain)" opacity="0.5" style={{ mixBlendMode: "overlay" }} />
            )}

            {/* routes */}
            {Object.entries(routes).map(([key, r]) => (
              <g key={key} opacity={key === focusedRouteId ? 1 : 0.55}>
                <polyline
                  points={r.points.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke="#ffffff"
                  strokeWidth={key === focusedRouteId ? 1.5 : 0.9}
                  strokeLinecap="round" strokeLinejoin="round"
                />
                <polyline
                  points={r.points.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={r.color}
                  strokeWidth={key === focusedRouteId ? 0.85 : 0.45}
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={key !== cheapestRouteId ? "1.8,1.4" : "none"}
                  filter={key === focusedRouteId ? "url(#routeShadow)" : undefined}
                />
              </g>
            ))}

            {/* icebergs as map pins */}
            {ICEBERGS.map((b) => {
              const s = Math.max(b.size * 0.11, 0.9);
              const isSelected = b.id === selectedBergId;
              return (
                <g
                  key={b.id}
                  transform={`translate(${b.x},${b.y})`}
                  filter="url(#pinShadow)"
                  className="berg-pin"
                  onClick={() => { setSelectedBergId(b.id); setSelectedShipId(null); }}
                >
                  <title>{b.id} — {b.risk} risk, {b.note}</title>
                  {b.risk === "high" && <circle r={b.size * 0.55} className="pulse" fill="none" stroke="var(--danger)" strokeWidth="0.4" />}
                  {isSelected && <circle r={s * 5.4} fill="none" stroke="var(--cyan)" strokeWidth="0.4" strokeDasharray="0.6,0.6" />}
                 <path
  d={`M${-s * 2.6},${s * 0.5}
      L${-s * 1.7},${-s * 2.6}
      L${-s * 0.7},${-s * 1.5}
      L0,${-s * 4.3}
      L${s * 0.8},${-s * 1.7}
      L${s * 1.8},${-s * 3.1}
      L${s * 2.6},${s * 0.5}
      Z`}
  fill={isSelected ? "var(--cyan)" : riskColor(b.risk)}
  stroke="#ffffff"
  strokeWidth="0.3"
  strokeLinejoin="round"
/>
                </g>
              );
            })}

            {/* background traffic — small unlabeled ships wandering at random */}
            {trafficShips.map((s) => {
              const angle = (Math.atan2(s.vx, -s.vy) * 180) / Math.PI;
              return (
                <g key={s.id} transform={`translate(${s.x},${s.y}) rotate(${angle})`} opacity="0.75">
                  <polygon points="0,-1.1 0.65,0.9 -0.65,0.9" fill={s.color} stroke="var(--void)" strokeWidth="0.1" />
                </g>
              );
            })}

            {/* ships */}
            {ships.map((s) => {
              const route = routes[s.routeId];
            if (!route || !route.points || route.points.length < 2) return null;
              const pos = pointOnPath(route.points, shipT[s.id] || 0);
              const isSelected = s.id === selectedShipId;
              return (
                <g
                  key={s.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  className="ship-pin"
                  onClick={() => { setSelectedShipId(s.id); setSelectedBergId(null); }}
                >
                  {isSelected && <circle r="4.2" fill="none" stroke="var(--cyan)" strokeWidth="0.4" strokeDasharray="0.6,0.6" />}
                  <g transform={`rotate(${pos.angle})`} filter="url(#pinShadow)">
                    <circle r="2.1" fill="#ffffff" opacity="0.9" />
                    <path
                      d="M0,-1.75 C0.62,-1.2 0.82,-0.35 0.82,0.35 L0.82,0.95 C0.82,1.15 0.66,1.3 0.46,1.3
                         L-0.46,1.3 C-0.66,1.3 -0.82,1.15 -0.82,0.95 L-0.82,0.35
                         C-0.82,-0.35 -0.62,-1.2 0,-1.75 Z"
                      fill={s.color} stroke="var(--void)" strokeWidth="0.12"
                    />
                    <rect x="-0.28" y="-0.15" width="0.56" height="0.55" rx="0.08" fill="var(--void)" />
                  </g>
                  <g transform="translate(0,-3.4)">
                    <title>{s.name} ({s.code})</title>
                    <rect x={-(s.code.length * 0.85 + 1.2)} y="-1.6" width={s.code.length * 1.7 + 2.4} height="2.6" rx="1.3"
                      fill="rgba(5,11,19,0.85)" stroke={s.color} strokeWidth="0.15" />
                    <text textAnchor="middle" y="0.35" className="ship-label">{s.code}</text>
                  </g>
                </g>
              );
            })}

            <text x="24" y="80" className="map-label">WEDDELL SEA</text>
            <text x="68" y="30" className="map-label">ROSS SEA</text>

            {/* compass */}
            <g transform="translate(91,11)">
              <circle r="5.4" fill="rgba(5,11,19,0.85)" stroke="var(--border)" strokeWidth="0.3" />
              <line x1="0" y1="3.6" x2="0" y2="-3.6" stroke="var(--ink)" strokeWidth="0.35" />
              <polygon points="0,-3.9 0.8,-2.3 -0.8,-2.3" fill="var(--cyan)" />
              <text x="0" y="-4.6" textAnchor="middle" className="map-tick">GN</text>
            </g>

            {/* scale bar */}
            <g transform="translate(8,92)">
              <line x1="0" y1="0" x2="14" y2="0" stroke="var(--ink)" strokeWidth="0.35" />
              <line x1="0" y1="-0.8" x2="0" y2="0.8" stroke="var(--ink)" strokeWidth="0.35" />
              <line x1="14" y1="-0.8" x2="14" y2="0.8" stroke="var(--ink)" strokeWidth="0.35" />
              <text x="7" y="3.6" textAnchor="middle" className="map-tick">≈ 250 nm</text>
            </g>
          </svg>

          <div className="map-legend">
            <span className="map-legend-label">Ice concentration</span>
            <div className="map-legend-bar"><div className="map-legend-marker" style={{ left: `${Math.min(iceOpacity * 100, 100)}%` }} /></div>
            <span className="map-legend-value">{FORECAST[day - 1].ice}%</span>
          </div>

          <div className="map-controls">
            <button
              className={`chip chip-icon-only ${satelliteView ? "chip-active" : ""}`}
              onClick={() => setSatelliteView((v) => !v)}
              title="Toggle satellite view"
            >
              <Satellite size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              Satellite
            </button>
            <button className="chip" onClick={addShip} disabled={shipPool.length === 0} title="Add ship">
              <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
              Ship
            </button>
            <button className="chip" onClick={addRoute} disabled={routePool.length === 0} title="Add route">
              <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
              Route
            </button>
            <button className={`chip chip-3d ${show3D ? "chip-active" : ""}`} onClick={() => setShow3D((v) => !v)}>
              <Box size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              3D vessel
            </button>
            {(view.w !== 100 || view.x !== 0 || view.y !== 0) && (
              <button className="chip" onClick={resetView} title="Reset view">
                <RotateCcw size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                Reset
              </button>
            )}
          </div>

          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => zoomBy(0.8)} title="Zoom in"><ZoomIn size={15} /></button>
            <button className="zoom-btn" onClick={() => zoomBy(1.25)} title="Zoom out"><ZoomOut size={15} /></button>
          </div>

          {show3D && (
            <div className="vessel-3d">
              <canvas ref={canvasRef} className="vessel-canvas" />
              <span className="vessel-caption">Live vessel attitude — simulated</span>
            </div>
          )}
        </section>

        {/* SIDEBAR */}
        <aside className="sidebar">
          {alerts.length > 0 && (
            <div className="card alerts-card">
              <div className="card-title"><TriangleAlert size={14} /> Alerts</div>
              {alerts.map((a) => (
                <div key={a.id} className={`alert-row alert-${a.level}`}>
                  <span className="alert-dot" />
                  <span className="alert-text">{a.text}</span>
                  <button className="alert-dismiss" onClick={() => dismissAlert(a.id)}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Ship size={14} /> Fleet</span>
              <button className="mini-add-btn" onClick={addShip} disabled={shipPool.length === 0}>
                <Plus size={12} /> Ship
              </button>
            </div>
            <ul className="fleet-list">
              {ships.map((s) => (
                <li
                  key={s.id}
                  className={s.id === selectedShipId ? "fleet-item-selected" : ""}
                  onClick={() => setSelectedShipId(s.id)}
                >
                  <span className="fleet-dot" style={{ background: s.color }} />
                  <div className="fleet-info">
                    <span className="fleet-name">{s.name}</span>
                    <span className="fleet-code">{s.code}</span>
                  </div>
                  <select
                    className="fleet-route-select"
                    value={s.routeId}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => reassignShipRoute(s.id, e.target.value)}
                  >
                    {Object.entries(routes).map(([key, r]) => (
                      <option key={key} value={key}>{r.label}</option>
                    ))}
                  </select>
                  {ships.length > 1 && (
                    <button
                      className="fleet-remove"
                      onClick={(e) => { e.stopPropagation(); removeShip(s.id); }}
                    ><X size={12} /></button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {selectedShip && (
            <div className="card ship-detail-card">
              <div className="card-title">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Ship size={14} /> {selectedShip.name}
                </span>
                <button className="berg-detail-close" onClick={() => setSelectedShipId(null)}><X size={13} /></button>
              </div>
              <dl className="berg-detail-list">
                <dt>Code</dt>
                <dd>{selectedShip.code}</dd>
                <dt>Route</dt>
                <dd>{routes[selectedShip.routeId]?.label || "—"}</dd>
                <dt>Distance</dt>
                <dd>{routes[selectedShip.routeId]?.distance || "—"}</dd>
                <dt>ETA</dt>
                <dd>{routes[selectedShip.routeId]?.eta || "—"}</dd>
                <dt>Fuel</dt>
                <dd>{routes[selectedShip.routeId]?.fuel ?? "—"} t</dd>
                <dt>Risk score</dt>
                <dd>{routes[selectedShip.routeId]?.risk ?? "—"}/100</dd>
              </dl>
              <div className="ship-detail-route-row">
                <span className="ship-detail-route-label">Reassign route</span>
                <select
                  className="fleet-route-select"
                  value={selectedShip.routeId}
                  onChange={(e) => reassignShipRoute(selectedShip.id, e.target.value)}
                >
                  {Object.entries(routes).map(([key, r]) => (
                    <option key={key} value={key}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><RouteIcon size={14} /> Routes</span>
              <button className="mini-add-btn" onClick={addRoute} disabled={routePool.length === 0}>
                <Plus size={12} /> Route
              </button>
            </div>
            <div className="route-compare">
              {Object.entries(routes).map(([key, r]) => (
                <div
                  key={key}
                  className={`route-col ${key === cheapestRouteId ? "route-recommended" : ""} ${key === focusedRouteId ? "route-focused" : ""}`}
                  onClick={() => setFocusedRouteId(key)}
                >
                  <div className="route-col-head">
                    <span className="route-swatch" style={{ background: r.color }} />
                    {r.label}
                    {key === cheapestRouteId && <span className="pill">Best fuel</span>}
                    {Object.keys(routes).length > 1 && (
                      <button
                        className="route-remove"
                        onClick={(e) => { e.stopPropagation(); removeRoute(key); }}
                      ><X size={11} /></button>
                    )}
                  </div>
                  <dl>
                    <dt>Distance</dt><dd>{r.distance}</dd>
                    <dt>ETA</dt><dd>{r.eta}</dd>
                    <dt>Fuel</dt><dd>{r.fuel} t</dd>
                    <dt>Risk score</dt><dd>{r.risk}/100</dd>
                  </dl>
                </div>
              ))}
            </div>
          </div>

          <div className="card fuel-card">
            <div className="card-title"><Ship size={14} /> Max fuel spread</div>
            <div className="fuel-body">
              <svg className="fuel-gauge" width="64" height="64" viewBox="0 0 64 64">
                <circle className="fuel-gauge-track" cx="32" cy="32" r="26" />
                <circle
                  className="fuel-gauge-fill"
                  cx="32" cy="32" r="26"
                  strokeDasharray={2 * Math.PI * 26}
                  strokeDashoffset={2 * Math.PI * 26 * (1 - fuelSaved / 100)}
                  transform="rotate(-90 32 32)"
                />
                <text x="32" y="37" textAnchor="middle" className="fuel-gauge-number">{fuelSaved}%</text>
              </svg>
              <div className="fuel-info">
                <span className="fuel-caption">Spread between cheapest and priciest route currently on offer.</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Sea-ice forecast</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={FORECAST} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="iceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5eead4" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(125,211,252,0.1)" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#7c93a8", fontSize: 10 }} axisLine={{ stroke: "rgba(125,211,252,0.15)" }} tickLine={false} interval={2} />
                  <YAxis tick={{ fill: "#7c93a8", fontSize: 10 }} axisLine={false} tickLine={false} width={26} />
                  <Tooltip contentStyle={{ background: "#0e1c2b", border: "1px solid rgba(125,211,252,0.25)", fontSize: 12, color: "#e9f4fb", borderRadius: 8 }} />
                  <ReferenceLine x={FORECAST[day - 1].day} stroke="#fb7185" strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="ice" stroke="#5eead4" fill="url(#iceFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <input
              type="range" min="1" max="21" value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="slider"
            />
            <div className="slider-caption">Day {day} of 21 — {FORECAST[day - 1].ice}% concentration</div>
          </div>

          <div className="card">
            <div className="card-title">Iceberg watch</div>
            <ul className="berg-list">
              {ICEBERGS.map((b) => (
                <li
                  key={b.id}
                  className={b.id === selectedBergId ? "berg-item-selected" : ""}
                  onClick={() => { setSelectedBergId(b.id); setSelectedShipId(null); }}
                >
                  <span className="berg-dot" style={{ background: riskColor(b.risk) }} />
                  <span className="berg-id">{b.id}</span>
                  <span className="berg-note">{b.note}</span>
                </li>
              ))}
            </ul>
          </div>

          {selectedBerg && (
            <div className="card berg-detail-card">
              <div className="card-title">
                Iceberg {selectedBerg.id}
                <button className="berg-detail-close" onClick={() => setSelectedBergId(null)}><X size={13} /></button>
              </div>
              <dl className="berg-detail-list">
                <dt>Risk level</dt>
                <dd><span className="risk-pill" style={{ background: riskColor(selectedBerg.risk) }}>{selectedBerg.risk}</span></dd>
                <dt>Distance</dt>
                <dd>{selectedBerg.note}</dd>
                <dt>Relative size</dt>
                <dd>{selectedBerg.size} / 10</dd>
                <dt>Map position</dt>
                <dd>x {selectedBerg.x}, y {selectedBerg.y}</dd>
              </dl>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function riskColor(risk) {
  if (risk === "high") return "var(--danger)";
  if (risk === "medium") return "var(--amber)";
  return "var(--success)";
}

// interpolate a point + heading angle along a polyline, t in [0,1]
function pointOnPath(points, t) {
  if (!points || points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) {
    const [x, y] = points[0];
    return { x, y, angle: 0 };
  }

  const segs = points.length - 1;
  const scaled = clamp(t, 0, 1) * segs;
  const i = Math.min(Math.max(Math.floor(scaled), 0), segs - 1);
  const localT = scaled - i;

  const p1 = points[i];
  const p2 = points[i + 1];
  if (!p1 || !p2) return { x: 0, y: 0, angle: 0 };

  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const x = x1 + (x2 - x1) * localT;
  const y = y1 + (y2 - y1) * localT;
  const angle = (Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI;
  return { x, y, angle };
}