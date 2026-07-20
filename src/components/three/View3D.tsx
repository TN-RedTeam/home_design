import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WallsMode } from '../../store/useStore';
import { resolveActiveFloor, useStore } from '../../store/useStore';
import type { PlacedFurniture, Room } from '../../types';
import { FLOOR_COLORS, SLAB_T } from '../../types';
import { checkPlacement, planBounds, snapTo, wallEndpoints } from '../../utils/geometry';

type OrbitControlsRef = React.ComponentRef<typeof OrbitControls>;

const WALL_T = 0.12;
const FLOOR_T = 0.1;

interface WallSeg {
  /** Position le long du mur (début) en m. */
  from: number;
  to: number;
  /** Bas et haut du segment en m. */
  bottom: number;
  top: number;
}

/**
 * Découpe un mur en segments pleins autour de ses ouvertures :
 * trumeaux pleine hauteur, linteaux au-dessus, allèges sous les fenêtres.
 */
function wallSegments(room: Room, wall: number, len: number): WallSeg[] {
  const H = room.height;
  const ops = room.openings
    .filter((o) => o.wall === wall)
    .map((o) => ({ ...o, offset: Math.min(o.offset, Math.max(0, len - o.width)) }))
    .sort((a, b) => a.offset - b.offset);

  const segs: WallSeg[] = [];
  let cursor = 0;
  for (const o of ops) {
    if (o.offset > cursor) segs.push({ from: cursor, to: o.offset, bottom: 0, top: H });
    const opTop = Math.min(o.sillHeight + o.height, H);
    if (o.sillHeight > 0) segs.push({ from: o.offset, to: o.offset + o.width, bottom: 0, top: o.sillHeight });
    if (opTop < H) segs.push({ from: o.offset, to: o.offset + o.width, bottom: opTop, top: H });
    cursor = Math.max(cursor, o.offset + o.width);
  }
  if (cursor < len) segs.push({ from: cursor, to: len, bottom: 0, top: H });
  return segs.filter((s) => s.to - s.from > 0.01 && s.top - s.bottom > 0.01);
}

/** Hauteur des murs en mode « muret » (comme les murs abaissés des Sims). */
const LOW_WALL_H = 1.0;

function Wall({ room, wall, mode }: { room: Room; wall: number; mode: WallsMode }) {
  const select = useStore((s) => s.select);
  const isSelected = useStore(
    (s) => s.selection?.kind === 'wall' && s.selection.roomId === room.id && s.selection.index === wall
  );
  const { a, b } = wallEndpoints(room, wall);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const allSegs = useMemo(() => wallSegments(room, wall, len), [room, wall, len]);
  const color = room.walls[wall]?.color ?? '#f4f1ea';

  // Matériau partagé par tous les segments du mur : un seul fondu à piloter.
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        transparent: true,
        emissive: isSelected ? '#d4a373' : '#000000',
        emissiveIntensity: isSelected ? 0.3 : 0,
      }),
    [color, isSelected]
  );
  const anchorRef = useRef<THREE.Group>(null);
  const extrasRef = useRef<THREE.Group>(null);
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);

  const ux = len > 0 ? (b.x - a.x) / len : 1;
  const uy = len > 0 ? (b.y - a.y) / len : 0;
  // Polygone horaire ⇒ normale extérieure (uy, -ux) dans le plan, soit (uy, 0, -ux) en 3D.
  const outward = useMemo(() => new THREE.Vector3(uy, 0, -ux), [ux, uy]);

  // Effacement côté caméra (mode auto) : le mur dont on voit la face extérieure s'estompe.
  useFrame(({ camera }) => {
    let target = 1;
    if (mode === 'auto' && anchorRef.current) {
      anchorRef.current.getWorldPosition(worldPos);
      toCam.copy(camera.position).sub(worldPos);
      if (toCam.dot(outward) > 0) target = 0.1;
    }
    mat.opacity += (target - mat.opacity) * 0.25;
    if (extrasRef.current) extrasRef.current.visible = mat.opacity > 0.55;
  });

  if (room.walls[wall]?.open || len < 0.01) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);

  const at = (t: number): [number, number] => [a.x + ux * t, a.y + uy * t];
  // Mode « muret » : les murs sont tronqués à hauteur de coude.
  const segs =
    mode === 'down'
      ? allSegs
          .filter((s) => s.bottom < LOW_WALL_H)
          .map((s) => ({ ...s, top: Math.min(s.top, LOW_WALL_H) }))
      : allSegs;
  const [ax, az] = at(len / 2);

  return (
    <>
      <group ref={anchorRef} position={[ax, room.height / 2, az]} />
      {segs.map((seg, i) => {
        const segLen = seg.to - seg.from;
        const h = seg.top - seg.bottom;
        const [mx, mz] = at((seg.from + seg.to) / 2);
        return (
          <mesh
            key={i}
            position={[mx, seg.bottom + h / 2, mz]}
            rotation={[0, -angle, 0]}
            castShadow
            receiveShadow
            material={mat}
            onClick={(e) => {
              e.stopPropagation();
              select({ kind: 'wall', roomId: room.id, index: wall });
            }}
          >
            <boxGeometry args={[segLen, h, WALL_T]} />
          </mesh>
        );
      })}
      {/* Vitrages, meneaux et vantaux dans les ouvertures (masqués quand le mur s'efface) */}
      <group ref={extrasRef}>
      {mode !== 'down' && room.openings
        .filter((o) => o.wall === wall)
        .map((o) => {
          const off = Math.min(o.offset, Math.max(0, len - o.width));
          const [mx, mz] = at(off + o.width / 2);
          const cy = o.sillHeight + o.height / 2;
          if (o.type === 'porte' || o.type === 'porte_entree') {
            return (
              <mesh key={o.id} position={[mx, cy, mz]} rotation={[0, -angle, 0]} castShadow>
                <boxGeometry args={[o.width * 0.96, o.height * 0.98, 0.05]} />
                <meshStandardMaterial color={o.type === 'porte_entree' ? '#5d4632' : '#8a7358'} roughness={0.6} />
              </mesh>
            );
          }
          return (
            <group key={o.id} position={[mx, cy, mz]} rotation={[0, -angle, 0]}>
              <mesh>
                <boxGeometry args={[o.width, o.height, 0.02]} />
                <meshStandardMaterial color="#aaccee" transparent opacity={0.3} roughness={0.1} metalness={0.3} />
              </mesh>
              {o.type === 'double_fenetre' && (
                <mesh castShadow>
                  <boxGeometry args={[0.06, o.height, WALL_T * 0.7]} />
                  <meshStandardMaterial color="#e8e6e1" roughness={0.7} />
                </mesh>
              )}
            </group>
          );
        })}
      </group>
    </>
  );
}

function RoomMesh({ room, selected, wallsMode }: { room: Room; selected: boolean; wallsMode: WallsMode }) {
  const select = useStore((s) => s.select);

  const floorGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    room.points.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_T, bevelEnabled: false });
    geo.computeVertexNormals();
    return geo;
  }, [room.points]);

  const highlightGeometry = useMemo(() => {
    if (!selected) return null;
    const shape = new THREE.Shape();
    room.points.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [room.points, selected]);

  return (
    <group>
      {/* Extrusion en XY puis bascule : le plan (x, y) devient (X, Z), la dalle part sous y=0. */}
      <mesh
        geometry={floorGeometry}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          select({ kind: 'room', id: room.id });
        }}
      >
        <meshStandardMaterial color={FLOOR_COLORS[room.floor]} roughness={0.85} />
      </mesh>
      {selected && highlightGeometry && (
        <mesh geometry={highlightGeometry} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <meshBasicMaterial color="#d4a373" transparent opacity={0.12} side={THREE.DoubleSide} />
        </mesh>
      )}
      {room.points.map((_, i) => (
        <Wall key={i} room={room} wall={i} mode={wallsMode} />
      ))}
      {/* Fenêtres de toit : verrière lumineuse posée au niveau du plafond. */}
      {room.roofWindows.map((rw) => (
        <group key={rw.id} position={[rw.x, room.height + 0.02, rw.y]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[rw.width, rw.length]} />
            <meshStandardMaterial
              color="#cfe6f5"
              emissive="#bcd8ee"
              emissiveIntensity={0.9}
              transparent
              opacity={0.85}
              side={THREE.DoubleSide}
            />
          </mesh>
          <pointLight position={[0, -0.3, 0]} intensity={2.5} distance={4.5} color="#eaf4ff" decay={2} />
        </group>
      ))}
    </group>
  );
}

/** Escaliers volumétriques : marches cumulées selon le type. */
function StairsMesh({ f, selected, onClick }: { f: PlacedFurniture; selected: boolean; onClick: (e: { stopPropagation: () => void }) => void }) {
  const mat = (
    <meshStandardMaterial color={f.color} roughness={0.75} emissive={selected ? '#d4a373' : '#000000'} emissiveIntensity={selected ? 0.25 : 0} />
  );
  const parts: React.ReactNode[] = [];
  const { width: w, depth: d, height: h } = f;

  if (f.shape === 'stairs_droit') {
    const n = Math.max(8, Math.round(h / 0.19));
    const stepD = d / n;
    for (let i = 0; i < n; i++) {
      const sh = ((i + 1) / n) * h;
      parts.push(
        <mesh key={i} position={[0, sh / 2, d / 2 - (i + 0.5) * stepD]} castShadow onClick={onClick}>
          <boxGeometry args={[w, sh, stepD]} />
          {mat}
        </mesh>
      );
    }
  } else if (f.shape === 'stairs_quart') {
    const nA = 6;
    const bandD = d * 0.4;
    const flightAW = w * 0.55;
    for (let i = 0; i < nA; i++) {
      const sh = ((i + 1) / nA) * h * 0.45;
      const stepW = flightAW / nA;
      parts.push(
        <mesh key={`a${i}`} position={[-w / 2 + (i + 0.5) * stepW, sh / 2, d / 2 - bandD / 2]} castShadow onClick={onClick}>
          <boxGeometry args={[stepW, sh, bandD]} />
          {mat}
        </mesh>
      );
    }
    parts.push(
      <mesh key="palier" position={[-w / 2 + flightAW + (w - flightAW) / 2, h * 0.475, d / 2 - bandD / 2]} castShadow onClick={onClick}>
        <boxGeometry args={[w - flightAW, h * 0.95 * 0.5, bandD]} />
        {mat}
      </mesh>
    );
    const nB = 7;
    const flightBD = d - bandD;
    for (let i = 0; i < nB; i++) {
      const sh = h * 0.5 + ((i + 1) / nB) * h * 0.5;
      const stepD = flightBD / nB;
      parts.push(
        <mesh key={`b${i}`} position={[-w / 2 + flightAW + (w - flightAW) / 2, sh / 2, d / 2 - bandD - (i + 0.5) * stepD]} castShadow onClick={onClick}>
          <boxGeometry args={[w - flightAW, sh, stepD]} />
          {mat}
        </mesh>
      );
    }
  } else if (f.shape === 'stairs_demi') {
    const bandW = w * 0.44;
    const landingD = d * 0.28;
    const flightD = d - landingD;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const stepD = flightD / n;
      const shUp = ((i + 1) / n) * h * 0.45;
      parts.push(
        <mesh key={`l${i}`} position={[-w / 2 + bandW / 2, shUp / 2, d / 2 - (i + 0.5) * stepD]} castShadow onClick={onClick}>
          <boxGeometry args={[bandW, shUp, stepD]} />
          {mat}
        </mesh>
      );
      const shDown = h * 0.5 + ((i + 1) / n) * h * 0.5;
      parts.push(
        <mesh key={`r${i}`} position={[w / 2 - bandW / 2, shDown / 2, -d / 2 + landingD + (i + 0.5) * stepD]} castShadow onClick={onClick}>
          <boxGeometry args={[bandW, shDown, stepD]} />
          {mat}
        </mesh>
      );
    }
    parts.push(
      <mesh key="palier" position={[0, h * 0.475, -d / 2 + landingD / 2]} castShadow onClick={onClick}>
        <boxGeometry args={[w, h * 0.95 * 0.5, landingD]} />
        {mat}
      </mesh>
    );
  } else {
    // Colimaçon
    const n = 14;
    const r = Math.min(w, d) / 2;
    parts.push(
      <mesh key="pole" position={[0, h / 2, 0]} castShadow onClick={onClick}>
        <cylinderGeometry args={[0.05, 0.05, h, 12]} />
        {mat}
      </mesh>
    );
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 1.9;
      const y = ((i + 1) / n) * (h - 0.1);
      parts.push(
        <group key={i} rotation={[0, -a, 0]}>
          <mesh position={[r / 2, y, 0]} castShadow onClick={onClick}>
            <boxGeometry args={[r, 0.05, r * 0.42]} />
            {mat}
          </mesh>
        </group>
      );
    }
  }
  return <>{parts}</>;
}

/** Assombrit / éclaircit une couleur hex (facteur < 1 = plus sombre). */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const ch = (v: number) => Math.min(255, Math.max(0, Math.round(v * factor)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

type ClickHandler = (e: { stopPropagation: () => void }) => void;

interface BuilderProps {
  f: PlacedFurniture;
  selected: boolean;
  onClick: ClickHandler;
}

function furnMaterial(color: string, selected: boolean, roughness = 0.8) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      emissive={selected ? '#d4a373' : '#000000'}
      emissiveIntensity={selected ? 0.25 : 0}
    />
  );
}

/** Canapé / fauteuil : assise + dossier + accoudoirs (droit ou d'angle). */
function SofaMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, depth: d, height: h } = f;
  const armW = Math.min(0.16, w * 0.14);
  const backD = d * 0.24;
  const seatH = h * 0.42;
  const armH = h * 0.7;
  const body = furnMaterial(f.color, selected);
  const dark = furnMaterial(shade(f.color, 0.82), selected);
  if (f.shape === 'lshape') {
    return (
      <group>
        {/* Aile principale (fond) + son dossier */}
        <mesh position={[0, seatH / 2, -d * 0.225]} castShadow onClick={onClick}>
          <boxGeometry args={[w, seatH, d * 0.55]} />
          {body}
        </mesh>
        <mesh position={[0, h / 2, -d / 2 + backD / 2]} castShadow onClick={onClick}>
          <boxGeometry args={[w, h, backD]} />
          {dark}
        </mesh>
        {/* Méridienne (retour) + dossier extérieur */}
        <mesh position={[-w * 0.225, seatH / 2, d * 0.225]} castShadow onClick={onClick}>
          <boxGeometry args={[w * 0.55, seatH, d * 0.45]} />
          {body}
        </mesh>
        <mesh position={[-w / 2 + armW / 2, armH / 2, d * 0.225]} castShadow onClick={onClick}>
          <boxGeometry args={[armW, armH, d * 0.45]} />
          {dark}
        </mesh>
        <mesh position={[w / 2 - armW / 2, armH / 2, -d * 0.225]} castShadow onClick={onClick}>
          <boxGeometry args={[armW, armH, d * 0.55]} />
          {dark}
        </mesh>
      </group>
    );
  }
  return (
    <group>
      <mesh position={[0, seatH / 2, backD * 0.3]} castShadow onClick={onClick}>
        <boxGeometry args={[w, seatH, d - backD * 0.6]} />
        {body}
      </mesh>
      <mesh position={[0, h / 2, -d / 2 + backD / 2]} castShadow onClick={onClick}>
        <boxGeometry args={[w - armW, h, backD]} />
        {dark}
      </mesh>
      <mesh position={[-w / 2 + armW / 2, armH / 2, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[armW, armH, d]} />
        {dark}
      </mesh>
      <mesh position={[w / 2 - armW / 2, armH / 2, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[armW, armH, d]} />
        {dark}
      </mesh>
      {/* Coussins d'assise */}
      <mesh position={[0, seatH + 0.03, backD * 0.3]} castShadow onClick={onClick}>
        <boxGeometry args={[w - armW * 2 - 0.04, 0.09, d - backD * 1.2]} />
        {furnMaterial(shade(f.color, 1.08), selected, 0.9)}
      </mesh>
    </group>
  );
}

/** Chaise : assise, dossier, 4 pieds. */
function ChairMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, depth: d, height: h } = f;
  const seatY = Math.min(0.47, h * 0.55);
  const legR = 0.02;
  const body = furnMaterial(f.color, selected);
  const dark = furnMaterial(shade(f.color, 0.75), selected);
  const lx = w / 2 - 0.04;
  const lz = d / 2 - 0.04;
  return (
    <group>
      <mesh position={[0, seatY, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[w, 0.05, d]} />
        {body}
      </mesh>
      <mesh position={[0, (seatY + h) / 2, -d / 2 + 0.02]} castShadow onClick={onClick}>
        <boxGeometry args={[w * 0.9, h - seatY, 0.04]} />
        {body}
      </mesh>
      {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([px, pz], i) => (
        <mesh key={i} position={[px, seatY / 2, pz]} castShadow onClick={onClick}>
          <cylinderGeometry args={[legR, legR, seatY, 8]} />
          {dark}
        </mesh>
      ))}
    </group>
  );
}

/** Table / bureau : plateau + pieds (central pour les rondes). */
function TableMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, depth: d, height: h } = f;
  const topT = 0.045;
  const body = furnMaterial(f.color, selected, 0.6);
  const dark = furnMaterial(shade(f.color, 0.72), selected);
  if (f.shape === 'round') {
    return (
      <group>
        <mesh position={[0, h - topT / 2, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[w / 2, w / 2, topT, 32]} />
          {body}
        </mesh>
        <mesh position={[0, (h - topT) / 2, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[0.05, 0.05, h - topT, 12]} />
          {dark}
        </mesh>
        <mesh position={[0, 0.02, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[w / 4, w / 4, 0.04, 24]} />
          {dark}
        </mesh>
      </group>
    );
  }
  const lx = w / 2 - 0.06;
  const lz = d / 2 - 0.06;
  return (
    <group>
      <mesh position={[0, h - topT / 2, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[w, topT, d]} />
        {body}
      </mesh>
      {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([px, pz], i) => (
        <mesh key={i} position={[px, (h - topT) / 2, pz]} castShadow onClick={onClick}>
          <boxGeometry args={[0.06, h - topT, 0.06]} />
          {dark}
        </mesh>
      ))}
      {f.category === 'bureau' && (
        <mesh position={[w / 4, h - topT - 0.15, 0]} castShadow onClick={onClick}>
          <boxGeometry args={[w * 0.4, 0.3, d * 0.9]} />
          {dark}
        </mesh>
      )}
    </group>
  );
}

/** Lit : cadre, matelas, tête de lit et oreillers. */
function BedMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, depth: d, height: h } = f;
  const frameH = h * 0.4;
  const body = furnMaterial(shade(f.color, 0.8), selected);
  return (
    <group>
      <mesh position={[0, frameH / 2, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[w, frameH, d]} />
        {body}
      </mesh>
      <mesh position={[0, frameH + h * 0.14, 0.02]} castShadow onClick={onClick}>
        <boxGeometry args={[w - 0.06, h * 0.28, d - 0.1]} />
        {furnMaterial('#efe9dd', selected, 0.95)}
      </mesh>
      <mesh position={[0, h * 0.65, -d / 2 + 0.04]} castShadow onClick={onClick}>
        <boxGeometry args={[w, h * 1.3, 0.08]} />
        {furnMaterial(f.color, selected)}
      </mesh>
      {[-w / 4, w / 4].map((px, i) => (
        <mesh key={i} position={[w > 1.2 ? px : 0, frameH + h * 0.32, -d / 2 + 0.35]} castShadow onClick={onClick}>
          <boxGeometry args={[Math.min(0.55, w * 0.38), 0.12, 0.35]} />
          {furnMaterial('#ffffff', selected, 0.95)}
        </mesh>
      ))}
    </group>
  );
}

/** Plante décorative : pot + feuillage. */
function PlantMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, height: h } = f;
  return (
    <group>
      <mesh position={[0, h * 0.15, 0]} castShadow onClick={onClick}>
        <cylinderGeometry args={[w * 0.28, w * 0.22, h * 0.3, 16]} />
        {furnMaterial('#9a6b4f', selected)}
      </mesh>
      <mesh position={[0, h * 0.62, 0]} castShadow onClick={onClick}>
        <sphereGeometry args={[w * 0.5, 16, 12]} />
        {furnMaterial('#4f7a4a', selected, 0.95)}
      </mesh>
      <mesh position={[w * 0.2, h * 0.78, w * 0.1]} castShadow onClick={onClick}>
        <sphereGeometry args={[w * 0.3, 12, 10]} />
        {furnMaterial('#5d8a54', selected, 0.95)}
      </mesh>
    </group>
  );
}

/** Volume simple avec la photo produit plaquée sur la face avant si disponible. */
function BoxMesh({ f, selected, onClick }: BuilderProps) {
  const { width: w, depth: d, height: h } = f;
  const texture = useMemo(() => {
    if (!f.photoUrl) return null;
    const t = new THREE.TextureLoader().load(f.photoUrl);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [f.photoUrl]);
  if (f.shape === 'round') {
    return (
      <mesh position={[0, h / 2, 0]} castShadow onClick={onClick}>
        <cylinderGeometry args={[w / 2, w / 2, h, 24]} />
        {furnMaterial(f.color, selected)}
      </mesh>
    );
  }
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow onClick={onClick}>
        <boxGeometry args={[w, h, d]} />
        {furnMaterial(f.color, selected)}
      </mesh>
      {texture && h > 0.3 && (
        <mesh position={[0, h / 2, d / 2 + 0.006]} onClick={onClick}>
          <planeGeometry args={[w * 0.96, h * 0.94]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      )}
      {/* Plinthe pour asseoir visuellement les rangements hauts */}
      {h > 1 && (
        <mesh position={[0, 0.03, 0]} castShadow onClick={onClick}>
          <boxGeometry args={[w * 0.98, 0.06, d * 0.98]} />
          {furnMaterial(shade(f.color, 0.6), selected)}
        </mesh>
      )}
    </group>
  );
}

function FurnitureMesh({ f, selected }: { f: PlacedFurniture; selected: boolean }) {
  const select = useStore((s) => s.select);
  const rot = (-f.rotation * Math.PI) / 180;
  const onClick: ClickHandler = (e) => {
    e.stopPropagation();
    select({ kind: 'furniture', id: f.id });
  };

  let body: React.ReactNode;
  if (f.shape.startsWith('stairs_')) {
    body = <StairsMesh f={f} selected={selected} onClick={onClick} />;
  } else if (f.category === 'luminaire') {
    body = (
      <>
        <mesh position={[0, f.height / 2, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[0.02, 0.04, f.height, 12]} />
          <meshStandardMaterial color="#3a3a3c" emissive={selected ? '#d4a373' : '#000000'} emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, f.height * 0.9, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[f.width / 2, f.width / 2.6, Math.min(0.3, f.height * 0.25), 20]} />
          <meshStandardMaterial color={f.color} emissive="#ffe9c4" emissiveIntensity={0.55} />
        </mesh>
        <pointLight position={[0, f.height * 0.85, 0]} intensity={4} distance={5} color="#ffe0b0" decay={2} />
      </>
    );
  } else if (f.category === 'canape' || f.category === 'fauteuil') {
    body = <SofaMesh f={f} selected={selected} onClick={onClick} />;
  } else if (f.category === 'chaise' && f.height > 0.5) {
    body = <ChairMesh f={f} selected={selected} onClick={onClick} />;
  } else if (f.category === 'table' || f.category === 'table_basse' || f.category === 'bureau') {
    body = <TableMesh f={f} selected={selected} onClick={onClick} />;
  } else if (f.category === 'lit') {
    body = <BedMesh f={f} selected={selected} onClick={onClick} />;
  } else if (f.category === 'decoration' && f.shape === 'round' && f.height > 0.3) {
    body = <PlantMesh f={f} selected={selected} onClick={onClick} />;
  } else {
    body = <BoxMesh f={f} selected={selected} onClick={onClick} />;
  }

  return (
    <group position={[f.x, 0, f.y]} rotation={[0, rot, 0]}>
      {body}
    </group>
  );
}

/**
 * Navigation caméra au clavier, à la façon d'un mode construction de jeu :
 * flèches = déplacer la vue, Q/E = pivoter, PageUp/PageDown = zoomer.
 */
function CameraKeys({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsRef | null> }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const controls = controlsRef.current;
      if (!controls) return;
      const step = 0.45;
      fwd.subVectors(controls.target, camera.position);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, up).normalize().negate();
      const pan = (v: THREE.Vector3, k: number) => {
        controls.target.addScaledVector(v, k);
        camera.position.addScaledVector(v, k);
        controls.update();
        e.preventDefault();
      };
      switch (e.key) {
        case 'ArrowUp': pan(fwd, step); break;
        case 'ArrowDown': pan(fwd, -step); break;
        case 'ArrowLeft': pan(right, step); break;
        case 'ArrowRight': pan(right, -step); break;
        case 'q': case 'Q': case 'e': case 'E': {
          const dir = e.key === 'q' || e.key === 'Q' ? 1 : -1;
          const offset = camera.position.clone().sub(controls.target);
          offset.applyAxisAngle(up, dir * 0.09);
          camera.position.copy(controls.target).add(offset);
          controls.update();
          break;
        }
        case 'PageUp': case 'PageDown': {
          const k = e.key === 'PageUp' ? 0.88 : 1.14;
          const offset = camera.position.clone().sub(controls.target).multiplyScalar(k);
          camera.position.copy(controls.target).add(offset);
          controls.update();
          e.preventDefault();
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, controlsRef]);
  return null;
}

export default function View3D() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const showAll = useStore((s) => s.show3DAllFloors);
  const setShowAll = useStore((s) => s.setShow3DAllFloors);
  const placement = useStore((s) => s.placement);
  const placementRotation = useStore((s) => s.placementRotation);
  const rotatePlacement = useStore((s) => s.rotatePlacement);
  const dropPlacement = useStore((s) => s.dropPlacement);
  const updateFurniture = useStore((s) => s.updateFurniture);
  const snap = useStore((s) => s.snap);
  const wallsMode = useStore((s) => s.wallsMode);
  const setWallsMode = useStore((s) => s.setWallsMode);

  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const controlsRef = useRef<OrbitControlsRef | null>(null);

  const endDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    if (controlsRef.current) controlsRef.current.enabled = true;
  };
  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, []);

  const activeFloor = resolveActiveFloor(project, activeFloorId);
  const floorsSorted = [...project.floors].sort((a, b) => a.level - b.level);

  /** Décalage vertical de chaque niveau : somme des hauteurs (+ dalle) des niveaux inférieurs. */
  const yOffsets = new Map<string, number>();
  let acc = 0;
  for (const fl of floorsSorted) {
    yOffsets.set(fl.id, acc);
    const heights = project.rooms.filter((r) => r.floorId === fl.id).map((r) => r.height);
    acc += (heights.length > 0 ? Math.max(...heights) : 2.5) + SLAB_T;
  }

  const visibleFloors = showAll ? floorsSorted : [activeFloor];
  const offsetOf = (floorId: string) => (showAll ? (yOffsets.get(floorId) ?? 0) : 0);

  const b = planBounds(project.rooms, 0);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 6);

  const activeOffset = offsetOf(activeFloor.id);
  const rotRad = (-placementRotation * Math.PI) / 180;

  /** Vérifie l'emplacement d'un candidat sur le niveau actif (teinte verte/rouge). */
  const check = (cand: { x: number; y: number; width: number; depth: number; rotation: number; height: number }, ignoreId?: string) =>
    checkPlacement(project.rooms, project.furniture, activeFloor.id, cand, ignoreId);

  const draggedFurniture = draggingId ? project.furniture.find((f) => f.id === draggingId) : null;

  const onPlaneMove = (e: ThreeEvent<PointerEvent>) => {
    const x = snapTo(e.point.x, snap);
    const y = snapTo(e.point.z, snap);
    if (placement) {
      setGhost({ x, y });
    } else if (dragRef.current) {
      updateFurniture(dragRef.current.id, {
        x: snapTo(e.point.x - dragRef.current.dx, snap),
        y: snapTo(e.point.z - dragRef.current.dy, snap),
      });
    }
  };

  const onPlaneDown = (e: ThreeEvent<PointerEvent>) => {
    if (placement && ghost) {
      e.stopPropagation();
      dropPlacement(ghost.x, ghost.y);
      setGhost(null);
    }
  };

  const startFurnitureDrag = (e: ThreeEvent<PointerEvent>, f: PlacedFurniture) => {
    if (placement || f.floorId !== activeFloor.id) return;
    e.stopPropagation();
    dragRef.current = { id: f.id, dx: e.point.x - f.x, dy: e.point.z - f.y };
    setDraggingId(f.id);
    select({ kind: 'furniture', id: f.id });
    if (controlsRef.current) controlsRef.current.enabled = false;
  };

  return (
    <div
      style={{ flex: 1, minWidth: 0, background: '#111318', position: 'relative' }}
      onWheel={(e) => {
        // Pendant une pose : la molette pivote l'objet (le zoom caméra est suspendu).
        if (placement) rotatePlacement(e.deltaY > 0 ? 15 : -15);
      }}
    >
      <div className="floor-switcher view3d-switcher">
        <button className={showAll ? 'active' : ''} onClick={() => setShowAll(true)}>
          Tous les niveaux
        </button>
        {floorsSorted.map((f) => (
          <button
            key={f.id}
            className={!showAll && f.id === activeFloor.id ? 'active' : ''}
            onClick={() => {
              setShowAll(false);
              setActiveFloor(f.id);
            }}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="floor-switcher view3d-walls">
        <span className="walls-label">Murs</span>
        <button className={wallsMode === 'auto' ? 'active' : ''} onClick={() => setWallsMode('auto')} title="Les murs face à la caméra s'effacent">
          Auto
        </button>
        <button className={wallsMode === 'up' ? 'active' : ''} onClick={() => setWallsMode('up')}>
          Hauts
        </button>
        <button className={wallsMode === 'down' ? 'active' : ''} onClick={() => setWallsMode('down')} title="Murs abaissés à 1 m">
          Muret
        </button>
      </div>
      <div className="view3d-help">
        Glissez un meuble pour le déplacer · <kbd>R</kbd> pivoter · <kbd>Suppr</kbd> supprimer · flèches
        déplacer la vue · <kbd>Q</kbd>/<kbd>E</kbd> pivoter la vue · <kbd>Pg↑</kbd>/<kbd>Pg↓</kbd> zoom
      </div>
      <Canvas
        shadows
        camera={{ position: [cx + span * 0.7, span * 0.8, cz + span * 1.1], fov: 50 }}
        onPointerMissed={() => select(null)}
      >
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[cx + 8, 14, cz - 6]}
          intensity={1.4}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <hemisphereLight args={['#cfd8e8', '#3a3228', 0.5]} />

        {visibleFloors.map((fl) => (
          <group key={fl.id} position={[0, offsetOf(fl.id), 0]}>
            {project.rooms
              .filter((r) => r.floorId === fl.id)
              .map((room) => (
                <RoomMesh
                  key={room.id}
                  room={room}
                  wallsMode={wallsMode}
                  selected={selection?.kind === 'room' && selection.id === room.id}
                />
              ))}
            {project.furniture
              .filter((f) => f.floorId === fl.id)
              .map((f) => (
                <group
                  key={f.id}
                  onPointerDown={(e) => startFurnitureDrag(e, f)}
                  onPointerOver={(e) => {
                    if (fl.id !== activeFloor.id || placement) return;
                    e.stopPropagation();
                    setHoverId(f.id);
                    document.body.style.cursor = 'grab';
                  }}
                  onPointerOut={() => {
                    setHoverId((h) => (h === f.id ? null : h));
                    document.body.style.cursor = '';
                  }}
                >
                  <FurnitureMesh
                    f={f}
                    selected={(selection?.kind === 'furniture' && selection.id === f.id) || hoverId === f.id}
                  />
                </group>
              ))}
          </group>
        ))}

        {/* Empreinte de validité sous le meuble en cours de déplacement */}
        {draggedFurniture && (() => {
          const c = check(draggedFurniture, draggedFurniture.id);
          return (
            <mesh
              position={[draggedFurniture.x, activeOffset + 0.015, draggedFurniture.y]}
              rotation={[-Math.PI / 2, 0, (-draggedFurniture.rotation * Math.PI) / 180]}
            >
              <planeGeometry args={[draggedFurniture.width + 0.1, draggedFurniture.depth + 0.1]} />
              <meshBasicMaterial color={c.valid ? '#5ebe6e' : '#e05a4a'} transparent opacity={0.45} />
            </mesh>
          );
        })()}

        {/* Fantôme du meuble accroché au curseur */}
        {placement && ghost && (() => {
          const cand = {
            x: ghost.x,
            y: ghost.y,
            width: placement.width,
            depth: placement.depth,
            rotation: placementRotation,
            height: placement.height,
          };
          const c = check(cand);
          const ghostF: PlacedFurniture = {
            id: '__ghost__',
            floorId: activeFloor.id,
            name: placement.name,
            category: placement.category,
            shape: placement.shape,
            x: ghost.x,
            y: ghost.y,
            rotation: placementRotation,
            width: placement.width,
            depth: placement.depth,
            height: placement.height,
            color: placement.color,
            existing: placement.existing,
            photoUrl: placement.photoUrl,
          };
          return (
            <group position={[0, activeOffset, 0]}>
              <mesh position={[ghost.x, 0.015, ghost.y]} rotation={[-Math.PI / 2, 0, rotRad]}>
                <planeGeometry args={[placement.width + 0.12, placement.depth + 0.12]} />
                <meshBasicMaterial color={c.valid ? '#5ebe6e' : '#e05a4a'} transparent opacity={0.5} />
              </mesh>
              <FurnitureMesh f={ghostF} selected={false} />
            </group>
          );
        })()}

        {/* Plan de sol invisible du niveau actif : cible du pointeur pour poser et déplacer */}
        <mesh
          position={[cx, activeOffset - 0.005, cz]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
          onPointerMove={onPlaneMove}
          onPointerDown={onPlaneDown}
        >
          <planeGeometry args={[span * 8, span * 8]} />
        </mesh>

        <CameraKeys controlsRef={controlsRef} />

        <ContactShadows position={[cx, -FLOOR_T - 0.01, cz]} scale={span * 2.5} opacity={0.4} blur={2} far={4} />
        <mesh position={[cx, -FLOOR_T - 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[span * 6, span * 6]} />
          <meshStandardMaterial color="#1a1d23" roughness={1} />
        </mesh>

        <OrbitControls
          ref={controlsRef}
          target={[cx, 0.8, cz]}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={2}
          maxDistance={span * 4}
          enableZoom={!placement}
        />
      </Canvas>
    </div>
  );
}
