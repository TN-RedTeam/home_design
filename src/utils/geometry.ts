import type { Opening, Room, WallSide } from '../types';

/** Pas d'accrochage par défaut (5 cm). */
export const SNAP_STEP = 0.05;

export function snapTo(value: number, enabled: boolean, step = SNAP_STEP): number {
  if (!enabled) return value;
  return Math.round(value / step) * step;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Longueur du mur porteur d'une ouverture. */
export function wallLength(room: Room, wall: WallSide): number {
  return wall === 'N' || wall === 'S' ? room.width : room.length;
}

/**
 * Segment (x1,y1)-(x2,y2) d'une ouverture dans le repère du plan (mètres),
 * le long du mur de sa pièce.
 */
export function openingSegment(room: Room, o: Opening): { x1: number; y1: number; x2: number; y2: number } {
  const off = clamp(o.offset, 0, Math.max(0, wallLength(room, o.wall) - o.width));
  switch (o.wall) {
    case 'N':
      return { x1: room.x + off, y1: room.y, x2: room.x + off + o.width, y2: room.y };
    case 'S':
      return { x1: room.x + off, y1: room.y + room.length, x2: room.x + off + o.width, y2: room.y + room.length };
    case 'W':
      return { x1: room.x, y1: room.y + off, x2: room.x, y2: room.y + off + o.width };
    case 'E':
      return { x1: room.x + room.width, y1: room.y + off, x2: room.x + room.width, y2: room.y + off + o.width };
  }
}

/** Boîte englobante de toutes les pièces, avec marge. */
export function planBounds(rooms: Room[], margin = 2): { minX: number; minY: number; maxX: number; maxY: number } {
  if (rooms.length === 0) return { minX: -margin, minY: -margin, maxX: 10 + margin, maxY: 8 + margin };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.length);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Rotation d'un point autour d'un centre, angle en degrés. */
export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}
