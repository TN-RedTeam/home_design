import { useState } from 'react';
import { PAINT_PALETTES } from '../../data/palettes';
import { useStore } from '../../store/useStore';
import type { FloorMaterial, Opening, OpeningType, Room, RoomType, WallSide } from '../../types';
import {
  FLOOR_LABELS,
  OPENING_LABELS,
  ROOM_TYPE_LABELS,
  WALL_LABELS,
  formatArea,
  formatLength,
} from '../../types';
import { wallLength } from '../../utils/geometry';

/** Champ dimension : édition en cm, stockage en m. */
function CmField({ label, value, min = 0.05, onChange }: { label: string; value: number; min?: number; onChange: (m: number) => void }) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Math.round(value * 100)}
        min={min * 100}
        step={1}
        onChange={(e) => {
          const cm = parseFloat(e.target.value);
          if (Number.isFinite(cm) && cm >= min * 100) onChange(cm / 100);
        }}
      />
    </label>
  );
}

function PaintPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [paletteIdx, setPaletteIdx] = useState(0);
  const palette = PAINT_PALETTES[paletteIdx];
  return (
    <div className="paint-picker">
      <div className="paint-row">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title="Code couleur libre (relevé sur un site de peinture)" />
        <input
          className="hex-input"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
          }}
          placeholder="#aabbcc"
        />
        <select value={paletteIdx} onChange={(e) => setPaletteIdx(Number(e.target.value))}>
          {PAINT_PALETTES.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="swatches">
        {palette.colors.map((c) => (
          <button
            key={c.hex}
            className={`swatch-btn ${value.toLowerCase() === c.hex.toLowerCase() ? 'active' : ''}`}
            style={{ background: c.hex }}
            title={c.name}
            onClick={() => onChange(c.hex)}
          />
        ))}
      </div>
    </div>
  );
}

function RoomProps({ room }: { room: Room }) {
  const updateRoom = useStore((s) => s.updateRoom);
  const removeRoom = useStore((s) => s.removeRoom);
  const addOpening = useStore((s) => s.addOpening);
  const select = useStore((s) => s.select);
  const [wall, setWall] = useState<WallSide>('N');

  const addOp = (type: OpeningType) => {
    const defaults: Record<OpeningType, Pick<Opening, 'width' | 'height' | 'sillHeight'>> = {
      porte: { width: 0.83, height: 2.04, sillHeight: 0 },
      fenetre: { width: 1.2, height: 1.25, sillHeight: 0.9 },
      porte_fenetre: { width: 2.2, height: 2.15, sillHeight: 0 },
    };
    const d = defaults[type];
    const maxOff = Math.max(0, wallLength(room, wall) - d.width);
    addOpening(room.id, { type, wall, offset: maxOff / 2, ...d });
  };

  return (
    <>
      <h2>Pièce</h2>
      <label>
        Nom
        <input value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} />
      </label>
      <label>
        Type
        <select value={room.type} onChange={(e) => updateRoom(room.id, { type: e.target.value as RoomType })}>
          {(Object.keys(ROOM_TYPE_LABELS) as RoomType[]).map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="dims-row">
        <CmField label="Largeur (cm)" value={room.width} min={1} onChange={(v) => updateRoom(room.id, { width: v })} />
        <CmField label="Prof. (cm)" value={room.length} min={1} onChange={(v) => updateRoom(room.id, { length: v })} />
        <CmField label="H. plafond" value={room.height} min={1.8} onChange={(v) => updateRoom(room.id, { height: v })} />
      </div>
      <p className="hint">Surface : {formatArea(room.width * room.length)}</p>
      <label>
        Sol
        <select value={room.floor} onChange={(e) => updateRoom(room.id, { floor: e.target.value as FloorMaterial })}>
          {(Object.keys(FLOOR_LABELS) as FloorMaterial[]).map((f) => (
            <option key={f} value={f}>
              {FLOOR_LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      <h3>Peinture des murs</h3>
      <div className="wall-tabs">
        {(['N', 'S', 'E', 'W'] as WallSide[]).map((w) => (
          <button key={w} className={wall === w ? 'active' : ''} style={{ borderBottomColor: room.wallColors[w] }} onClick={() => setWall(w)}>
            {w}
          </button>
        ))}
      </div>
      <p className="hint">{WALL_LABELS[wall]} — {formatLength(wallLength(room, wall))}</p>
      <PaintPicker
        value={room.wallColors[wall]}
        onChange={(hex) => updateRoom(room.id, { wallColors: { ...room.wallColors, [wall]: hex } })}
      />
      <button
        className="btn btn-block"
        onClick={() =>
          updateRoom(room.id, { wallColors: { N: room.wallColors[wall], S: room.wallColors[wall], E: room.wallColors[wall], W: room.wallColors[wall] } })
        }
      >
        Appliquer cette couleur aux 4 murs
      </button>

      <h3>Portes & fenêtres</h3>
      <div className="add-opening">
        <button className="btn btn-sm" onClick={() => addOp('porte')}>+ Porte</button>
        <button className="btn btn-sm" onClick={() => addOp('fenetre')}>+ Fenêtre</button>
        <button className="btn btn-sm" onClick={() => addOp('porte_fenetre')}>+ Porte-fenêtre</button>
        <span className="hint">sur mur {wall}</span>
      </div>
      <ul className="opening-list">
        {room.openings.map((o) => (
          <li key={o.id}>
            <button className="link" onClick={() => select({ kind: 'opening', roomId: room.id, id: o.id })}>
              {OPENING_LABELS[o.type]} · mur {o.wall} · {formatLength(o.width)}
            </button>
          </li>
        ))}
        {room.openings.length === 0 && <li className="hint">Aucune ouverture.</li>}
      </ul>

      <button className="btn btn-danger btn-block" onClick={() => removeRoom(room.id)}>
        Supprimer la pièce
      </button>
    </>
  );
}

function OpeningProps({ roomId, openingId }: { roomId: string; openingId: string }) {
  const room = useStore((s) => s.project.rooms.find((r) => r.id === roomId));
  const updateOpening = useStore((s) => s.updateOpening);
  const removeOpening = useStore((s) => s.removeOpening);
  const select = useStore((s) => s.select);
  const o = room?.openings.find((x) => x.id === openingId);
  if (!room || !o) return null;
  const maxOff = Math.max(0, wallLength(room, o.wall) - o.width);
  return (
    <>
      <h2>{OPENING_LABELS[o.type]}</h2>
      <p className="hint">{room.name} — {WALL_LABELS[o.wall]}</p>
      <label>
        Mur
        <select value={o.wall} onChange={(e) => updateOpening(roomId, o.id, { wall: e.target.value as WallSide, offset: 0 })}>
          {(['N', 'S', 'E', 'W'] as WallSide[]).map((w) => (
            <option key={w} value={w}>{WALL_LABELS[w]}</option>
          ))}
        </select>
      </label>
      <div className="dims-row">
        <CmField label="Largeur (cm)" value={o.width} min={0.3} onChange={(v) => updateOpening(roomId, o.id, { width: v })} />
        <CmField label="Hauteur (cm)" value={o.height} min={0.3} onChange={(v) => updateOpening(roomId, o.id, { height: v })} />
      </div>
      <div className="dims-row">
        <label>
          Position (cm)
          <input
            type="number"
            value={Math.round(o.offset * 100)}
            min={0}
            max={Math.round(maxOff * 100)}
            onChange={(e) => {
              const cm = parseFloat(e.target.value);
              if (Number.isFinite(cm)) updateOpening(roomId, o.id, { offset: Math.min(Math.max(0, cm / 100), maxOff) });
            }}
          />
        </label>
        {o.type === 'fenetre' && (
          <CmField label="Allège (cm)" value={o.sillHeight} min={0} onChange={(v) => updateOpening(roomId, o.id, { sillHeight: v })} />
        )}
      </div>
      <button className="btn btn-block" onClick={() => select({ kind: 'room', id: roomId })}>← Retour à la pièce</button>
      <button className="btn btn-danger btn-block" onClick={() => removeOpening(roomId, o.id)}>Supprimer</button>
    </>
  );
}

function FurnitureProps({ id }: { id: string }) {
  const f = useStore((s) => s.project.furniture.find((x) => x.id === id));
  const updateFurniture = useStore((s) => s.updateFurniture);
  const removeFurniture = useStore((s) => s.removeFurniture);
  const duplicateFurniture = useStore((s) => s.duplicateFurniture);
  if (!f) return null;
  return (
    <>
      <h2>Meuble</h2>
      <label>
        Nom
        <input value={f.name} onChange={(e) => updateFurniture(f.id, { name: e.target.value })} />
      </label>
      {f.photoUrl && <img className="web-preview" src={f.photoUrl} alt={f.name} />}
      <div className="dims-row">
        <CmField label="Largeur (cm)" value={f.width} onChange={(v) => updateFurniture(f.id, { width: v })} />
        <CmField label="Prof. (cm)" value={f.depth} onChange={(v) => updateFurniture(f.id, { depth: v })} />
        <CmField label="Haut. (cm)" value={f.height} onChange={(v) => updateFurniture(f.id, { height: v })} />
      </div>
      <div className="dims-row">
        <label>
          Rotation (°)
          <input
            type="number"
            value={Math.round(f.rotation)}
            step={15}
            onChange={(e) => {
              const deg = parseFloat(e.target.value);
              if (Number.isFinite(deg)) updateFurniture(f.id, { rotation: ((deg % 360) + 360) % 360 });
            }}
          />
        </label>
        <label>
          Couleur
          <input type="color" value={f.color} onChange={(e) => updateFurniture(f.id, { color: e.target.value })} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.existing} onChange={(e) => updateFurniture(f.id, { existing: e.target.checked })} />
        Meuble déjà présent chez moi
      </label>
      <p className="hint">
        {formatLength(f.width)} × {formatLength(f.depth)} × H {formatLength(f.height)}
        {f.existing ? ' · relevé existant (pointillés sur le plan)' : ' · projet d’achat'}
      </p>
      <button className="btn btn-block" onClick={() => duplicateFurniture(f.id)}>Dupliquer (D)</button>
      <button className="btn btn-danger btn-block" onClick={() => removeFurniture(f.id)}>Supprimer</button>
    </>
  );
}

export default function PropertiesPanel() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);

  return (
    <aside className="panel props-panel">
      {selection?.kind === 'room' && (() => {
        const room = project.rooms.find((r) => r.id === selection.id);
        return room ? <RoomProps room={room} /> : null;
      })()}
      {selection?.kind === 'opening' && <OpeningProps roomId={selection.roomId} openingId={selection.id} />}
      {selection?.kind === 'furniture' && <FurnitureProps id={selection.id} />}
      {!selection && (
        <>
          <h2>Propriétés</h2>
          <p className="hint">
            Sélectionnez une pièce, un meuble ou une ouverture sur le plan pour éditer ses dimensions, ses
            couleurs de peinture et sa position.
          </p>
          <h3>Le projet</h3>
          <p className="hint">
            {project.rooms.length} pièce(s) · {project.furniture.length} meuble(s) ·{' '}
            {formatArea(project.rooms.reduce((acc, r) => acc + r.width * r.length, 0))} au total
          </p>
        </>
      )}
    </aside>
  );
}
