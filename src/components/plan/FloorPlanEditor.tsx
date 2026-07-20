import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveActiveFloor, useStore } from '../../store/useStore';
import type { Opening, PlacedFurniture, Room, Vec2 } from '../../types';
import { FLOOR_COLORS, OPENING_DEFAULTS, ROOF_WINDOW_DEFAULT, formatArea, formatLength } from '../../types';
import {
  checkPlacement,
  clamp,
  dist,
  furnitureCorners,
  openingSegment,
  planBounds,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  rectPoints,
  snapTo,
  translatePoints,
  wallEndpoints,
} from '../../utils/geometry';
import './floorPlan.css';

/** Épaisseur visuelle des murs en mètres. */
const WALL_T = 0.15;
/** Côté minimal d'une pièce (0,60 m : un couloir étroit reste traçable). */
const MIN_SIDE = 0.6;
/** Surface minimale d'une pièce en m². */
const MIN_AREA = 0.8;
/** Distance (m) sous laquelle un clic ferme le polygone en cours. */
const POLY_CLOSE_DIST = 0.35;
/** Distance (m) de détection d'un mur pour la pose de menuiseries. */
const WALL_SNAP_DIST = 0.5;

interface View {
  x: number; // coin haut-gauche du viewport en mètres
  y: number;
  scale: number; // px par mètre
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
  | { mode: 'room'; id: string; startPointer: Vec2; startPoints: Vec2[] }
  | { mode: 'vertex'; roomId: string; index: number }
  | { mode: 'furniture'; id: string; dx: number; dy: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number }
  | { mode: 'opening'; roomId: string; id: string }
  | { mode: 'roofWindow'; roomId: string; id: string; dx: number; dy: number }
  | { mode: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'measure'; x0: number; y0: number; x1: number; y1: number }
  | null;

/** Aire signée (positive = ordre horaire dans un repère y vers le bas). */
function signedArea(points: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Accroche un point à 45° près autour du point précédent (tracé de murs façon jeu). */
function snapAngle(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return to;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + len * Math.cos(snapped), y: from.y + len * Math.sin(snapped) };
}

export default function FloorPlanEditor() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const select = useStore((s) => s.select);
  const setTool = useStore((s) => s.setTool);
  const addRoom = useStore((s) => s.addRoom);
  const updateRoom = useStore((s) => s.updateRoom);
  const insertVertex = useStore((s) => s.insertVertex);
  const removeVertex = useStore((s) => s.removeVertex);
  const updateFurniture = useStore((s) => s.updateFurniture);
  const updateOpening = useStore((s) => s.updateOpening);
  const updateRoofWindow = useStore((s) => s.updateRoofWindow);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const addFloor = useStore((s) => s.addFloor);
  const placement = useStore((s) => s.placement);
  const placementRotation = useStore((s) => s.placementRotation);
  const dropPlacement = useStore((s) => s.dropPlacement);
  const openingPlacement = useStore((s) => s.openingPlacement);
  const openingFlip = useStore((s) => s.openingFlip);
  const setOpeningPlacement = useStore((s) => s.setOpeningPlacement);
  const addOpening = useStore((s) => s.addOpening);
  const addRoofWindow = useStore((s) => s.addRoofWindow);
  const [ghostPos, setGhostPos] = useState<Vec2 | null>(null);
  /** Menuiserie survolant un mur : cible de pose détectée. */
  const [openingGhost, setOpeningGhost] = useState<{ roomId: string; wall: number; offset: number } | null>(null);

  const activeFloor = resolveActiveFloor(project, activeFloorId);
  const floorsSorted = [...project.floors].sort((a, b) => a.level - b.level);
  const floorBelow = floorsSorted.find((f) => f.level === activeFloor.level - 1);
  const floorRooms = project.rooms.filter((r) => r.floorId === activeFloor.id);
  const floorFurniture = project.furniture.filter((f) => f.floorId === activeFloor.id);
  /** Escaliers du niveau inférieur : leur trémie d'arrivée est affichée sur ce niveau. */
  const stairsBelow = floorBelow
    ? project.furniture.filter((f) => f.floorId === floorBelow.id && f.shape.startsWith('stairs_'))
    : [];

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: -1, y: -1, scale: 70 });
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;

  /** Polygone libre en cours de dessin (outil addPoly). */
  const [polyDraft, setPolyDraft] = useState<Vec2[]>([]);
  const [polyCursor, setPolyCursor] = useState<Vec2 | null>(null);
  const polyRef = useRef<Vec2[]>([]);
  polyRef.current = polyDraft;

  // Ajuste la vue au plan au premier rendu.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const b = planBounds(project.rooms);
    const { width, height } = el.getBoundingClientRect();
    const scale = clamp(Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)), 20, 120);
    setView({
      x: b.minX - ((width / scale) - (b.maxX - b.minX)) / 2,
      y: b.minY - ((height / scale) - (b.maxY - b.minY)) / 2,
      scale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abandonne le polygone en cours si l'on change d'outil.
  useEffect(() => {
    if (tool !== 'addPoly') {
      setPolyDraft([]);
      setPolyCursor(null);
    }
  }, [tool]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: view.x + (clientX - rect.left) / view.scale,
        y: view.y + (clientY - rect.top) / view.scale,
      };
    },
    [view]
  );

  // Zoom molette centré sur le curseur.
  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const scale = clamp(v.scale * (e.deltaY < 0 ? 1.12 : 0.89), 12, 300);
      return {
        scale,
        x: v.x + mx / v.scale - mx / scale,
        y: v.y + my / v.scale - my / scale,
      };
    });
  }, []);

  const closePolyDraft = useCallback(() => {
    const pts = polyRef.current;
    if (pts.length >= 3 && polygonArea(pts) >= MIN_AREA / 2) {
      // Normalise l'orientation en sens horaire pour que murs et cotes soient cohérents.
      const oriented = signedArea(pts) < 0 ? [...pts].reverse() : pts;
      addRoom(oriented, { name: `Pièce ${project.rooms.length + 1}` });
      setTool('select');
    }
    setPolyDraft([]);
    setPolyCursor(null);
  }, [addRoom, project.rooms.length, setTool]);

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    if (openingPlacement) {
      if (openingPlacement === 'velux') {
        const room = floorRooms.find((r) => pointInPolygon(w, r.points));
        if (room) {
          addRoofWindow(room.id, { x: snapTo(w.x, snap), y: snapTo(w.y, snap), ...ROOF_WINDOW_DEFAULT });
          setOpeningPlacement(null);
        }
      } else if (openingGhost) {
        addOpening(openingGhost.roomId, {
          type: openingPlacement,
          wall: openingGhost.wall,
          offset: openingGhost.offset,
          ...OPENING_DEFAULTS[openingPlacement],
          flip: openingFlip,
        });
        setOpeningPlacement(null);
        setOpeningGhost(null);
      }
      return;
    }
    if (placement) {
      dropPlacement(snapTo(w.x, snap), snapTo(w.y, snap));
      setGhostPos(null);
      return;
    }
    if (tool === 'addPoly') {
      const raw = { x: snapTo(w.x, snap), y: snapTo(w.y, snap) };
      const last = polyRef.current[polyRef.current.length - 1];
      const p = snap && last ? snapAngle(last, raw) : raw;
      const pts = polyRef.current;
      if (pts.length >= 3 && dist(p, pts[0]) < POLY_CLOSE_DIST) {
        closePolyDraft();
      } else {
        setPolyDraft([...pts, p]);
      }
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (tool === 'addRoom') {
      setDrag({ mode: 'draw', x0: snapTo(w.x, snap), y0: snapTo(w.y, snap), x1: w.x, y1: w.y });
    } else if (tool === 'measure') {
      setDrag({ mode: 'measure', x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    } else {
      select(null);
      setDrag({ mode: 'pan', startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (placement || openingPlacement === 'velux') {
      setGhostPos({ x: snapTo(w.x, snap), y: snapTo(w.y, snap) });
    }
    if (openingPlacement && openingPlacement !== 'velux') {
      // Cherche le mur (non ouvert) le plus proche du curseur sur le niveau actif.
      let best: { roomId: string; wall: number; offset: number; d: number } | null = null;
      for (const room of floorRooms) {
        for (let i = 0; i < room.points.length; i++) {
          if (room.walls[i]?.open) continue;
          const { a, b } = wallEndpoints(room, i);
          const len = dist(a, b);
          if (len < 1e-6) continue;
          const t = clamp(((w.x - a.x) * (b.x - a.x) + (w.y - a.y) * (b.y - a.y)) / (len * len), 0, 1);
          const px2 = a.x + (b.x - a.x) * t;
          const py2 = a.y + (b.y - a.y) * t;
          const d = Math.hypot(w.x - px2, w.y - py2);
          if (d < WALL_SNAP_DIST && (!best || d < best.d)) {
            const width = OPENING_DEFAULTS[openingPlacement].width;
            if (len < width) continue;
            const offset = clamp(snapTo(t * len - width / 2, snap), 0, len - width);
            // Pas de chevauchement avec une menuiserie déjà posée sur ce mur.
            const overlaps = room.openings.some(
              (o2) => o2.wall === i && offset < o2.offset + o2.width && o2.offset < offset + width
            );
            if (overlaps) continue;
            best = { roomId: room.id, wall: i, offset, d };
          }
        }
      }
      setOpeningGhost(best ? { roomId: best.roomId, wall: best.wall, offset: best.offset } : null);
    }
    if (tool === 'addPoly') {
      const raw = { x: snapTo(w.x, snap), y: snapTo(w.y, snap) };
      const last = polyRef.current[polyRef.current.length - 1];
      setPolyCursor(snap && last ? snapAngle(last, raw) : raw);
    }
    const d = dragRef.current;
    if (!d) return;
    switch (d.mode) {
      case 'pan':
        setView((v) => ({
          ...v,
          x: d.viewX - (e.clientX - d.startX) / v.scale,
          y: d.viewY - (e.clientY - d.startY) / v.scale,
        }));
        break;
      case 'draw':
      case 'measure':
        setDrag({ ...d, x1: snapTo(w.x, snap), y1: snapTo(w.y, snap) });
        break;
      case 'room': {
        const dx = snapTo(w.x - d.startPointer.x, snap);
        const dy = snapTo(w.y - d.startPointer.y, snap);
        updateRoom(d.id, { points: translatePoints(d.startPoints, dx, dy) });
        break;
      }
      case 'vertex': {
        const room = project.rooms.find((r) => r.id === d.roomId);
        if (!room) break;
        const p = { x: snapTo(w.x, snap), y: snapTo(w.y, snap) };
        updateRoom(d.roomId, { points: room.points.map((pt, i) => (i === d.index ? p : pt)) });
        break;
      }
      case 'furniture':
        updateFurniture(d.id, { x: snapTo(w.x - d.dx, snap), y: snapTo(w.y - d.dy, snap) });
        break;
      case 'rotate': {
        const angle = (Math.atan2(w.y - d.cy, w.x - d.cx) * 180) / Math.PI + 90;
        const snapped = snap ? Math.round(angle / 15) * 15 : Math.round(angle);
        updateFurniture(d.id, { rotation: ((snapped % 360) + 360) % 360 });
        break;
      }
      case 'roofWindow':
        updateRoofWindow(d.roomId, d.id, { x: snapTo(w.x - d.dx, snap), y: snapTo(w.y - d.dy, snap) });
        break;
      case 'opening': {
        const room = project.rooms.find((r) => r.id === d.roomId);
        const op = room?.openings.find((o) => o.id === d.id);
        if (!room || !op) break;
        const { a, b } = wallEndpoints(room, op.wall);
        const len = dist(a, b);
        if (len < 1e-9) break;
        const t = ((w.x - a.x) * (b.x - a.x) + (w.y - a.y) * (b.y - a.y)) / len;
        const max = Math.max(0, len - op.width);
        updateOpening(d.roomId, d.id, { offset: clamp(snapTo(t - op.width / 2, snap), 0, max) });
        break;
      }
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    if (d?.mode === 'draw') {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const width = Math.abs(d.x1 - d.x0);
      const length = Math.abs(d.y1 - d.y0);
      if (width >= MIN_SIDE && length >= MIN_SIDE && width * length >= MIN_AREA) {
        // Un rectangle étroit et allongé est reconnu comme couloir.
        const isCorridor = Math.min(width, length) <= 1.3 && Math.max(width, length) / Math.min(width, length) >= 2.2;
        addRoom(rectPoints(x, y, width, length), {
          name: isCorridor ? 'Couloir' : `Pièce ${project.rooms.length + 1}`,
          type: isCorridor ? 'couloir' : 'autre',
        });
        setTool('select');
      }
    }
    setDrag(null);
  };

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.key === 'Enter' && tool === 'addPoly') {
        closePolyDraft();
        return;
      }
      if (e.key === 'Escape') {
        if (tool === 'addPoly' && polyRef.current.length > 0) {
          setPolyDraft([]);
          setPolyCursor(null);
        } else {
          select(null);
        }
        return;
      }
      // Suppression, rotation, duplication et annuler/refaire sont gérés
      // globalement dans App.tsx (valables aussi en vue 3D).
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, tool, select, closePolyDraft]);

  const startRoomDrag = (e: React.PointerEvent, room: Room) => {
    if (placement) return; // laisse le clic remonter jusqu'au fond : pose du meuble
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    select({ kind: 'room', id: room.id });
    setDrag({ mode: 'room', id: room.id, startPointer: w, startPoints: room.points });
  };

  const startFurnitureDrag = (e: React.PointerEvent, f: PlacedFurniture) => {
    if (placement) return;
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    select({ kind: 'furniture', id: f.id });
    setDrag({ mode: 'furniture', id: f.id, dx: w.x - f.x, dy: w.y - f.y });
  };

  const s = view.scale;
  const px = (m: number) => m * s;
  const X = (wx: number) => (wx - view.x) * s;
  const Y = (wy: number) => (wy - view.y) * s;

  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Lignes de grille (tous les 1 m, sous-grille 0,5 m si zoom suffisant).
  const gridLines: React.ReactNode[] = [];
  const step = s > 45 ? 0.5 : 1;
  const gx0 = Math.floor(view.x / step) * step;
  const gy0 = Math.floor(view.y / step) * step;
  for (let gx = gx0; gx < view.x + size.w / s; gx += step) {
    const major = Math.abs(gx - Math.round(gx)) < 1e-6;
    gridLines.push(
      <line key={`vx${gx.toFixed(2)}`} x1={X(gx)} y1={0} x2={X(gx)} y2={size.h} className={major ? 'grid-major' : 'grid-minor'} />
    );
  }
  for (let gy = gy0; gy < view.y + size.h / s; gy += step) {
    const major = Math.abs(gy - Math.round(gy)) < 1e-6;
    gridLines.push(
      <line key={`hz${gy.toFixed(2)}`} x1={0} y1={Y(gy)} x2={size.w} y2={Y(gy)} className={major ? 'grid-major' : 'grid-minor'} />
    );
  }

  const renderOpening = (room: Room, o: Opening) => {
    const seg = openingSegment(room, o);
    const isSel = selection?.kind === 'opening' && selection.id === o.id;
    const t = px(WALL_T);
    const cx = X((seg.x1 + seg.x2) / 2);
    const cy = Y((seg.y1 + seg.y2) / 2);
    const len = px(o.width);
    return (
      <g
        key={o.id}
        transform={`rotate(${seg.angle} ${cx} ${cy})`}
        className={`opening ${isSel ? 'selected' : ''}`}
        onPointerDown={(e) => {
          // Pendant une pose, le clic doit atteindre le fond (drop), pas l'ouverture existante.
          if (openingPlacement || placement) return;
          if (tool !== 'select' || e.button !== 0) return;
          e.stopPropagation();
          svgRef.current!.setPointerCapture(e.pointerId);
          select({ kind: 'opening', roomId: room.id, id: o.id });
          setDrag({ mode: 'opening', roomId: room.id, id: o.id });
        }}
      >
        {/* Coupe le mur */}
        <rect x={cx - len / 2} y={cy - t / 2 - 1} width={len} height={t + 2} className="opening-gap" />
        {o.type === 'fenetre' || o.type === 'double_fenetre' ? (
          <>
            <line x1={cx - len / 2} y1={cy - t / 6} x2={cx + len / 2} y2={cy - t / 6} className="window-line" />
            <line x1={cx - len / 2} y1={cy + t / 6} x2={cx + len / 2} y2={cy + t / 6} className="window-line" />
            {o.type === 'double_fenetre' && (
              <line x1={cx} y1={cy - t / 2} x2={cx} y2={cy + t / 2} className="window-mullion" />
            )}
          </>
        ) : (
          <>
            {/* Battant et arc de débattement, en miroir si le sens est inversé (R). */}
            <g transform={o.flip ? `translate(${2 * cx} 0) scale(-1 1)` : undefined}>
              <line
                x1={cx - len / 2}
                y1={cy}
                x2={cx - len / 2}
                y2={cy - len}
                className={o.type === 'porte_entree' ? 'door-leaf entry' : 'door-leaf'}
              />
              <path d={`M ${cx - len / 2} ${cy - len} A ${len} ${len} 0 0 1 ${cx + len / 2} ${cy}`} className="door-arc" />
            </g>
            {o.type === 'porte_entree' && (
              <rect x={cx - len / 2} y={cy - t / 2} width={len} height={t} className="entry-sill" />
            )}
            {o.type === 'porte_fenetre' && (
              <line x1={cx - len / 2} y1={cy + t / 6} x2={cx + len / 2} y2={cy + t / 6} className="window-line" />
            )}
          </>
        )}
        <rect x={cx - len / 2} y={cy - t} width={len} height={t * 2} fill="transparent" style={{ cursor: 'move' }} />
      </g>
    );
  };

  /** Cotes de chaque mur, décalées vers l'extérieur (polygone horaire ⇒ normale = (uy, -ux)). */
  const renderDims = (room: Room) => {
    const off = 0.4;
    return (
      <g className="dims" pointerEvents="none">
        {room.points.map((a, i) => {
          const b = room.points[(i + 1) % room.points.length];
          const len = dist(a, b);
          if (len < 0.15) return null;
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          const nx = uy;
          const ny = -ux;
          const mx = (a.x + b.x) / 2 + nx * off;
          const my = (a.y + b.y) / 2 + ny * off;
          let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
          if (angle > 90 || angle <= -90) angle += 180;
          return (
            <text
              key={i}
              x={X(mx)}
              y={Y(my)}
              className="dim-text"
              textAnchor="middle"
              transform={`rotate(${angle} ${X(mx)} ${Y(my)})`}
            >
              {formatLength(len)}
            </text>
          );
        })}
      </g>
    );
  };

  /** Poignées de sommets + boutons d'insertion au milieu de chaque mur. */
  const renderRoomHandles = (room: Room) => (
    <g className="room-handles">
      {room.points.map((p, i) => {
        const b = room.points[(i + 1) % room.points.length];
        const mid = { x: (p.x + b.x) / 2, y: (p.y + b.y) / 2 };
        return (
          <g key={i}>
            <circle
              cx={X(mid.x)}
              cy={Y(mid.y)}
              r={6}
              className="mid-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                insertVertex(room.id, i);
              }}
            >
              <title>Ajouter un sommet (scinde le mur)</title>
            </circle>
            <circle
              cx={X(p.x)}
              cy={Y(p.y)}
              r={6.5}
              className="vertex-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                svgRef.current!.setPointerCapture(e.pointerId);
                setDrag({ mode: 'vertex', roomId: room.id, index: i });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (room.points.length > 3) removeVertex(room.id, i);
              }}
            >
              <title>Glisser pour déplacer · double-clic pour supprimer le sommet</title>
            </circle>
          </g>
        );
      })}
    </g>
  );

  /** Fenêtre de toit : rectangle pointillé avec croix, posé sur le plafond de la pièce. */
  const renderRoofWindow = (room: Room, rw: Room['roofWindows'][number]) => {
    const isSel = selection?.kind === 'roofWindow' && selection.id === rw.id;
    const x0 = X(rw.x - rw.width / 2);
    const y0 = Y(rw.y - rw.length / 2);
    const w = px(rw.width);
    const h = px(rw.length);
    return (
      <g
        key={rw.id}
        className={`roof-window ${isSel ? 'selected' : ''}`}
        onPointerDown={(e) => {
          if (tool !== 'select' || e.button !== 0) return;
          e.stopPropagation();
          svgRef.current!.setPointerCapture(e.pointerId);
          const wpt = toWorld(e.clientX, e.clientY);
          select({ kind: 'roofWindow', roomId: room.id, id: rw.id });
          setDrag({ mode: 'roofWindow', roomId: room.id, id: rw.id, dx: wpt.x - rw.x, dy: wpt.y - rw.y });
        }}
        style={{ cursor: 'move' }}
      >
        <rect x={x0} y={y0} width={w} height={h} className="roof-window-rect" />
        <line x1={x0} y1={y0} x2={x0 + w} y2={y0 + h} className="roof-window-cross" />
        <line x1={x0 + w} y1={y0} x2={x0} y2={y0 + h} className="roof-window-cross" />
        {s > 40 && (
          <text x={x0 + w / 2} y={y0 - 4} className="roof-window-label" textAnchor="middle">
            Velux
          </text>
        )}
      </g>
    );
  };

  /** Rendu stylisé des escaliers (marches + sens de montée). */
  const renderStairs = (f: PlacedFurniture, cx: number, cy: number, w: number, d: number) => {
    const x0 = cx - w / 2;
    const y0 = cy - d / 2;
    const stepPx = Math.max(8, px(0.25));
    const nodes: React.ReactNode[] = [
      <rect key="outline" x={x0} y={y0} width={w} height={d} fill={f.color} className="furn-shape" />,
    ];
    const arrow = (points: string, tipX: number, tipY: number, tipAngle: number) => (
      <g key="arrow" className="stair-arrow" pointerEvents="none">
        <polyline points={points} />
        <line x1={tipX} y1={tipY} x2={tipX + 6 * Math.cos(((tipAngle + 150) * Math.PI) / 180)} y2={tipY + 6 * Math.sin(((tipAngle + 150) * Math.PI) / 180)} />
        <line x1={tipX} y1={tipY} x2={tipX + 6 * Math.cos(((tipAngle - 150) * Math.PI) / 180)} y2={tipY + 6 * Math.sin(((tipAngle - 150) * Math.PI) / 180)} />
      </g>
    );
    if (f.shape === 'stairs_droit') {
      for (let y = y0 + stepPx; y < y0 + d - 2; y += stepPx) {
        nodes.push(<line key={`s${y}`} x1={x0} y1={y} x2={x0 + w} y2={y} className="stair-line" />);
      }
      nodes.push(arrow(`${cx},${y0 + d - 6} ${cx},${y0 + 6}`, cx, y0 + 6, -90));
    } else if (f.shape === 'stairs_quart') {
      const px1 = x0 + w * 0.55; // pivot du quart tournant
      const py1 = y0 + d * 0.6;
      for (let x = x0 + stepPx; x < px1 - 2; x += stepPx) {
        nodes.push(<line key={`a${x}`} x1={x} y1={py1} x2={x} y2={y0 + d} className="stair-line" />);
      }
      for (let y = y0 + stepPx; y < py1 - 2; y += stepPx) {
        nodes.push(<line key={`b${y}`} x1={px1} y1={y} x2={x0 + w} y2={y} className="stair-line" />);
      }
      nodes.push(<line key="f1" x1={px1} y1={py1} x2={x0 + w} y2={y0 + d * 0.85} className="stair-line" />);
      nodes.push(<line key="f2" x1={px1} y1={py1} x2={x0 + w * 0.85} y2={y0 + d} className="stair-line" />);
      nodes.push(<line key="f3" x1={px1} y1={py1} x2={x0 + w} y2={y0 + d} className="stair-line" />);
      const midX = (px1 + x0 + w) / 2;
      nodes.push(arrow(`${x0 + 8},${y0 + d * 0.8} ${midX},${y0 + d * 0.8} ${midX},${y0 + 8}`, midX, y0 + 8, -90));
    } else if (f.shape === 'stairs_demi') {
      const bandW = w * 0.44;
      const landingH = d * 0.28;
      for (let y = y0 + landingH + stepPx; y < y0 + d - 2; y += stepPx) {
        nodes.push(<line key={`l${y}`} x1={x0} y1={y} x2={x0 + bandW} y2={y} className="stair-line" />);
        nodes.push(<line key={`r${y}`} x1={x0 + w - bandW} y1={y} x2={x0 + w} y2={y} className="stair-line" />);
      }
      nodes.push(<line key="sep" x1={cx} y1={y0 + landingH} x2={cx} y2={y0 + d} className="stair-line" />);
      nodes.push(<line key="d1" x1={x0} y1={y0 + landingH} x2={x0 + w} y2={y0 + landingH} className="stair-line" />);
      nodes.push(<line key="d2" x1={x0} y1={y0 + landingH} x2={cx} y2={y0} className="stair-line" />);
      nodes.push(<line key="d3" x1={cx} y1={y0} x2={x0 + w} y2={y0 + landingH} className="stair-line" />);
      const lx = x0 + bandW / 2;
      const rx = x0 + w - bandW / 2;
      nodes.push(
        arrow(`${lx},${y0 + d - 6} ${lx},${y0 + landingH / 1.5} ${rx},${y0 + landingH / 1.5} ${rx},${y0 + d - 6}`, rx, y0 + d - 6, 90)
      );
    } else {
      // Colimaçon : cage ronde, fût central et marches rayonnantes.
      nodes.length = 0;
      nodes.push(<ellipse key="outline" cx={cx} cy={cy} rx={w / 2} ry={d / 2} fill={f.color} className="furn-shape" />);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        nodes.push(
          <line key={`r${i}`} x1={cx} y1={cy} x2={cx + (w / 2) * Math.cos(a)} y2={cy + (d / 2) * Math.sin(a)} className="stair-line" />
        );
      }
      nodes.push(<circle key="pole" cx={cx} cy={cy} r={Math.max(3, px(0.08))} className="stair-pole" />);
    }
    return nodes;
  };

  const renderFurniture = (f: PlacedFurniture) => {
    const isSel = selection?.kind === 'furniture' && selection.id === f.id;
    const w = px(f.width);
    const d = px(f.depth);
    const cx = X(f.x);
    const cy = Y(f.y);
    return (
      <g key={f.id} transform={`rotate(${f.rotation} ${cx} ${cy})`} className={`furniture ${isSel ? 'selected' : ''} ${f.existing ? 'existing' : ''}`}>
        <g onPointerDown={(e) => startFurnitureDrag(e, f)} style={{ cursor: 'move' }}>
          {f.shape.startsWith('stairs_') ? (
            <g>{renderStairs(f, cx, cy, w, d)}</g>
          ) : f.shape === 'round' ? (
            <ellipse cx={cx} cy={cy} rx={w / 2} ry={d / 2} fill={f.color} className="furn-shape" />
          ) : f.shape === 'lshape' ? (
            <path
              d={`M ${cx - w / 2} ${cy - d / 2} h ${w} v ${d * 0.55} h ${-w * 0.45} v ${d * 0.45} h ${-w * 0.55} z`}
              fill={f.color}
              className="furn-shape"
            />
          ) : (
            <rect x={cx - w / 2} y={cy - d / 2} width={w} height={d} rx={3} fill={f.color} className="furn-shape" />
          )}
          {f.photoUrl && s > 30 && (
            <image
              href={f.photoUrl}
              x={cx - w / 2 + 2}
              y={cy - d / 2 + 2}
              width={w - 4}
              height={d - 4}
              preserveAspectRatio="xMidYMid slice"
              opacity={0.85}
              pointerEvents="none"
            />
          )}
          {s > 35 && (
            <text x={cx} y={cy} className="furn-label" textAnchor="middle" dominantBaseline="middle" transform={f.rotation > 90 && f.rotation < 270 ? `rotate(180 ${cx} ${cy})` : undefined}>
              {f.name}
            </text>
          )}
        </g>
        {isSel && (
          <>
            <line x1={cx} y1={cy - d / 2} x2={cx} y2={cy - d / 2 - 24} className="rotate-line" />
            <circle
              cx={cx}
              cy={cy - d / 2 - 24}
              r={7}
              className="rotate-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                svgRef.current!.setPointerCapture(e.pointerId);
                setDrag({ mode: 'rotate', id: f.id, cx: f.x, cy: f.y });
              }}
            />
            <text x={cx} y={cy + d / 2 + 16} className="furn-dims" textAnchor="middle">
              {formatLength(f.width)} × {formatLength(f.depth)}
            </text>
          </>
        )}
      </g>
    );
  };

  const renderRoom = (room: Room) => {
    const isSel = selection?.kind === 'room' && selection.id === room.id;
    const centroid = polygonCentroid(room.points);
    const pathPoints = room.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
    return (
      <g key={room.id} className={`room ${isSel ? 'selected' : ''}`}>
        <polygon
          points={pathPoints}
          fill={FLOOR_COLORS[room.floor]}
          className="room-floor"
          onPointerDown={(e) => startRoomDrag(e, room)}
        />
        {/* Murs : trait épais si fermé, pointillé fin si ouvert. Chaque section est
            sélectionnable (Suppr = supprimer la section, panneau = peinture). */}
        {room.points.map((a, i) => {
          const b = room.points[(i + 1) % room.points.length];
          const open = room.walls[i]?.open;
          const isSelWall = selection?.kind === 'wall' && selection.roomId === room.id && selection.index === i;
          return (
            <line
              key={i}
              x1={X(a.x)}
              y1={Y(a.y)}
              x2={X(b.x)}
              y2={Y(b.y)}
              className={`${open ? 'room-wall-open' : 'room-wall'} ${isSelWall ? 'wall-selected' : ''}`}
              strokeWidth={Math.max(open ? 4 : px(WALL_T), 6)}
              style={{ cursor: openingPlacement ? 'copy' : 'pointer' }}
              onPointerDown={(e) => {
                if (openingPlacement || placement || tool !== 'select' || e.button !== 0) return;
                e.stopPropagation();
                select({ kind: 'wall', roomId: room.id, index: i });
              }}
            />
          );
        })}
        {room.openings.map((o) => renderOpening(room, o))}
        {room.roofWindows.map((rw) => renderRoofWindow(room, rw))}
        {s > 25 && (
          <g pointerEvents="none">
            <text x={X(centroid.x)} y={Y(centroid.y) - 8} className="room-name" textAnchor="middle">
              {room.name}
            </text>
            <text x={X(centroid.x)} y={Y(centroid.y) + 10} className="room-area" textAnchor="middle">
              {formatArea(polygonArea(room.points))}
            </text>
          </g>
        )}
        {isSel && renderDims(room)}
        {isSel && renderRoomHandles(room)}
      </g>
    );
  };

  return (
    <div className="plan-editor">
      <svg
        ref={svgRef}
        className={`plan-svg tool-${tool} ${placement ? 'placing' : ''}`}
        onWheel={onWheel}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setDrag(null)}
      >
        <g className="grid">{gridLines}</g>

        {/* Contours fantômes du niveau inférieur (repère d'alignement) */}
        {floorBelow &&
          project.rooms
            .filter((r) => r.floorId === floorBelow.id)
            .map((r) => (
              <polygon
                key={`ghost-${r.id}`}
                points={r.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
                className="ghost-room"
                pointerEvents="none"
              />
            ))}
        {/* Trémies d'arrivée des escaliers du niveau inférieur */}
        {stairsBelow.map((st) => {
          const cx = X(st.x);
          const cy = Y(st.y);
          return (
            <g key={`tremie-${st.id}`} transform={`rotate(${st.rotation} ${cx} ${cy})`} pointerEvents="none">
              <rect
                x={cx - px(st.width) / 2}
                y={cy - px(st.depth) / 2}
                width={px(st.width)}
                height={px(st.depth)}
                className="stair-hopper"
              />
              {s > 30 && (
                <text x={cx} y={cy} className="stair-hopper-label" textAnchor="middle" dominantBaseline="middle">
                  Trémie escalier ({floorBelow?.name})
                </text>
              )}
            </g>
          );
        })}

        {floorRooms.map(renderRoom)}
        {floorFurniture.map(renderFurniture)}

        {drag?.mode === 'draw' && (
          <g className="draw-preview">
            <rect
              x={X(Math.min(drag.x0, drag.x1))}
              y={Y(Math.min(drag.y0, drag.y1))}
              width={px(Math.abs(drag.x1 - drag.x0))}
              height={px(Math.abs(drag.y1 - drag.y0))}
            />
            <text x={X((drag.x0 + drag.x1) / 2)} y={Y((drag.y0 + drag.y1) / 2)} textAnchor="middle" className="dim-text">
              {formatLength(Math.abs(drag.x1 - drag.x0))} × {formatLength(Math.abs(drag.y1 - drag.y0))}
            </text>
          </g>
        )}

        {tool === 'addPoly' && polyDraft.length > 0 && (
          <g className="draw-preview">
            <polyline
              points={[...polyDraft, ...(polyCursor ? [polyCursor] : [])].map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
              className="poly-preview"
            />
            {polyDraft.map((p, i) => (
              <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={i === 0 ? 7 : 4} className={i === 0 ? 'poly-start' : 'poly-point'} />
            ))}
            {polyCursor && polyDraft.length >= 1 && (
              <text x={X(polyCursor.x)} y={Y(polyCursor.y) - 12} textAnchor="middle" className="dim-text">
                {formatLength(dist(polyDraft[polyDraft.length - 1], polyCursor))}
              </text>
            )}
          </g>
        )}

        {/* Fantôme du meuble accroché au curseur, teinté selon la validité de l'emplacement */}
        {placement && ghostPos && (() => {
          const cand = {
            x: ghostPos.x,
            y: ghostPos.y,
            width: placement.width,
            depth: placement.depth,
            rotation: placementRotation,
            height: placement.height,
          };
          const check = checkPlacement(project.rooms, project.furniture, activeFloor.id, cand);
          const corners = furnitureCorners(cand);
          const cx = X(ghostPos.x);
          const cy = Y(ghostPos.y);
          return (
            <g className={`ghost-furniture ${check.valid ? 'valid' : 'invalid'}`} pointerEvents="none">
              <polygon points={corners.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className="ghost-footprint" />
              <g transform={`rotate(${placementRotation} ${cx} ${cy})`}>
                {placement.shape === 'round' ? (
                  <ellipse cx={cx} cy={cy} rx={px(placement.width) / 2} ry={px(placement.depth) / 2} className="ghost-shape" />
                ) : (
                  <rect
                    x={cx - px(placement.width) / 2}
                    y={cy - px(placement.depth) / 2}
                    width={px(placement.width)}
                    height={px(placement.depth)}
                    rx={3}
                    className="ghost-shape"
                  />
                )}
              </g>
              <text x={cx} y={cy} className="furn-label" textAnchor="middle" dominantBaseline="middle">
                {placement.name}
              </text>
              {!check.inRoom && (
                <text x={cx} y={cy + px(placement.depth) / 2 + 16} className="ghost-warn" textAnchor="middle">
                  Hors pièce
                </text>
              )}
              {check.collides && (
                <text x={cx} y={cy + px(placement.depth) / 2 + 16} className="ghost-warn" textAnchor="middle">
                  Chevauche un meuble
                </text>
              )}
            </g>
          );
        })()}

        {/* Fantôme de menuiserie sur le mur détecté, avec cotes de pose */}
        {openingPlacement && openingPlacement !== 'velux' && openingGhost && (() => {
          const room = floorRooms.find((r) => r.id === openingGhost.roomId);
          if (!room) return null;
          const { a, b } = wallEndpoints(room, openingGhost.wall);
          const len = dist(a, b);
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          const width = OPENING_DEFAULTS[openingPlacement].width;
          const sx = a.x + ux * openingGhost.offset;
          const sy = a.y + uy * openingGhost.offset;
          const ex = sx + ux * width;
          const ey = sy + uy * width;
          const cx = X((sx + ex) / 2);
          const cy = Y((sy + ey) / 2);
          const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
          const labelAngle = angle > 90 || angle <= -90 ? angle + 180 : angle;
          return (
            <g className="opening-ghost" pointerEvents="none">
              <g transform={`rotate(${angle} ${cx} ${cy})`}>
                <rect x={cx - px(width) / 2} y={cy - px(WALL_T)} width={px(width)} height={px(WALL_T) * 2} className="opening-ghost-rect" />
              </g>
              <text x={cx} y={cy - px(WALL_T) - 6} className="measure-text" textAnchor="middle" transform={`rotate(${labelAngle} ${cx} ${cy - px(WALL_T) - 6})`}>
                {formatLength(width)} · à {formatLength(openingGhost.offset)} du coin
              </text>
            </g>
          );
        })()}
        {/* Fantôme de Velux au curseur */}
        {openingPlacement === 'velux' && ghostPos && (
          <g className="roof-window" pointerEvents="none" opacity={0.8}>
            <rect
              x={X(ghostPos.x - ROOF_WINDOW_DEFAULT.width / 2)}
              y={Y(ghostPos.y - ROOF_WINDOW_DEFAULT.length / 2)}
              width={px(ROOF_WINDOW_DEFAULT.width)}
              height={px(ROOF_WINDOW_DEFAULT.length)}
              className="roof-window-rect"
            />
          </g>
        )}

        {drag?.mode === 'measure' && (
          <g className="measure">
            <line x1={X(drag.x0)} y1={Y(drag.y0)} x2={X(drag.x1)} y2={Y(drag.y1)} className="measure-line" />
            <text x={X((drag.x0 + drag.x1) / 2)} y={Y((drag.y0 + drag.y1) / 2) - 8} textAnchor="middle" className="measure-text">
              {formatLength(Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0))}
            </text>
          </g>
        )}
      </svg>
      <div className="floor-switcher">
        {floorsSorted.map((f) => (
          <button
            key={f.id}
            className={f.id === activeFloor.id ? 'active' : ''}
            onClick={() => setActiveFloor(f.id)}
            title={`Niveau ${f.level}`}
          >
            {f.name}
          </button>
        ))}
        <button className="add-floor" onClick={addFloor} title="Ajouter un étage">
          +
        </button>
      </div>
      <div className="plan-hints">
        {openingPlacement
          ? openingPlacement === 'velux'
            ? 'Cliquez dans une pièce pour poser la fenêtre de toit · Échap pour annuler'
            : 'Glissez le long d’un mur : la menuiserie s’y accroche avec ses cotes · clic pour poser · R inverser le sens · Échap annuler'
          : tool === 'addRoom'
            ? 'Cliquez-glissez pour dessiner une pièce — un rectangle étroit devient automatiquement un couloir'
            : tool === 'addPoly'
              ? 'Tracez les murs point par point (cotes en direct, accrochage 45°) · premier point ou Entrée pour fermer · Échap pour annuler'
              : tool === 'measure'
                ? 'Cliquez-glissez pour mesurer une distance'
                : 'Molette : zoom · Glisser le fond : déplacer · Clic sur un mur : sélectionner la section (Suppr = supprimer) · Pièce : glissez les sommets, ◈ scinde un mur'}
      </div>
    </div>
  );
}
