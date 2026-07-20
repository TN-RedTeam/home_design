import { useState } from 'react';
import { PAINT_PALETTES } from '../../data/palettes';
import { useStore } from '../../store/useStore';
import type { FloorMaterial, OpeningType, Room, RoomType } from '../../types';
import {
  FLOOR_LABELS,
  OPENING_DEFAULTS,
  OPENING_LABELS,
  ROOF_WINDOW_DEFAULT,
  ROOM_TYPE_LABELS,
  formatArea,
  formatLength,
} from '../../types';
import { polygonCentroid } from '../../utils/geometry';
import { polygonArea, wallLength, withEdgeLength } from '../../utils/geometry';


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
  const updateWall = useStore((s) => s.updateWall);
  const addOpening = useStore((s) => s.addOpening);
  const addRoofWindow = useStore((s) => s.addRoofWindow);
  const select = useStore((s) => s.select);
  const [wall, setWall] = useState(0);
  const [openingType, setOpeningType] = useState<OpeningType>('fenetre');

  const n = room.points.length;
  const safeWall = Math.min(wall, n - 1);
  const currentWall = room.walls[safeWall];

  const addOp = () => {
    const d = OPENING_DEFAULTS[openingType];
    const len = wallLength(room, safeWall);
    if (len < d.width) return;
    addOpening(room.id, { type: openingType, wall: safeWall, offset: (len - d.width) / 2, ...d });
  };

  const addVelux = () => {
    const c = polygonCentroid(room.points);
    addRoofWindow(room.id, { x: c.x, y: c.y, ...ROOF_WINDOW_DEFAULT });
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
        <CmField label="H. plafond (cm)" value={room.height} min={1.8} onChange={(v) => updateRoom(room.id, { height: v })} />
      </div>
      <p className="hint">
        Surface : {formatArea(polygonArea(room.points))} · {n} murs. Sur le plan, glissez les sommets pour
        modifier la forme ; le bouton ◈ au milieu d'un mur le scinde en deux.
      </p>
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

      <h3>Murs</h3>
      <div className="wall-tabs wall-tabs-wrap">
        {room.walls.map((w, i) => (
          <button
            key={i}
            className={safeWall === i ? 'active' : ''}
            style={{ borderBottomColor: w.open ? 'transparent' : w.color }}
            onClick={() => setWall(i)}
            title={w.open ? 'Mur ouvert' : `Mur ${i + 1}`}
          >
            {w.open ? `${i + 1}○` : i + 1}
          </button>
        ))}
      </div>
      <div className="dims-row">
        <label>
          Longueur (cm)
          <input
            type="number"
            value={Math.round(wallLength(room, safeWall) * 100)}
            min={20}
            step={1}
            onChange={(e) => {
              const cm = parseFloat(e.target.value);
              if (Number.isFinite(cm) && cm >= 20) {
                updateRoom(room.id, { points: withEdgeLength(room.points, safeWall, cm / 100) });
              }
            }}
          />
        </label>
        <label className="check-row wall-open-toggle">
          <input
            type="checkbox"
            checked={currentWall?.open ?? false}
            onChange={(e) => updateWall(room.id, safeWall, { open: e.target.checked })}
          />
          Mur ouvert
        </label>
      </div>
      {currentWall?.open ? (
        <p className="hint">
          Espace ouvert : aucun mur n'est construit sur ce côté (cuisine ouverte, séjour traversant…).
        </p>
      ) : (
        <>
          <PaintPicker
            value={currentWall?.color ?? '#f4f1ea'}
            onChange={(hex) => updateWall(room.id, safeWall, { color: hex })}
          />
          <button
            className="btn btn-block"
            onClick={() =>
              updateRoom(room.id, {
                walls: room.walls.map((w) => (w.open ? w : { ...w, color: currentWall?.color ?? w.color })),
              })
            }
          >
            Appliquer cette couleur à tous les murs
          </button>
        </>
      )}

      <h3>Portes & fenêtres</h3>
      <div className="add-opening">
        <select value={openingType} onChange={(e) => setOpeningType(e.target.value as OpeningType)}>
          {(Object.keys(OPENING_LABELS) as OpeningType[]).map((t) => (
            <option key={t} value={t}>
              {OPENING_LABELS[t]} ({Math.round(OPENING_DEFAULTS[t].width * 100)} cm)
            </option>
          ))}
        </select>
        <button className="btn btn-sm btn-accent" onClick={addOp} disabled={currentWall?.open}>
          + Ajouter sur mur {safeWall + 1}
        </button>
      </div>
      <ul className="opening-list">
        {room.openings.map((o) => (
          <li key={o.id}>
            <button className="link" onClick={() => select({ kind: 'opening', roomId: room.id, id: o.id })}>
              {OPENING_LABELS[o.type]} · mur {o.wall + 1} · {formatLength(o.width)}
            </button>
          </li>
        ))}
        {room.openings.length === 0 && <li className="hint">Aucune ouverture.</li>}
      </ul>

      <h3>Fenêtres de toit</h3>
      <div className="add-opening">
        <button className="btn btn-sm" onClick={addVelux}>+ Ajouter un Velux</button>
        <span className="hint">{Math.round(ROOF_WINDOW_DEFAULT.width * 100)} × {Math.round(ROOF_WINDOW_DEFAULT.length * 100)} cm</span>
      </div>
      <ul className="opening-list">
        {room.roofWindows.map((rw) => (
          <li key={rw.id}>
            <button className="link" onClick={() => select({ kind: 'roofWindow', roomId: room.id, id: rw.id })}>
              Velux · {formatLength(rw.width)} × {formatLength(rw.length)}
            </button>
          </li>
        ))}
        {room.roofWindows.length === 0 && <li className="hint">Aucune fenêtre de toit.</li>}
      </ul>

      <button className="btn btn-danger btn-block" onClick={() => removeRoom(room.id)}>
        Supprimer la pièce
      </button>
    </>
  );
}

function RoofWindowProps({ roomId, roofWindowId }: { roomId: string; roofWindowId: string }) {
  const room = useStore((s) => s.project.rooms.find((r) => r.id === roomId));
  const updateRoofWindow = useStore((s) => s.updateRoofWindow);
  const removeRoofWindow = useStore((s) => s.removeRoofWindow);
  const select = useStore((s) => s.select);
  const rw = room?.roofWindows.find((x) => x.id === roofWindowId);
  if (!room || !rw) return null;
  return (
    <>
      <h2>Fenêtre de toit (Velux)</h2>
      <p className="hint">{room.name} — glissez-la sur le plan pour la positionner sous la pente.</p>
      <div className="dims-row">
        <CmField label="Largeur (cm)" value={rw.width} min={0.4} onChange={(v) => updateRoofWindow(roomId, rw.id, { width: v })} />
        <CmField label="Longueur (cm)" value={rw.length} min={0.4} onChange={(v) => updateRoofWindow(roomId, rw.id, { length: v })} />
      </div>
      <p className="hint">
        Formats courants : 55 × 78, 78 × 98, 78 × 118, 114 × 118 cm.
      </p>
      <button className="btn btn-block" onClick={() => select({ kind: 'room', id: roomId })}>← Retour à la pièce</button>
      <button className="btn btn-danger btn-block" onClick={() => removeRoofWindow(roomId, rw.id)}>Supprimer</button>
    </>
  );
}

function WallProps({ roomId, index }: { roomId: string; index: number }) {
  const room = useStore((s) => s.project.rooms.find((r) => r.id === roomId));
  const updateWall = useStore((s) => s.updateWall);
  const select = useStore((s) => s.select);
  if (!room || !room.walls[index]) return null;
  const wall = room.walls[index];
  return (
    <>
      <h2>Section de mur</h2>
      <p className="hint">
        {room.name} — mur {index + 1} · {formatLength(wallLength(room, index))}.{' '}
        {wall.open ? 'Section supprimée (espace ouvert).' : 'Touche Suppr : supprimer cette section de mur.'}
      </p>
      {wall.open ? (
        <button className="btn btn-accent btn-block" onClick={() => updateWall(roomId, index, { open: false })}>
          ➕ Reconstruire ce mur
        </button>
      ) : (
        <>
          <h3>Peinture</h3>
          <PaintPicker value={wall.color} onChange={(hex) => updateWall(roomId, index, { color: hex })} />
          <button className="btn btn-danger btn-block" onClick={() => { updateWall(roomId, index, { open: true }); }}>
            🗑 Supprimer cette section (mur ouvert)
          </button>
        </>
      )}
      <button className="btn btn-block" onClick={() => select({ kind: 'room', id: roomId })}>← Voir toute la pièce</button>
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
      <p className="hint">
        {room.name} — mur {o.wall + 1} ({formatLength(wallLength(room, o.wall))})
      </p>
      <label>
        Mur
        <select value={o.wall} onChange={(e) => updateOpening(roomId, o.id, { wall: Number(e.target.value), offset: 0 })}>
          {room.walls.map((w, i) => (
            <option key={i} value={i} disabled={w.open}>
              Mur {i + 1} · {formatLength(wallLength(room, i))}{w.open ? ' (ouvert)' : ''}
            </option>
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
      {(o.type === 'porte' || o.type === 'porte_entree' || o.type === 'porte_fenetre') && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={o.flip ?? false}
            onChange={(e) => updateOpening(roomId, o.id, { flip: e.target.checked })}
          />
          Sens d'ouverture inversé (R)
        </label>
      )}
      <button className="btn btn-block" onClick={() => select({ kind: 'room', id: roomId })}>← Retour à la pièce</button>
      <button className="btn btn-danger btn-block" onClick={() => removeOpening(roomId, o.id)}>Supprimer</button>
    </>
  );
}

function FurnitureProps({ id }: { id: string }) {
  const f = useStore((s) => s.project.furniture.find((x) => x.id === id));
  const project = useStore((s) => s.project);
  const updateFurniture = useStore((s) => s.updateFurniture);
  const removeFurniture = useStore((s) => s.removeFurniture);
  const duplicateFurniture = useStore((s) => s.duplicateFurniture);
  if (!f) return null;
  const isStairs = f.shape.startsWith('stairs_');
  const ownFloor = project.floors.find((fl) => fl.id === f.floorId);
  const upperFloor = ownFloor
    ? [...project.floors].sort((a, b) => a.level - b.level).find((fl) => fl.level === ownFloor.level + 1)
    : undefined;
  return (
    <>
      <h2>{isStairs ? 'Escalier' : 'Meuble'}</h2>
      {isStairs && (
        <p className="hint">
          {upperFloor
            ? `Relie « ${ownFloor?.name} » à « ${upperFloor.name} » : sa trémie d'arrivée apparaît en pointillés sur le plan de l'étage supérieur.`
            : "Aucun étage au-dessus : ajoutez un niveau (panneau Propriétés, sans sélection) pour que cet escalier le desserve."}
        </p>
      )}
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
      <label>
        Rotation — {Math.round(f.rotation)}°
        <div className="rotate-buttons">
          {[-90, -15, 15, 90].map((d) => (
            <button
              key={d}
              className="btn btn-sm"
              title={`Pivoter de ${Math.abs(d)}° ${d < 0 ? 'à gauche' : 'à droite'}`}
              onClick={() => updateFurniture(f.id, { rotation: (((f.rotation + d) % 360) + 360) % 360 })}
            >
              {d < 0 ? '⟲' : '⟳'} {Math.abs(d)}°
            </button>
          ))}
        </div>
      </label>
      <label>
        Couleur
        <input type="color" value={f.color} onChange={(e) => updateFurniture(f.id, { color: e.target.value })} />
      </label>
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

function FloorsManager() {
  const project = useStore((s) => s.project);
  const renameFloor = useStore((s) => s.renameFloor);
  const removeFloor = useStore((s) => s.removeFloor);
  const addFloor = useStore((s) => s.addFloor);
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  return (
    <>
      <h3>Niveaux</h3>
      {floors.map((f) => {
        const nbRooms = project.rooms.filter((r) => r.floorId === f.id).length;
        return (
          <div key={f.id} className="dims-row floor-row">
            <label>
              Niveau {f.level}
              <input value={f.name} onChange={(e) => renameFloor(f.id, e.target.value)} />
            </label>
            <button
              className="btn btn-sm btn-danger floor-delete"
              disabled={floors.length <= 1}
              title={nbRooms > 0 ? `Supprime le niveau et ses ${nbRooms} pièce(s)` : 'Supprimer ce niveau'}
              onClick={() => {
                if (nbRooms === 0 || confirm(`Supprimer « ${f.name} » et ses ${nbRooms} pièce(s) ?`)) removeFloor(f.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button className="btn btn-block" onClick={addFloor}>+ Ajouter un étage</button>
      <p className="hint">
        Les escaliers relient chaque niveau au suivant : leur trémie d'arrivée apparaît en pointillés
        sur le plan de l'étage supérieur.
      </p>
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
      {selection?.kind === 'wall' && <WallProps roomId={selection.roomId} index={selection.index} />}
      {selection?.kind === 'opening' && <OpeningProps roomId={selection.roomId} openingId={selection.id} />}
      {selection?.kind === 'roofWindow' && <RoofWindowProps roomId={selection.roomId} roofWindowId={selection.id} />}
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
            {project.floors.length} niveau(x) · {project.rooms.length} pièce(s) ·{' '}
            {project.furniture.length} meuble(s) ·{' '}
            {formatArea(project.rooms.reduce((acc, r) => acc + polygonArea(r.points), 0))} au total
          </p>
          <FloorsManager />
        </>
      )}
    </aside>
  );
}
