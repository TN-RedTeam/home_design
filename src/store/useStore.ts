import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  EditorTool,
  Floor,
  ID,
  Opening,
  PlacedFurniture,
  Project,
  RoofWindow,
  Room,
  RoomPhoto,
  RoomWall,
  Vec2,
  ViewMode,
} from '../types';
import { uid } from '../types';
import { clamp, dist, rectPoints, wallLength } from '../utils/geometry';

const DEFAULT_WALL = '#f4f1ea';

export function makeWalls(n: number, color = DEFAULT_WALL): RoomWall[] {
  return Array.from({ length: n }, () => ({ color, open: false }));
}

export function makeRoom(points: Vec2[], floorId: ID, partial?: Partial<Omit<Room, 'points'>>): Room {
  return {
    id: uid(),
    name: 'Nouvelle pièce',
    type: 'autre',
    floorId,
    height: 2.5,
    floor: 'parquet_chene',
    openings: [],
    roofWindows: [],
    ...partial,
    points,
    walls: partial?.walls && partial.walls.length === points.length ? partial.walls : makeWalls(points.length),
  };
}

/** Garantit walls.length === points.length et les champs récents (après édition ou import). */
function normalizeRoom(room: Room): Room {
  const withDefaults = { ...room, roofWindows: room.roofWindows ?? [] };
  if (withDefaults.walls.length === withDefaults.points.length) return withDefaults;
  const walls = withDefaults.points.map(
    (_, i) => withDefaults.walls[i] ?? withDefaults.walls[withDefaults.walls.length - 1] ?? { color: DEFAULT_WALL, open: false }
  );
  return { ...withDefaults, walls };
}

function demoProject(): Project {
  const rdc: Floor = { id: uid(), name: 'Rez-de-chaussée', level: 0 };
  const etage: Floor = { id: uid(), name: 'Étage 1', level: 1 };
  const salon = makeRoom(
    [
      { x: 0, y: 0 },
      { x: 5.2, y: 0 },
      { x: 5.2, y: 4.1 },
      { x: 3.2, y: 4.1 },
      { x: 3.2, y: 6.5 },
      { x: 0, y: 6.5 },
    ],
    rdc.id,
    {
      name: 'Salon-séjour',
      type: 'salon',
      walls: [
        { color: DEFAULT_WALL, open: false },
        { color: DEFAULT_WALL, open: true }, // ouvert sur la cuisine
        { color: DEFAULT_WALL, open: false },
        { color: DEFAULT_WALL, open: false },
        { color: DEFAULT_WALL, open: false },
        { color: DEFAULT_WALL, open: false },
      ],
      openings: [
        { id: uid(), type: 'double_fenetre', wall: 0, offset: 1.5, width: 1.6, height: 1.35, sillHeight: 0.9 },
        { id: uid(), type: 'porte_fenetre', wall: 4, offset: 0.5, width: 2.2, height: 2.15, sillHeight: 0 },
        { id: uid(), type: 'porte_entree', wall: 5, offset: 3.2, width: 0.9, height: 2.15, sillHeight: 0 },
      ],
    }
  );
  const cuisine = makeRoom(rectPoints(5.2, 0, 3.4, 4.1), rdc.id, {
    name: 'Cuisine ouverte',
    type: 'cuisine',
    floor: 'carrelage_gris',
    walls: [
      { color: DEFAULT_WALL, open: false },
      { color: DEFAULT_WALL, open: false },
      { color: DEFAULT_WALL, open: false },
      { color: DEFAULT_WALL, open: true }, // ouverte sur le salon
    ],
    openings: [
      { id: uid(), type: 'fenetre', wall: 0, offset: 1.1, width: 1.2, height: 1.25, sillHeight: 0.9 },
    ],
  });
  const chambre = makeRoom(rectPoints(3.2, 4.1, 3.6, 3.4), rdc.id, {
    name: 'Bureau',
    type: 'bureau',
    openings: [
      { id: uid(), type: 'porte', wall: 3, offset: 0.4, width: 0.83, height: 2.04, sillHeight: 0 },
      { id: uid(), type: 'fenetre', wall: 2, offset: 1.2, width: 1.2, height: 1.25, sillHeight: 0.9 },
    ],
  });
  const chambreEtage = makeRoom(rectPoints(0, 0, 5.2, 4.1), etage.id, {
    name: 'Chambre parentale',
    type: 'chambre',
    openings: [
      { id: uid(), type: 'fenetre', wall: 0, offset: 1.8, width: 1.2, height: 1.25, sillHeight: 0.9 },
    ],
    roofWindows: [{ id: uid(), x: 2.6, y: 3.2, width: 0.78, length: 0.98 }],
  });
  const escalier: PlacedFurniture = {
    id: uid(),
    catalogId: 'escalier-quart-tournant',
    floorId: rdc.id,
    name: 'Escalier 1/4 tournant',
    category: 'escalier',
    shape: 'stairs_quart',
    x: 1.05,
    y: 5.3,
    rotation: 0,
    width: 1.9,
    depth: 2.3,
    height: 2.7,
    color: '#a98a62',
    existing: false,
  };
  return {
    id: uid(),
    name: 'Ma maison',
    floors: [rdc, etage],
    rooms: [salon, cuisine, chambre, chambreEtage],
    furniture: [escalier],
    photos: [],
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Migration depuis l'ancien format (pièces rectangulaires x/y/width). */
/* ------------------------------------------------------------------ */

interface LegacyRoom {
  id: ID;
  name: string;
  type: Room['type'];
  x: number;
  y: number;
  width: number;
  length: number;
  height: number;
  wallColors: { N: string; S: string; E: string; W: string };
  floor: Room['floor'];
  openings: (Omit<Opening, 'wall'> & { wall: 'N' | 'S' | 'E' | 'W' })[];
}

function isLegacyRoom(r: unknown): r is LegacyRoom {
  return typeof r === 'object' && r !== null && 'wallColors' in r && !('points' in r);
}

/** Rect ancien format -> polygone horaire : mur 0 = N, 1 = E, 2 = S, 3 = W. */
function migrateLegacyRoom(r: LegacyRoom): Room {
  const points = rectPoints(r.x, r.y, r.width, r.length);
  const walls: RoomWall[] = [
    { color: r.wallColors.N, open: false },
    { color: r.wallColors.E, open: false },
    { color: r.wallColors.S, open: false },
    { color: r.wallColors.W, open: false },
  ];
  const openings: Opening[] = r.openings.map((o) => {
    // Les murs S et W étaient mesurés depuis la gauche / le haut ; le polygone
    // horaire parcourt S de droite à gauche et W de bas en haut.
    switch (o.wall) {
      case 'N': return { ...o, wall: 0 };
      case 'E': return { ...o, wall: 1 };
      case 'S': return { ...o, wall: 2, offset: Math.max(0, r.width - o.offset - o.width) };
      case 'W': return { ...o, wall: 3, offset: Math.max(0, r.length - o.offset - o.width) };
    }
  });
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    floorId: '',
    points,
    walls,
    height: r.height,
    floor: r.floor,
    openings,
    roofWindows: [],
  };
}

/** Convertit un projet potentiellement ancien vers le format courant. */
export function migrateProject(p: Project): Project {
  const floors: Floor[] =
    p.floors && p.floors.length > 0
      ? [...p.floors].sort((a, b) => a.level - b.level)
      : [{ id: uid(), name: 'Rez-de-chaussée', level: 0 }];
  const defaultFloorId = floors[0].id;
  const validFloor = (id: string | undefined) =>
    id && floors.some((f) => f.id === id) ? id : defaultFloorId;
  return {
    ...p,
    floors,
    rooms: p.rooms.map((r) => {
      const room = normalizeRoom(isLegacyRoom(r) ? migrateLegacyRoom(r) : r);
      return { ...room, floorId: validFloor(room.floorId) };
    }),
    furniture: (p.furniture ?? []).map((f) => ({ ...f, floorId: validFloor(f.floorId) })),
    photos: (p.photos ?? []).map((ph) => ({ ...ph, overlays: ph.overlays ?? [] })),
  };
}

export type Selection =
  | { kind: 'room'; id: ID }
  | { kind: 'furniture'; id: ID }
  | { kind: 'opening'; roomId: ID; id: ID }
  | { kind: 'roofWindow'; roomId: ID; id: ID }
  | null;

/** Meuble « accroché au curseur » en attente de pose (mode construction). */
export interface PlacementItem {
  catalogId?: ID;
  name: string;
  category: PlacedFurniture['category'];
  shape: PlacedFurniture['shape'];
  width: number;
  depth: number;
  height: number;
  color: string;
  photoUrl?: string;
  existing: boolean;
}

export type WallsMode = 'auto' | 'up' | 'down';

interface AppState {
  project: Project;
  selection: Selection;
  tool: EditorTool;
  viewMode: ViewMode;
  /** Photo actuellement ouverte dans le Studio Photo. */
  activePhotoId: ID | null;
  snap: boolean;
  /** Niveau actif dans l'éditeur (repli sur le premier niveau si absent). */
  activeFloorId: ID | null;
  /** Vue 3D : tous les niveaux empilés ou seulement le niveau actif. */
  show3DAllFloors: boolean;
  /** Meuble en cours de pose au curseur (2D et 3D), avec sa rotation. */
  placement: PlacementItem | null;
  placementRotation: number;
  /** Affichage des murs en 3D : effacement auto côté caméra, hauts, ou muret. */
  wallsMode: WallsMode;

  setViewMode: (m: ViewMode) => void;
  setTool: (t: EditorTool) => void;
  setSnap: (v: boolean) => void;
  select: (s: Selection) => void;
  renameProject: (name: string) => void;
  newProject: () => void;
  importProject: (p: Project) => void;

  setActiveFloor: (id: ID) => void;
  setShow3DAllFloors: (v: boolean) => void;
  setPlacement: (item: PlacementItem | null) => void;
  rotatePlacement: (deltaDeg: number) => void;
  setWallsMode: (m: WallsMode) => void;
  /** Pose le meuble accroché au curseur à la position donnée (repère du plan). */
  dropPlacement: (x: number, y: number) => void;
  addFloor: () => void;
  renameFloor: (id: ID, name: string) => void;
  /** Supprime un niveau et tout son contenu (interdit s'il n'en reste qu'un). */
  removeFloor: (id: ID) => void;

  addRoom: (points: Vec2[], partial?: Partial<Omit<Room, 'points'>>) => ID;
  updateRoom: (id: ID, patch: Partial<Room>) => void;
  removeRoom: (id: ID) => void;
  updateWall: (roomId: ID, wall: number, patch: Partial<RoomWall>) => void;
  /** Insère un sommet au milieu du mur `wall` (le mur est scindé en deux). */
  insertVertex: (roomId: ID, wall: number) => void;
  /** Supprime le sommet `vertex` (fusionne les deux murs adjacents). */
  removeVertex: (roomId: ID, vertex: number) => void;

  addOpening: (roomId: ID, opening: Omit<Opening, 'id'>) => void;
  updateOpening: (roomId: ID, id: ID, patch: Partial<Opening>) => void;
  removeOpening: (roomId: ID, id: ID) => void;

  addRoofWindow: (roomId: ID, rw: Omit<RoofWindow, 'id'>) => void;
  updateRoofWindow: (roomId: ID, id: ID, patch: Partial<RoofWindow>) => void;
  removeRoofWindow: (roomId: ID, id: ID) => void;

  addFurniture: (f: Omit<PlacedFurniture, 'id' | 'floorId'>) => ID;
  updateFurniture: (id: ID, patch: Partial<PlacedFurniture>) => void;
  removeFurniture: (id: ID) => void;
  duplicateFurniture: (id: ID) => void;

  addPhoto: (p: Omit<RoomPhoto, 'id' | 'createdAt'>) => ID;
  updatePhoto: (id: ID, patch: Partial<RoomPhoto>) => void;
  removePhoto: (id: ID) => void;
  setActivePhoto: (id: ID | null) => void;
}

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

/** Niveau actif effectif d'un état (repli sur le premier niveau du projet). */
export function resolveActiveFloor(project: Project, activeFloorId: ID | null): Floor {
  const sorted = [...project.floors].sort((a, b) => a.level - b.level);
  return sorted.find((f) => f.id === activeFloorId) ?? sorted[0];
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      project: demoProject(),
      selection: null,
      tool: 'select',
      viewMode: 'plan',
      activePhotoId: null,
      snap: true,
      activeFloorId: null,
      show3DAllFloors: true,
      placement: null,
      placementRotation: 0,
      wallsMode: 'auto',

      setPlacement: (placement) => set({ placement, placementRotation: 0, selection: null }),
      rotatePlacement: (deltaDeg) =>
        set({ placementRotation: (((get().placementRotation + deltaDeg) % 360) + 360) % 360 }),
      setWallsMode: (wallsMode) => set({ wallsMode }),
      dropPlacement: (x, y) => {
        const { placement, placementRotation } = get();
        if (!placement) return;
        get().addFurniture({ ...placement, x, y, rotation: placementRotation });
        set({ placement: null });
      },

      setViewMode: (viewMode) => set({ viewMode }),
      setTool: (tool) => set({ tool }),
      setSnap: (snap) => set({ snap }),
      select: (selection) => set({ selection }),
      renameProject: (name) => set({ project: touch({ ...get().project, name }) }),
      newProject: () => set({ project: demoProject(), selection: null, activePhotoId: null, activeFloorId: null }),
      importProject: (p) =>
        set({ project: touch(migrateProject(p)), selection: null, activePhotoId: null, activeFloorId: null }),

      setActiveFloor: (activeFloorId) => set({ activeFloorId, selection: null }),
      setShow3DAllFloors: (show3DAllFloors) => set({ show3DAllFloors }),
      addFloor: () => {
        const { project } = get();
        const level = Math.max(...project.floors.map((f) => f.level)) + 1;
        const floor: Floor = { id: uid(), name: `Étage ${level}`, level };
        set({
          project: touch({ ...project, floors: [...project.floors, floor] }),
          activeFloorId: floor.id,
          selection: null,
        });
      },
      renameFloor: (id, name) =>
        set({
          project: touch({
            ...get().project,
            floors: get().project.floors.map((f) => (f.id === id ? { ...f, name } : f)),
          }),
        }),
      removeFloor: (id) => {
        const { project, activeFloorId } = get();
        if (project.floors.length <= 1) return;
        const floors = project.floors.filter((f) => f.id !== id);
        set({
          project: touch({
            ...project,
            floors,
            rooms: project.rooms.filter((r) => r.floorId !== id),
            furniture: project.furniture.filter((f) => f.floorId !== id),
          }),
          activeFloorId: activeFloorId === id ? null : activeFloorId,
          selection: null,
        });
      },

      addRoom: (points, partial) => {
        const floorId = resolveActiveFloor(get().project, get().activeFloorId).id;
        const room = makeRoom(points, floorId, partial);
        set({
          project: touch({ ...get().project, rooms: [...get().project.rooms, room] }),
          selection: { kind: 'room', id: room.id },
        });
        return room.id;
      },
      updateRoom: (id, patch) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) => (r.id === id ? normalizeRoom({ ...r, ...patch }) : r)),
          }),
        }),
      removeRoom: (id) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.filter((r) => r.id !== id),
          }),
          selection: null,
        }),
      updateWall: (roomId, wall, patch) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId
                ? { ...r, walls: r.walls.map((w, i) => (i === wall ? { ...w, ...patch } : w)) }
                : r
            ),
          }),
        }),

      insertVertex: (roomId, wall) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) => {
              if (r.id !== roomId) return r;
              const n = r.points.length;
              const a = r.points[wall % n];
              const b = r.points[(wall + 1) % n];
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const half = dist(a, b) / 2;
              const points = [...r.points];
              points.splice(wall + 1, 0, mid);
              const walls = [...r.walls];
              walls.splice(wall + 1, 0, { ...r.walls[wall] });
              const openings = r.openings.flatMap<Opening>((o) => {
                if (o.wall > wall) return [{ ...o, wall: o.wall + 1 }];
                if (o.wall !== wall) return [o];
                // Ouverture sur le mur scindé : elle rejoint la moitié où elle commence.
                if (o.offset >= half) return [{ ...o, wall: wall + 1, offset: o.offset - half }];
                return [{ ...o, offset: Math.min(o.offset, Math.max(0, half - o.width)) }];
              });
              return { ...r, points, walls, openings };
            }),
          }),
        }),

      removeVertex: (roomId, vertex) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) => {
              if (r.id !== roomId || r.points.length <= 3) return r;
              const n = r.points.length;
              const prev = (vertex - 1 + n) % n;
              const prevLen = wallLength(r, prev);
              const points = r.points.filter((_, i) => i !== vertex);
              const walls = r.walls.filter((_, i) => i !== vertex);
              const merged = { ...r, points, walls };
              const openings = r.openings.flatMap<Opening>((o) => {
                let next: Opening;
                if (o.wall === vertex) next = { ...o, wall: prev, offset: o.offset + prevLen };
                else if (o.wall > vertex) next = { ...o, wall: o.wall - 1 };
                else next = { ...o };
                if (next.wall === prev || (vertex === 0 && next.wall === points.length - 1)) {
                  const len = wallLength(merged, next.wall);
                  if (len < next.width) return [];
                  next.offset = clamp(next.offset, 0, len - next.width);
                }
                return [next];
              });
              return { ...merged, openings };
            }),
          }),
          selection: { kind: 'room', id: roomId },
        }),

      addOpening: (roomId, opening) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId ? { ...r, openings: [...r.openings, { ...opening, id: uid() }] } : r
            ),
          }),
        }),
      updateOpening: (roomId, id, patch) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId
                ? { ...r, openings: r.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
                : r
            ),
          }),
        }),
      removeOpening: (roomId, id) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId ? { ...r, openings: r.openings.filter((o) => o.id !== id) } : r
            ),
          }),
          selection: null,
        }),

      addRoofWindow: (roomId, rw) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId ? { ...r, roofWindows: [...r.roofWindows, { ...rw, id: uid() }] } : r
            ),
          }),
        }),
      updateRoofWindow: (roomId, id, patch) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId
                ? { ...r, roofWindows: r.roofWindows.map((w) => (w.id === id ? { ...w, ...patch } : w)) }
                : r
            ),
          }),
        }),
      removeRoofWindow: (roomId, id) =>
        set({
          project: touch({
            ...get().project,
            rooms: get().project.rooms.map((r) =>
              r.id === roomId ? { ...r, roofWindows: r.roofWindows.filter((w) => w.id !== id) } : r
            ),
          }),
          selection: null,
        }),

      addFurniture: (f) => {
        const id = uid();
        const floorId = resolveActiveFloor(get().project, get().activeFloorId).id;
        set({
          project: touch({
            ...get().project,
            furniture: [...get().project.furniture, { ...f, id, floorId }],
          }),
          selection: { kind: 'furniture', id },
        });
        return id;
      },
      updateFurniture: (id, patch) =>
        set({
          project: touch({
            ...get().project,
            furniture: get().project.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          }),
        }),
      removeFurniture: (id) =>
        set({
          project: touch({
            ...get().project,
            furniture: get().project.furniture.filter((f) => f.id !== id),
          }),
          selection: null,
        }),
      duplicateFurniture: (id) => {
        const src = get().project.furniture.find((f) => f.id === id);
        if (!src) return;
        const copy = { ...src, id: uid(), x: src.x + 0.4, y: src.y + 0.4 };
        set({
          project: touch({ ...get().project, furniture: [...get().project.furniture, copy] }),
          selection: { kind: 'furniture', id: copy.id },
        });
      },

      addPhoto: (p) => {
        const id = uid();
        set({
          project: touch({
            ...get().project,
            photos: [...get().project.photos, { ...p, id, createdAt: Date.now() }],
          }),
          activePhotoId: id,
        });
        return id;
      },
      updatePhoto: (id, patch) =>
        set({
          project: touch({
            ...get().project,
            photos: get().project.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          }),
        }),
      removePhoto: (id) =>
        set({
          project: touch({
            ...get().project,
            photos: get().project.photos.filter((p) => p.id !== id),
          }),
          activePhotoId: get().activePhotoId === id ? null : get().activePhotoId,
        }),
      setActivePhoto: (activePhotoId) => set({ activePhotoId }),
    }),
    {
      name: 'home-design-project',
      version: 3,
      partialize: (s) => ({ project: s.project }),
      migrate: (persisted) => {
        const state = persisted as { project?: Project };
        if (state?.project) return { project: migrateProject(state.project) };
        return state as { project: Project };
      },
    }
  )
);

/* ------------------------------------------------------------------ */
/* Historique annuler / refaire.                                       */
/* Instantanés du projet (partage structurel : peu coûteux en mémoire).*/
/* Les modifications rapprochées (< 600 ms) sont fusionnées : un       */
/* glissement de meuble ne crée qu'une seule étape d'annulation.       */
/* ------------------------------------------------------------------ */

const past: Project[] = [];
const future: Project[] = [];
let lastPush = 0;
let timeTravel = false;

useStore.subscribe((state, prev) => {
  if (timeTravel || state.project === prev.project) return;
  if (state.project.id !== prev.project.id) {
    // Nouveau projet ou import : l'historique repart de zéro.
    past.length = 0;
    future.length = 0;
    return;
  }
  const now = Date.now();
  if (now - lastPush > 600) {
    past.push(prev.project);
    if (past.length > 80) past.shift();
    future.length = 0;
  }
  lastPush = now;
});

export function undoProject(): void {
  const prev = past.pop();
  if (!prev) return;
  timeTravel = true;
  future.push(useStore.getState().project);
  useStore.setState({ project: prev, selection: null });
  timeTravel = false;
  lastPush = 0;
}

export function redoProject(): void {
  const next = future.pop();
  if (!next) return;
  timeTravel = true;
  past.push(useStore.getState().project);
  useStore.setState({ project: next, selection: null });
  timeTravel = false;
  lastPush = 0;
}
