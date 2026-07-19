import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  EditorTool,
  ID,
  Opening,
  PlacedFurniture,
  Project,
  Room,
  RoomPhoto,
  ViewMode,
} from '../types';
import { uid } from '../types';

const DEFAULT_WALL = '#f4f1ea';

export function makeRoom(partial?: Partial<Room>): Room {
  return {
    id: uid(),
    name: 'Nouvelle pièce',
    type: 'autre',
    x: 0,
    y: 0,
    width: 4,
    length: 3,
    height: 2.5,
    wallColors: { N: DEFAULT_WALL, S: DEFAULT_WALL, E: DEFAULT_WALL, W: DEFAULT_WALL },
    floor: 'parquet_chene',
    openings: [],
    ...partial,
  };
}

function demoProject(): Project {
  const salon = makeRoom({
    name: 'Salon',
    type: 'salon',
    x: 0,
    y: 0,
    width: 5.2,
    length: 4.1,
    openings: [
      { id: uid(), type: 'porte_fenetre', wall: 'S', offset: 1.5, width: 2.2, height: 2.15, sillHeight: 0 },
      { id: uid(), type: 'porte', wall: 'E', offset: 1.2, width: 0.83, height: 2.04, sillHeight: 0 },
    ],
  });
  const cuisine = makeRoom({
    name: 'Cuisine',
    type: 'cuisine',
    x: 5.2,
    y: 0,
    width: 3.4,
    length: 4.1,
    floor: 'carrelage_gris',
    openings: [
      { id: uid(), type: 'fenetre', wall: 'N', offset: 1.1, width: 1.2, height: 1.25, sillHeight: 0.9 },
    ],
  });
  const chambre = makeRoom({
    name: 'Chambre',
    type: 'chambre',
    x: 0,
    y: 4.1,
    width: 3.6,
    length: 3.4,
    openings: [
      { id: uid(), type: 'fenetre', wall: 'S', offset: 1.2, width: 1.2, height: 1.25, sillHeight: 0.9 },
    ],
  });
  return {
    id: uid(),
    name: 'Ma maison',
    rooms: [salon, cuisine, chambre],
    furniture: [],
    photos: [],
    updatedAt: Date.now(),
  };
}

export type Selection =
  | { kind: 'room'; id: ID }
  | { kind: 'furniture'; id: ID }
  | { kind: 'opening'; roomId: ID; id: ID }
  | null;

interface AppState {
  project: Project;
  selection: Selection;
  tool: EditorTool;
  viewMode: ViewMode;
  /** Photo actuellement ouverte dans le Studio Photo. */
  activePhotoId: ID | null;
  snap: boolean;

  setViewMode: (m: ViewMode) => void;
  setTool: (t: EditorTool) => void;
  setSnap: (v: boolean) => void;
  select: (s: Selection) => void;
  renameProject: (name: string) => void;
  newProject: () => void;
  importProject: (p: Project) => void;

  addRoom: (partial?: Partial<Room>) => ID;
  updateRoom: (id: ID, patch: Partial<Room>) => void;
  removeRoom: (id: ID) => void;

  addOpening: (roomId: ID, opening: Omit<Opening, 'id'>) => void;
  updateOpening: (roomId: ID, id: ID, patch: Partial<Opening>) => void;
  removeOpening: (roomId: ID, id: ID) => void;

  addFurniture: (f: Omit<PlacedFurniture, 'id'>) => ID;
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

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      project: demoProject(),
      selection: null,
      tool: 'select',
      viewMode: 'plan',
      activePhotoId: null,
      snap: true,

      setViewMode: (viewMode) => set({ viewMode }),
      setTool: (tool) => set({ tool }),
      setSnap: (snap) => set({ snap }),
      select: (selection) => set({ selection }),
      renameProject: (name) => set({ project: touch({ ...get().project, name }) }),
      newProject: () => set({ project: demoProject(), selection: null, activePhotoId: null }),
      importProject: (p) => set({ project: touch(p), selection: null, activePhotoId: null }),

      addRoom: (partial) => {
        const room = makeRoom(partial);
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
            rooms: get().project.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
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

      addFurniture: (f) => {
        const id = uid();
        set({
          project: touch({
            ...get().project,
            furniture: [...get().project.furniture, { ...f, id }],
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
      partialize: (s) => ({ project: s.project }),
    }
  )
);
