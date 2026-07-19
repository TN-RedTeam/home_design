import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { Opening, PlacedFurniture, Room } from '../../types';
import { FLOOR_COLORS, formatArea, formatLength } from '../../types';
import { clamp, openingSegment, planBounds, snapTo, wallLength } from '../../utils/geometry';
import './floorPlan.css';

/** Épaisseur visuelle des murs en mètres. */
const WALL_T = 0.15;
const MIN_ROOM = 1;

interface View {
  x: number; // coin haut-gauche du viewport en mètres
  y: number;
  scale: number; // px par mètre
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
  | { mode: 'room'; id: string; dx: number; dy: number }
  | { mode: 'furniture'; id: string; dx: number; dy: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number }
  | { mode: 'resize-room'; id: string; handle: string; orig: Room }
  | { mode: 'opening'; roomId: string; id: string }
  | { mode: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'measure'; x0: number; y0: number; x1: number; y1: number }
  | null;

export default function FloorPlanEditor() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const select = useStore((s) => s.select);
  const setTool = useStore((s) => s.setTool);
  const addRoom = useStore((s) => s.addRoom);
  const updateRoom = useStore((s) => s.updateRoom);
  const removeRoom = useStore((s) => s.removeRoom);
  const updateFurniture = useStore((s) => s.updateFurniture);
  const removeFurniture = useStore((s) => s.removeFurniture);
  const duplicateFurniture = useStore((s) => s.duplicateFurniture);
  const updateOpening = useStore((s) => s.updateOpening);
  const removeOpening = useStore((s) => s.removeOpening);

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: -1, y: -1, scale: 70 });
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;

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
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
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
    },
    []
  );

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
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
    const d = dragRef.current;
    if (!d) return;
    const w = toWorld(e.clientX, e.clientY);
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
      case 'room':
        updateRoom(d.id, { x: snapTo(w.x - d.dx, snap), y: snapTo(w.y - d.dy, snap) });
        break;
      case 'furniture':
        updateFurniture(d.id, { x: snapTo(w.x - d.dx, snap), y: snapTo(w.y - d.dy, snap) });
        break;
      case 'rotate': {
        const angle = (Math.atan2(w.y - d.cy, w.x - d.cx) * 180) / Math.PI + 90;
        const snapped = snap ? Math.round(angle / 15) * 15 : Math.round(angle);
        updateFurniture(d.id, { rotation: ((snapped % 360) + 360) % 360 });
        break;
      }
      case 'resize-room': {
        const o = d.orig;
        const patch: Partial<Room> = {};
        const sx = snapTo(w.x, snap);
        const sy = snapTo(w.y, snap);
        if (d.handle.includes('w')) {
          const right = o.x + o.width;
          patch.x = Math.min(sx, right - MIN_ROOM);
          patch.width = right - patch.x;
        }
        if (d.handle.includes('e')) patch.width = Math.max(MIN_ROOM, sx - o.x);
        if (d.handle.includes('n')) {
          const bottom = o.y + o.length;
          patch.y = Math.min(sy, bottom - MIN_ROOM);
          patch.length = bottom - patch.y;
        }
        if (d.handle.includes('s')) patch.length = Math.max(MIN_ROOM, sy - o.y);
        updateRoom(d.id, patch);
        break;
      }
      case 'opening': {
        const room = project.rooms.find((r) => r.id === d.roomId);
        const op = room?.openings.find((o) => o.id === d.id);
        if (!room || !op) break;
        const along = op.wall === 'N' || op.wall === 'S' ? w.x - room.x : w.y - room.y;
        const max = Math.max(0, wallLength(room, op.wall) - op.width);
        updateOpening(d.roomId, d.id, { offset: clamp(snapTo(along - op.width / 2, snap), 0, max) });
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
      if (width >= MIN_ROOM && length >= MIN_ROOM) {
        addRoom({ x, y, width, length, name: `Pièce ${project.rooms.length + 1}` });
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
      if (e.key === 'Escape') select(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        if (selection.kind === 'room') removeRoom(selection.id);
        if (selection.kind === 'furniture') removeFurniture(selection.id);
        if (selection.kind === 'opening') removeOpening(selection.roomId, selection.id);
      }
      if (selection?.kind === 'furniture') {
        const f = project.furniture.find((x) => x.id === selection.id);
        if (!f) return;
        if (e.key === 'r' || e.key === 'R') updateFurniture(f.id, { rotation: (f.rotation + 15) % 360 });
        if (e.key === 'd' || e.key === 'D') duplicateFurniture(f.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, project, select, removeRoom, removeFurniture, removeOpening, updateFurniture, duplicateFurniture]);

  const startRoomDrag = (e: React.PointerEvent, room: Room) => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    select({ kind: 'room', id: room.id });
    setDrag({ mode: 'room', id: room.id, dx: w.x - room.x, dy: w.y - room.y });
  };

  const startFurnitureDrag = (e: React.PointerEvent, f: PlacedFurniture) => {
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
    const horizontal = o.wall === 'N' || o.wall === 'S';
    const t = px(WALL_T);
    const cx = X((seg.x1 + seg.x2) / 2);
    const cy = Y((seg.y1 + seg.y2) / 2);
    const len = px(o.width);
    return (
      <g
        key={o.id}
        transform={`rotate(${horizontal ? 0 : 90} ${cx} ${cy})`}
        className={`opening ${isSel ? 'selected' : ''}`}
        onPointerDown={(e) => {
          if (tool !== 'select' || e.button !== 0) return;
          e.stopPropagation();
          svgRef.current!.setPointerCapture(e.pointerId);
          select({ kind: 'opening', roomId: room.id, id: o.id });
          setDrag({ mode: 'opening', roomId: room.id, id: o.id });
        }}
      >
        {/* Coupe le mur */}
        <rect x={cx - len / 2} y={cy - t / 2 - 1} width={len} height={t + 2} className="opening-gap" />
        {o.type === 'fenetre' ? (
          <>
            <line x1={cx - len / 2} y1={cy - t / 6} x2={cx + len / 2} y2={cy - t / 6} className="window-line" />
            <line x1={cx - len / 2} y1={cy + t / 6} x2={cx + len / 2} y2={cy + t / 6} className="window-line" />
          </>
        ) : (
          <>
            <line x1={cx - len / 2} y1={cy} x2={cx - len / 2} y2={cy - len} className="door-leaf" />
            <path d={`M ${cx - len / 2} ${cy - len} A ${len} ${len} 0 0 1 ${cx + len / 2} ${cy}`} className="door-arc" />
            {o.type === 'porte_fenetre' && (
              <line x1={cx - len / 2} y1={cy + t / 6} x2={cx + len / 2} y2={cy + t / 6} className="window-line" />
            )}
          </>
        )}
        <rect x={cx - len / 2} y={cy - t} width={len} height={t * 2} fill="transparent" style={{ cursor: 'ew-resize' }} />
      </g>
    );
  };

  const renderDims = (room: Room) => {
    const off = 0.45; // décalage des cotes en m
    return (
      <g className="dims">
        <line x1={X(room.x)} y1={Y(room.y - off)} x2={X(room.x + room.width)} y2={Y(room.y - off)} className="dim-line" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
        <text x={X(room.x + room.width / 2)} y={Y(room.y - off) - 5} className="dim-text" textAnchor="middle">
          {formatLength(room.width)}
        </text>
        <line x1={X(room.x - off)} y1={Y(room.y)} x2={X(room.x - off)} y2={Y(room.y + room.length)} className="dim-line" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
        <text
          x={X(room.x - off) - 5}
          y={Y(room.y + room.length / 2)}
          className="dim-text"
          textAnchor="middle"
          transform={`rotate(-90 ${X(room.x - off) - 5} ${Y(room.y + room.length / 2)})`}
        >
          {formatLength(room.length)}
        </text>
      </g>
    );
  };

  const renderRoomHandles = (room: Room) => {
    const handles: { h: string; x: number; y: number; cursor: string }[] = [
      { h: 'nw', x: room.x, y: room.y, cursor: 'nwse-resize' },
      { h: 'ne', x: room.x + room.width, y: room.y, cursor: 'nesw-resize' },
      { h: 'sw', x: room.x, y: room.y + room.length, cursor: 'nesw-resize' },
      { h: 'se', x: room.x + room.width, y: room.y + room.length, cursor: 'nwse-resize' },
      { h: 'n', x: room.x + room.width / 2, y: room.y, cursor: 'ns-resize' },
      { h: 's', x: room.x + room.width / 2, y: room.y + room.length, cursor: 'ns-resize' },
      { h: 'w', x: room.x, y: room.y + room.length / 2, cursor: 'ew-resize' },
      { h: 'e', x: room.x + room.width, y: room.y + room.length / 2, cursor: 'ew-resize' },
    ];
    return handles.map((h) => (
      <rect
        key={h.h}
        x={X(h.x) - 5}
        y={Y(h.y) - 5}
        width={10}
        height={10}
        className="handle"
        style={{ cursor: h.cursor }}
        onPointerDown={(e) => {
          e.stopPropagation();
          svgRef.current!.setPointerCapture(e.pointerId);
          setDrag({ mode: 'resize-room', id: room.id, handle: h.h, orig: { ...room } });
        }}
      />
    ));
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
          {f.shape === 'round' ? (
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

  return (
    <div className="plan-editor">
      <svg
        ref={svgRef}
        className={`plan-svg tool-${tool}`}
        onWheel={onWheel}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setDrag(null)}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b93a5" />
          </marker>
        </defs>
        <g className="grid">{gridLines}</g>

        {project.rooms.map((room) => {
          const isSel = selection?.kind === 'room' && selection.id === room.id;
          return (
            <g key={room.id} className={`room ${isSel ? 'selected' : ''}`}>
              <rect
                x={X(room.x)}
                y={Y(room.y)}
                width={px(room.width)}
                height={px(room.length)}
                fill={FLOOR_COLORS[room.floor]}
                className="room-floor"
                onPointerDown={(e) => startRoomDrag(e, room)}
              />
              <rect
                x={X(room.x) - px(WALL_T) / 2}
                y={Y(room.y) - px(WALL_T) / 2}
                width={px(room.width) + px(WALL_T)}
                height={px(room.length) + px(WALL_T)}
                className="room-walls"
                strokeWidth={px(WALL_T)}
                pointerEvents="none"
              />
              {room.openings.map((o) => renderOpening(room, o))}
              {s > 25 && (
                <g pointerEvents="none">
                  <text x={X(room.x + room.width / 2)} y={Y(room.y + room.length / 2) - 8} className="room-name" textAnchor="middle">
                    {room.name}
                  </text>
                  <text x={X(room.x + room.width / 2)} y={Y(room.y + room.length / 2) + 10} className="room-area" textAnchor="middle">
                    {formatArea(room.width * room.length)}
                  </text>
                </g>
              )}
              {isSel && renderDims(room)}
              {isSel && renderRoomHandles(room)}
            </g>
          );
        })}

        {project.furniture.map(renderFurniture)}

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

        {drag?.mode === 'measure' && (
          <g className="measure">
            <line x1={X(drag.x0)} y1={Y(drag.y0)} x2={X(drag.x1)} y2={Y(drag.y1)} className="measure-line" />
            <text x={X((drag.x0 + drag.x1) / 2)} y={Y((drag.y0 + drag.y1) / 2) - 8} textAnchor="middle" className="measure-text">
              {formatLength(Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0))}
            </text>
          </g>
        )}
      </svg>
      <div className="plan-hints">
        {tool === 'addRoom'
          ? 'Cliquez-glissez pour dessiner une pièce'
          : tool === 'measure'
            ? 'Cliquez-glissez pour mesurer une distance'
            : 'Molette : zoom · Glisser le fond : déplacer · R : pivoter · D : dupliquer · Suppr : supprimer'}
      </div>
    </div>
  );
}
