import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import type { PlacedFurniture, Room, WallSide } from '../../types';
import { FLOOR_COLORS } from '../../types';
import { planBounds } from '../../utils/geometry';

const WALL_T = 0.12;

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
function wallSegments(room: Room, side: WallSide): WallSeg[] {
  const len = side === 'N' || side === 'S' ? room.width : room.length;
  const H = room.height;
  const ops = room.openings
    .filter((o) => o.wall === side)
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

function Wall({ room, side }: { room: Room; side: WallSide }) {
  const segs = useMemo(() => wallSegments(room, side), [room, side]);
  const color = room.wallColors[side];
  return (
    <>
      {segs.map((s, i) => {
        const segLen = s.to - s.from;
        const h = s.top - s.bottom;
        const mid = (s.from + s.to) / 2;
        const y = s.bottom + h / 2;
        let x = 0, z = 0, horizontal = true;
        switch (side) {
          case 'N': x = room.x + mid; z = room.y; horizontal = true; break;
          case 'S': x = room.x + mid; z = room.y + room.length; horizontal = true; break;
          case 'W': x = room.x; z = room.y + mid; horizontal = false; break;
          case 'E': x = room.x + room.width; z = room.y + mid; horizontal = false; break;
        }
        return (
          <mesh key={i} position={[x, y, z]} castShadow receiveShadow>
            <boxGeometry args={horizontal ? [segLen, h, WALL_T] : [WALL_T, h, segLen]} />
            <meshStandardMaterial color={color} roughness={0.92} />
          </mesh>
        );
      })}
      {/* Vitrage des fenêtres */}
      {room.openings
        .filter((o) => o.wall === side && o.type !== 'porte')
        .map((o) => {
          const mid = o.offset + o.width / 2;
          const y = o.sillHeight + o.height / 2;
          let x = 0, z = 0;
          const horizontal = side === 'N' || side === 'S';
          switch (side) {
            case 'N': x = room.x + mid; z = room.y; break;
            case 'S': x = room.x + mid; z = room.y + room.length; break;
            case 'W': x = room.x; z = room.y + mid; break;
            case 'E': x = room.x + room.width; z = room.y + mid; break;
          }
          return (
            <mesh key={o.id} position={[x, y, z]}>
              <boxGeometry args={horizontal ? [o.width, o.height, 0.02] : [0.02, o.height, o.width]} />
              <meshStandardMaterial color="#aaccee" transparent opacity={0.3} roughness={0.1} metalness={0.3} />
            </mesh>
          );
        })}
    </>
  );
}

function RoomMesh({ room, selected }: { room: Room; selected: boolean }) {
  const select = useStore((s) => s.select);
  return (
    <group>
      <mesh
        position={[room.x + room.width / 2, -0.05, room.y + room.length / 2]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          select({ kind: 'room', id: room.id });
        }}
      >
        <boxGeometry args={[room.width, 0.1, room.length]} />
        <meshStandardMaterial color={FLOOR_COLORS[room.floor]} roughness={0.85} />
      </mesh>
      {selected && (
        <mesh position={[room.x + room.width / 2, 0.011, room.y + room.length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[room.width, room.length]} />
          <meshBasicMaterial color="#d4a373" transparent opacity={0.12} />
        </mesh>
      )}
      {(['N', 'S', 'E', 'W'] as WallSide[]).map((side) => (
        <Wall key={side} room={room} side={side} />
      ))}
    </group>
  );
}

function FurnitureMesh({ f, selected }: { f: PlacedFurniture; selected: boolean }) {
  const select = useStore((s) => s.select);
  const rot = (-f.rotation * Math.PI) / 180;
  const isLamp = f.category === 'luminaire';
  const emissive = selected ? '#d4a373' : '#000000';
  const onClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    select({ kind: 'furniture', id: f.id });
  };

  return (
    <group position={[f.x, 0, f.y]} rotation={[0, rot, 0]}>
      {isLamp ? (
        <>
          <mesh position={[0, f.height / 2, 0]} castShadow onClick={onClick}>
            <cylinderGeometry args={[0.02, 0.04, f.height, 12]} />
            <meshStandardMaterial color="#3a3a3c" emissive={emissive} emissiveIntensity={0.3} />
          </mesh>
          <mesh position={[0, f.height * 0.9, 0]} castShadow onClick={onClick}>
            <cylinderGeometry args={[f.width / 2, f.width / 2.6, Math.min(0.3, f.height * 0.25), 20]} />
            <meshStandardMaterial color={f.color} emissive="#ffe9c4" emissiveIntensity={0.55} />
          </mesh>
          <pointLight position={[0, f.height * 0.85, 0]} intensity={4} distance={5} color="#ffe0b0" decay={2} />
        </>
      ) : f.shape === 'round' ? (
        <mesh position={[0, f.height / 2, 0]} castShadow onClick={onClick}>
          <cylinderGeometry args={[f.width / 2, f.width / 2, f.height, 24]} />
          <meshStandardMaterial color={f.color} roughness={0.7} emissive={emissive} emissiveIntensity={selected ? 0.25 : 0} />
        </mesh>
      ) : f.shape === 'lshape' ? (
        <>
          <mesh position={[0, f.height / 2, -f.depth * 0.225]} castShadow onClick={onClick}>
            <boxGeometry args={[f.width, f.height, f.depth * 0.55]} />
            <meshStandardMaterial color={f.color} roughness={0.8} emissive={emissive} emissiveIntensity={selected ? 0.25 : 0} />
          </mesh>
          <mesh position={[-f.width * 0.225, f.height / 2, f.depth * 0.225]} castShadow onClick={onClick}>
            <boxGeometry args={[f.width * 0.55, f.height, f.depth * 0.45]} />
            <meshStandardMaterial color={f.color} roughness={0.8} emissive={emissive} emissiveIntensity={selected ? 0.25 : 0} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, f.height / 2, 0]} castShadow onClick={onClick}>
          <boxGeometry args={[f.width, f.height, f.depth]} />
          <meshStandardMaterial color={f.color} roughness={0.8} emissive={emissive} emissiveIntensity={selected ? 0.25 : 0} />
        </mesh>
      )}
    </group>
  );
}

export default function View3D() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);

  const b = planBounds(project.rooms, 0);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 6);

  return (
    <div style={{ flex: 1, minWidth: 0, background: '#111318' }}>
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

        {project.rooms.map((room) => (
          <RoomMesh key={room.id} room={room} selected={selection?.kind === 'room' && selection.id === room.id} />
        ))}
        {project.furniture.map((f) => (
          <FurnitureMesh key={f.id} f={f} selected={selection?.kind === 'furniture' && selection.id === f.id} />
        ))}

        <ContactShadows position={[cx, -0.11, cz]} scale={span * 2.5} opacity={0.4} blur={2} far={4} />
        <mesh position={[cx, -0.12, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[span * 6, span * 6]} />
          <meshStandardMaterial color="#1a1d23" roughness={1} />
        </mesh>

        <OrbitControls target={[cx, 0.8, cz]} maxPolarAngle={Math.PI / 2.05} minDistance={2} maxDistance={span * 4} />
      </Canvas>
    </div>
  );
}
