import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Bell, X, Ship, Waves, Route as RouteIcon, TriangleAlert, Box } from "lucide-react";
import "./App.css";

// ---------------------------------------------------------------------------
// Mock data — swap for real GEE / satellite / ocean model outputs later
// ---------------------------------------------------------------------------
const FORECAST = [
  { day: "D1", ice: 62 }, { day: "D2", ice: 65 }, { day: "D3", ice: 70 },
  { day: "D4", ice: 74 }, { day: "D5", ice: 71 }, { day: "D6", ice: 68 }, { day: "D7", ice: 66 },
];

const ICEBERGS = [
  { id: "B-42", risk: "high", x: 62, y: 34, size: 9, note: "1.4 km from route" },
  { id: "A-76", risk: "medium", x: 40, y: 58, size: 7, note: "6.1 km from route" },
  { id: "C-19", risk: "low", x: 74, y: 62, size: 5, note: "14 km from route" },
  { id: "D-33", risk: "medium", x: 30, y: 30, size: 6, note: "8.7 km from route" },
];

const ROUTES = {
  fastest: {
    label: "Fastest",
    color: "#5fc4c9",
    points: [[18, 78], [34, 60], [50, 46], [66, 30], [82, 16]],
    distance: "1,240 nm", eta: "3d 6h", fuel: 842, risk: 71,
  },
  safest: {
    label: "Safest",
    color: "#e8ac5f",
    points: [[18, 78], [28, 66], [38, 68], [52, 52], [60, 40], [72, 26], [82, 16]],
    distance: "1,365 nm", eta: "3d 19h", fuel: 738, risk: 24,
  },
};

const ALERTS_SEED = [
  { id: 1, level: "danger", text: "Iceberg B-42 crosses fastest route in ~6h" },
  { id: 2, level: "warning", text: "Dense ice ahead near 68°S — reroute advised" },
  { id: 3, level: "info", text: "Storm system 340 nm north-west, tracking away" },
];

// ---------------------------------------------------------------------------

export default function App() {
  const [day, setDay] = useState(4);
  const [activeRoute, setActiveRoute] = useState("safest");
  const [alerts, setAlerts] = useState(ALERTS_SEED);
  const [show3D, setShow3D] = useState(false);
  const [t, setT] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [selectedBergId, setSelectedBergId] = useState(null);

  const selectedBerg = ICEBERGS.find((b) => b.id === selectedBergId) || null;

  const canvasRef = useRef(null);

  // live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ship progress along active route, looping
  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => (prev + dt * 0.06) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const shipPos = useMemo(() => pointOnPath(ROUTES[activeRoute].points, t), [activeRoute, t]);

  const iceOpacity = 0.25 + (FORECAST[day - 1].ice / 100) * 0.55;

  const fuelSaved = useMemo(() => {
    const a = ROUTES.fastest.fuel, b = ROUTES.safest.fuel;
    return (((a - b) / a) * 100).toFixed(1);
  }, []);

  // three.js vessel view
  useEffect(() => {
    if (!show3D || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.clientWidth, height = canvas.clientHeight;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a2136, 6, 16);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 6);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 5, 2);
    scene.add(ambient, dir);

    // ocean plane
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x1f5680, wireframe: true, transparent: true, opacity: 0.6 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.6;
    scene.add(ocean);

    // vessel group
    const ship = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.6 });
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xe8ac5f, roughness: 0.4, emissive: 0x7a4d1e, emissiveIntensity: 0.15 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.9), hullMat);
    hull.position.y = 0;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), trimMat);
    bow.rotation.z = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.scale.set(1, 1, 2);
    bow.position.set(1.5, 0, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.6), trimMat);
    cabin.position.set(-0.6, 0.5, 0);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 12), iceMat);
    funnel.position.set(-1.0, 0.8, 0);

    ship.add(hull, bow, cabin, funnel);
    ship.position.y = 0.2;
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
      camera.lookAt(0, 0.2, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      hull.geometry.dispose(); bow.geometry.dispose(); cabin.geometry.dispose(); funnel.geometry.dispose();
      hullMat.dispose(); trimMat.dispose(); iceMat.dispose();
      ocean.geometry.dispose(); ocean.material.dispose();
    };
  }, [show3D]);

  const dismissAlert = (id) => setAlerts((a) => a.filter((al) => al.id !== id));

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
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="map-svg">
            <defs>
              <radialGradient id="ocean" cx="46%" cy="40%" r="80%">
                <stop offset="0%" stopColor="#1a3f5c" />
                <stop offset="55%" stopColor="#0f2c46" />
                <stop offset="100%" stopColor="#0a2136" />
              </radialGradient>
              <linearGradient id="coastShade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ece4d2" />
                <stop offset="100%" stopColor="#d8c9a3" />
              </linearGradient>
              <linearGradient id="legendGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e8ac5f" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#e8ac5f" stopOpacity="0.9" />
              </linearGradient>
              <filter id="iceTexture" x="-30%" y="-30%" width="160%" height="160%">
                <feTurbulence type="fractalNoise" baseFrequency="0.09 0.14" numOctaves="2" seed="7" result="noise" />
                <feColorMatrix in="noise" type="matrix"
                  values="0 0 0 0 0.93  0 0 0 0 0.97  0 0 0 0 1  0 0 0 0.9 0" result="tinted" />
                <feComposite in="tinted" in2="SourceGraphic" operator="in" />
              </filter>
              <filter id="pinShadow" x="-60%" y="-40%" width="220%" height="220%">
                <feDropShadow dx="0" dy="0.5" stdDeviation="0.4" floodColor="#202124" floodOpacity="0.35" />
              </filter>
              <filter id="routeShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0.3" stdDeviation="0.3" floodColor="#202124" floodOpacity="0.25" />
              </filter>
              <clipPath id="frame"><rect x="0" y="0" width="100" height="100" /></clipPath>
            </defs>

            <rect x="0" y="0" width="100" height="100" fill="url(#ocean)" />

            {/* polar graticule — rings + radii from an off-canvas pole, evoking a stereographic chart */}
            <g clipPath="url(#frame)" stroke="#3d6d94" fill="none">
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

            {/* coastline with grounding line + shelf edge */}
            <path
              d="M-4,104 L-3,78 Q3,66 12,63 Q18,61 24,64 Q30,67 36,63 Q42,59 48,60 Q56,61 60,55 Q64,49 70,50 Q78,52 82,46 Q88,39 94,41 Q99,42.5 104,45 L104,104 Z"
              fill="url(#coastShade)" stroke="#c7b487" strokeWidth="0.35"
            />
            <path
              d="M-3,78 Q3,66 12,63 Q18,61 24,64 Q30,67 36,63 Q42,59 48,60 Q56,61 60,55 Q64,49 70,50 Q78,52 82,46 Q88,39 94,41"
              fill="none" stroke="#e8ac5f" strokeOpacity="0.4" strokeWidth="0.3" strokeDasharray="0.2,1.6" strokeLinecap="round"
            />

            {/* ice concentration fields — organic, textured, scaled by forecast day */}
            <g opacity={iceOpacity}>
              <path d="M14,42 Q18,30 32,32 Q47,33 47,45 Q49,56 34,59 Q17,61 12,52 Z" fill="#ffffff" filter="url(#iceTexture)" />
              <path d="M45,29 Q53,20 66,24 Q75,28 71,37 Q67,44 56,42 Q45,40 45,29 Z" fill="#ffffff" filter="url(#iceTexture)" />
              <path d="M61,47 Q68,42 77,47 Q81,53 74,58 Q65,61 60,54 Z" fill="#ffffff" filter="url(#iceTexture)" />
            </g>

            {/* routes — Google-Directions style: pale casing under a solid line */}
            {Object.entries(ROUTES).map(([key, r]) => (
              <g key={key} opacity={key === activeRoute ? 1 : 0.55}>
                <polyline
                  points={r.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={key === activeRoute ? 1.5 : 0.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={r.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={key === activeRoute ? 0.85 : 0.45}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={key === "fastest" ? "1.8,1.4" : "none"}
                  filter={key === activeRoute ? "url(#routeShadow)" : undefined}
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
                  onClick={() => setSelectedBergId(b.id)}
                >
                  <title>{b.id} — {b.risk} risk, {b.note}</title>
                  {b.risk === "high" && <circle r={b.size * 0.55} className="pulse" fill="none" stroke="var(--danger)" strokeWidth="0.4" />}
                  {isSelected && <circle r={s * 5.4} fill="none" stroke="var(--brass-light)" strokeWidth="0.4" strokeDasharray="0.6,0.6" />}
                  <path
                    d={`M0,${-s * 4.4} C${s * 2.4},${-s * 4.4} ${s * 2.6},${-s * 1.2} 0,${s * 0.4}
                        C${-s * 2.6},${-s * 1.2} ${-s * 2.4},${-s * 4.4} 0,${-s * 4.4} Z`}
                    fill={isSelected ? "var(--brass-light)" : riskColor(b.risk)} stroke="#ffffff" strokeWidth="0.3"
                  />
                  <circle cy={-s * 2.9} r={s * 1.05} fill="#ffffff" />
                </g>
              );
            })}

            {/* ship wake trail */}
            {[0.02, 0.014, 0.008].map((back, i) => {
              const p = pointOnPath(ROUTES[activeRoute].points, (t - back + 1) % 1);
              return <circle key={i} cx={p.x} cy={p.y} r={0.55 - i * 0.12} fill="#ffffff" opacity={0.55 - i * 0.15} />;
            })}

            {/* ship */}
            <g transform={`translate(${shipPos.x},${shipPos.y}) rotate(${shipPos.angle})`} filter="url(#pinShadow)">
              <circle r="2.1" fill="#ffffff" opacity="0.9" />
              <path
                d="M0,-1.75 C0.62,-1.2 0.82,-0.35 0.82,0.35 L0.82,0.95 C0.82,1.15 0.66,1.3 0.46,1.3
                   L-0.46,1.3 C-0.66,1.3 -0.82,1.15 -0.82,0.95 L-0.82,0.35
                   C-0.82,-0.35 -0.62,-1.2 0,-1.75 Z"
                fill="var(--ink)" stroke="#ffffff" strokeWidth="0.12"
              />
              <rect x="-0.28" y="-0.15" width="0.56" height="0.55" rx="0.08" fill="var(--brass-light)" />
            </g>

            <text x="24" y="80" className="map-label">WEDDELL SEA</text>
            <text x="68" y="30" className="map-label">ROSS SEA</text>

            {/* compass */}
            <g transform="translate(91,11)">
              <circle r="5.4" fill="#ffffff" stroke="var(--border)" strokeWidth="0.3" />
              <line x1="0" y1="3.6" x2="0" y2="-3.6" stroke="var(--ink)" strokeWidth="0.35" />
              <polygon points="0,-3.9 0.8,-2.3 -0.8,-2.3" fill="var(--brass-light)" />
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
              className={`chip ${activeRoute === "safest" ? "chip-active" : ""}`}
              onClick={() => setActiveRoute("safest")}
            >Safest</button>
            <button
              className={`chip ${activeRoute === "fastest" ? "chip-active" : ""}`}
              onClick={() => setActiveRoute("fastest")}
            >Fastest</button>
            <button className={`chip chip-3d ${show3D ? "chip-active" : ""}`} onClick={() => setShow3D((v) => !v)}>
              <Box size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              3D vessel
            </button>
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
            <div className="card-title"><RouteIcon size={14} /> Route comparison</div>
            <div className="route-compare">
              {Object.entries(ROUTES).map(([key, r]) => (
                <div key={key} className={`route-col ${key === "safest" ? "route-recommended" : ""}`}>
                  <div className="route-col-head">
                    {r.label}
                    {key === "safest" && <span className="pill">Recommended</span>}
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
            <div className="card-title"><Ship size={14} /> Fuel saved, safest vs fastest</div>
            <div className="fuel-number">{fuelSaved}%</div>
            <div className="fuel-bar-track">
              <div className="fuel-bar-fill" style={{ width: `${100 - fuelSaved}%` }} />
            </div>
            <div className="fuel-caption">{ROUTES.safest.fuel} t projected vs {ROUTES.fastest.fuel} t baseline</div>
          </div>

          <div className="card">
            <div className="card-title">Sea-ice forecast</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={FORECAST} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="iceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c98a3b" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#c98a3b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e3e7ea" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#64707d", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#dde2e6" }} tickLine={false} />
                  <YAxis tick={{ fill: "#64707d", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} width={26} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde2e6", fontSize: 12, color: "#0d1b2a", borderRadius: 8 }} />
                  <ReferenceLine x={FORECAST[day - 1].day} stroke="#d64b3f" strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="ice" stroke="#c98a3b" fill="url(#iceFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <input
              type="range" min="1" max="7" value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="slider"
            />
            <div className="slider-caption">Day {day} of 7 — {FORECAST[day - 1].ice}% concentration</div>
          </div>

          <div className="card">
            <div className="card-title">Iceberg watch</div>
            <ul className="berg-list">
              {ICEBERGS.map((b) => (
                <li
                  key={b.id}
                  className={b.id === selectedBergId ? "berg-item-selected" : ""}
                  onClick={() => setSelectedBergId(b.id)}
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
  const segs = points.length - 1;
  const scaled = t * segs;
  const i = Math.min(Math.floor(scaled), segs - 1);
  const localT = scaled - i;
  const [x1, y1] = points[i];
  const [x2, y2] = points[i + 1];
  const x = x1 + (x2 - x1) * localT;
  const y = y1 + (y2 - y1) * localT;
  const angle = (Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI;
  return { x, y, angle };
}