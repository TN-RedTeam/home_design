import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { ID, PhotoOverlay, PhotoPaintStroke, RoomPhoto, Vec2 } from '../../types';
import { uid } from '../../types';
import { PAINT_PALETTES } from '../../data/palettes';
import { drawImageInQuad, pointInQuad } from '../../utils/homography';
import { removeBackground } from '../../utils/cutout';
import './photoStudio.css';

/** Largeur maximale (px) des photos stockées, pour limiter le poids localStorage. */
const MAX_STORED_WIDTH = 1600;
/** Largeur maximale (px) des visuels d'objets importés (produits web). */
const MAX_OBJECT_WIDTH = 800;
const DEFAULT_PAINT_COLOR = '#e7ddce';
const DEFAULT_PAINT_OPACITY = 0.85;
const MIN_BRUSH_PERCENT = 1;
const MAX_BRUSH_PERCENT = 20;
/** Rayon (px écran) de détection des poignées de coin en mode Objets. */
const HANDLE_HIT_RADIUS = 12;
/** Débordement autorisé hors du cadre [0..1] pour les coins d'un objet. */
const QUAD_SOFT_MIN = -0.2;
const QUAD_SOFT_MAX = 1.2;

type StudioMode = 'paint' | 'objects';
type BrushTool = 'brush' | 'erase';

interface CursorPreview {
  x: number;
  y: number;
  size: number;
}

type ObjectDragState =
  | { type: 'move'; overlayId: ID; startNormalized: Vec2; startQuad: [Vec2, Vec2, Vec2, Vec2] }
  | { type: 'corner'; overlayId: ID; cornerIndex: 0 | 1 | 2 | 3 };

/** Lit un fichier image, le redimensionne (canvas) à `maxWidth` px max, et renvoie un dataURL JPEG compressé. */
function readAndResizeImage(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image invalide'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Contexte canvas indisponible'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}

/** Dessine un tracé (pinceau ou gomme) sur le canvas de masque, en coordonnées normalisées [0..1]. */
function drawStrokeToMask(ctx: CanvasRenderingContext2D, stroke: PhotoPaintStroke): void {
  if (stroke.points.length === 0) return;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const [first, ...rest] = stroke.points;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, stroke.radius * 2 * width);
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);
  if (rest.length === 0) {
    // Point isolé (clic sans glisser) : un trait de longueur nulle avec un cap rond dessine un disque.
    ctx.lineTo(first.x * width, first.y * height);
  } else {
    for (const p of rest) ctx.lineTo(p.x * width, p.y * height);
  }
  ctx.stroke();
  ctx.restore();
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampQuadCoord(v: number): number {
  return Math.min(QUAD_SOFT_MAX, Math.max(QUAD_SOFT_MIN, v));
}

function cloneQuad(quad: [Vec2, Vec2, Vec2, Vec2]): [Vec2, Vec2, Vec2, Vec2] {
  return [{ ...quad[0] }, { ...quad[1] }, { ...quad[2] }, { ...quad[3] }];
}

export default function PhotoStudio() {
  const project = useStore((s) => s.project);
  const activePhotoId = useStore((s) => s.activePhotoId);
  const addPhoto = useStore((s) => s.addPhoto);
  const updatePhoto = useStore((s) => s.updatePhoto);
  const removePhoto = useStore((s) => s.removePhoto);
  const setActivePhoto = useStore((s) => s.setActivePhoto);

  const photos = project.photos;
  const rooms = project.rooms;
  const activePhoto = photos.find((p) => p.id === activePhotoId) ?? null;
  const overlays = activePhoto?.overlays ?? [];
  const furnitureWithPhoto = project.furniture.filter((f) => f.photoUrl);

  const [mode, setMode] = useState<StudioMode>('paint');
  const [tool, setTool] = useState<BrushTool>('brush');
  const [brushPercent, setBrushPercent] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPreview, setCursorPreview] = useState<CursorPreview | null>(null);
  const [importError, setImportError] = useState('');
  const [selectedOverlayId, setSelectedOverlayId] = useState<ID | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [autoCutout, setAutoCutout] = useState(true);
  const [addCutoutError, setAddCutoutError] = useState('');
  /** Images d'origine (avant détourage) des objets détourés durant cette session, pour permettre l'annulation. */
  const [cutoutOriginals, setCutoutOriginals] = useState<Map<ID, string>>(new Map());
  const [cutoutBusyId, setCutoutBusyId] = useState<ID | null>(null);
  const [cutoutError, setCutoutError] = useState('');
  const cutoutErrorTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectFileInputRef = useRef<HTMLInputElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftStrokeRef = useRef<PhotoPaintStroke | null>(null);

  const activePhotoRef = useRef<RoomPhoto | null>(null);
  const modeRef = useRef<StudioMode>('paint');
  const selectedOverlayIdRef = useRef<ID | null>(null);
  const overlayImagesRef = useRef<Map<ID, HTMLImageElement>>(new Map());
  const overlayImageUrlRef = useRef<Map<ID, string>>(new Map());
  const overlaysOverrideRef = useRef<PhotoOverlay[] | null>(null);
  const objectDragRef = useRef<ObjectDragState | null>(null);

  useEffect(() => {
    activePhotoRef.current = activePhoto;
  }, [activePhoto]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    selectedOverlayIdRef.current = selectedOverlayId;
  }, [selectedOverlayId]);

  /** Recompose la photo + le calque de peinture (masqué) + les traits en cours + les objets incrustés. */
  const redraw = useCallback((photo: RoomPhoto | null, opts?: { forExport?: boolean }) => {
    const display = displayCanvasRef.current;
    if (!display) return;
    const dispCtx = display.getContext('2d');
    if (!dispCtx) return;

    const img = imgRef.current;
    if (!photo || !img || img.naturalWidth === 0) {
      dispCtx.clearRect(0, 0, display.width, display.height);
      return;
    }

    const width = img.naturalWidth;
    const height = img.naturalHeight;

    if (display.width !== width || display.height !== height) {
      display.width = width;
      display.height = height;
    }

    let mask = maskCanvasRef.current;
    if (!mask) {
      mask = document.createElement('canvas');
      maskCanvasRef.current = mask;
    }
    if (mask.width !== width || mask.height !== height) {
      mask.width = width;
      mask.height = height;
    }
    const maskCtx = mask.getContext('2d');

    let paintLayer = paintCanvasRef.current;
    if (!paintLayer) {
      paintLayer = document.createElement('canvas');
      paintCanvasRef.current = paintLayer;
    }
    if (paintLayer.width !== width || paintLayer.height !== height) {
      paintLayer.width = width;
      paintLayer.height = height;
    }
    const paintCtx = paintLayer.getContext('2d');

    if (!maskCtx || !paintCtx) return;

    // 1. Masque : traits blancs (pinceau) / trous (gomme via destination-out).
    maskCtx.clearRect(0, 0, width, height);
    maskCtx.globalCompositeOperation = 'source-over';
    const strokes = draftStrokeRef.current ? [...photo.strokes, draftStrokeRef.current] : photo.strokes;
    for (const stroke of strokes) drawStrokeToMask(maskCtx, stroke);

    // 2. Calque couleur réaliste : teinte+saturation ('color') qui garde la luminosité du mur
    //    (donc ombres et texture visibles), plus un léger 'multiply' pour l'assombrissement,
    //    le tout découpé par le masque via 'destination-in'.
    paintCtx.clearRect(0, 0, width, height);
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.globalAlpha = 1;
    paintCtx.drawImage(img, 0, 0, width, height);
    paintCtx.globalCompositeOperation = 'color';
    paintCtx.fillStyle = photo.paintColor;
    paintCtx.fillRect(0, 0, width, height);
    paintCtx.globalCompositeOperation = 'multiply';
    paintCtx.globalAlpha = 0.25;
    paintCtx.fillRect(0, 0, width, height);
    paintCtx.globalAlpha = 1;
    paintCtx.globalCompositeOperation = 'destination-in';
    paintCtx.drawImage(mask, 0, 0);
    paintCtx.globalCompositeOperation = 'source-over';

    // 3. Composition finale : photo d'origine + calque peinture mélangé selon l'intensité choisie.
    dispCtx.clearRect(0, 0, width, height);
    dispCtx.globalAlpha = 1;
    dispCtx.globalCompositeOperation = 'source-over';
    dispCtx.drawImage(img, 0, 0, width, height);
    dispCtx.globalAlpha = clamp01(photo.paintOpacity);
    dispCtx.drawImage(paintLayer, 0, 0);
    dispCtx.globalAlpha = 1;
    dispCtx.globalCompositeOperation = 'source-over';

    // 4. Objets incrustés en perspective, du fond vers le premier plan.
    const activeOverlays = overlaysOverrideRef.current ?? (photo.overlays ?? []);
    for (const overlay of activeOverlays) {
      const overlayImg = overlayImagesRef.current.get(overlay.id);
      if (!overlayImg || overlayImg.naturalWidth === 0) continue;
      const quadPx: [Vec2, Vec2, Vec2, Vec2] = [
        { x: overlay.quad[0].x * width, y: overlay.quad[0].y * height },
        { x: overlay.quad[1].x * width, y: overlay.quad[1].y * height },
        { x: overlay.quad[2].x * width, y: overlay.quad[2].y * height },
        { x: overlay.quad[3].x * width, y: overlay.quad[3].y * height },
      ];
      dispCtx.save();
      dispCtx.globalAlpha = clamp01(overlay.opacity);
      dispCtx.globalCompositeOperation = overlay.blend === 'multiply' ? 'multiply' : 'source-over';
      drawImageInQuad(dispCtx, overlayImg, quadPx);
      dispCtx.restore();
    }

    // 5. Décorations de sélection (mode Objets uniquement) — jamais dans l'export téléchargé.
    if (!opts?.forExport && modeRef.current === 'objects' && selectedOverlayIdRef.current) {
      const selected = activeOverlays.find((o) => o.id === selectedOverlayIdRef.current);
      if (selected) {
        const quadPx: [Vec2, Vec2, Vec2, Vec2] = [
          { x: selected.quad[0].x * width, y: selected.quad[0].y * height },
          { x: selected.quad[1].x * width, y: selected.quad[1].y * height },
          { x: selected.quad[2].x * width, y: selected.quad[2].y * height },
          { x: selected.quad[3].x * width, y: selected.quad[3].y * height },
        ];
        dispCtx.save();
        dispCtx.setLineDash([8, 6]);
        dispCtx.strokeStyle = '#d4a373';
        dispCtx.lineWidth = 1.5;
        dispCtx.beginPath();
        quadPx.forEach((p, i) => (i === 0 ? dispCtx.moveTo(p.x, p.y) : dispCtx.lineTo(p.x, p.y)));
        dispCtx.closePath();
        dispCtx.stroke();
        dispCtx.setLineDash([]);
        for (const p of quadPx) {
          dispCtx.beginPath();
          dispCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          dispCtx.fillStyle = '#26282e';
          dispCtx.fill();
          dispCtx.lineWidth = 2;
          dispCtx.strokeStyle = '#d4a373';
          dispCtx.stroke();
        }
        dispCtx.restore();
      }
    }
  }, []);

  // Charge l'image de la photo active dans un <img> hors-DOM pour pouvoir la redessiner sur le canvas.
  useEffect(() => {
    if (!activePhoto) {
      imgRef.current = null;
      redraw(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      redraw(activePhoto);
    };
    img.src = activePhoto.dataUrl;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhoto?.id, activePhoto?.dataUrl]);

  // Précharge / met en cache les images des objets incrustés ; redessine quand l'une d'elles finit de charger.
  useEffect(() => {
    const cache = overlayImagesRef.current;
    const urlCache = overlayImageUrlRef.current;
    const ids = new Set(overlays.map((o) => o.id));
    for (const id of Array.from(cache.keys())) {
      if (!ids.has(id)) {
        cache.delete(id);
        urlCache.delete(id);
      }
    }
    for (const overlay of overlays) {
      if (urlCache.get(overlay.id) === overlay.imageUrl) continue;
      const img = new Image();
      img.onload = () => {
        redraw(activePhotoRef.current);
      };
      img.src = overlay.imageUrl;
      cache.set(overlay.id, img);
      urlCache.set(overlay.id, overlay.imageUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, redraw]);

  // Redessine dès que la couleur, l'intensité, les tracés, le mode ou la sélection changent.
  useEffect(() => {
    redraw(activePhoto);
  }, [activePhoto, mode, selectedOverlayId, redraw]);

  // Sélectionne automatiquement une photo si aucune n'est active mais qu'il en existe.
  useEffect(() => {
    if (!activePhotoId && photos.length > 0) {
      setActivePhoto(photos[0].id);
    }
  }, [activePhotoId, photos, setActivePhoto]);

  // Réinitialise la sélection d'objet et l'état de détourage en changeant de photo.
  useEffect(() => {
    setSelectedOverlayId(null);
    setShowAddPanel(false);
    setCutoutOriginals(new Map());
    setCutoutBusyId(null);
    setCutoutError('');
    setAddCutoutError('');
  }, [activePhotoId]);

  // Nettoie le minuteur d'effacement du message d'erreur de détourage au démontage.
  useEffect(() => {
    return () => {
      if (cutoutErrorTimerRef.current !== null) window.clearTimeout(cutoutErrorTimerRef.current);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    readAndResizeImage(file, MAX_STORED_WIDTH)
      .then((dataUrl) => {
        addPhoto({
          name: file.name.replace(/\.[^.]+$/, '') || 'Photo',
          dataUrl,
          paintColor: DEFAULT_PAINT_COLOR,
          paintOpacity: DEFAULT_PAINT_OPACITY,
          strokes: [],
          overlays: [],
        });
      })
      .catch(() => setImportError("Impossible de lire cette image. Essayez un autre fichier (JPG ou PNG)."));
  };

  const handleDeletePhoto = (id: ID) => {
    if (window.confirm('Supprimer cette photo et ses retouches ?')) {
      removePhoto(id);
    }
  };

  const handleClearStrokes = () => {
    if (!activePhoto) return;
    updatePhoto(activePhoto.id, { strokes: [] });
  };

  const handleDownload = () => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !activePhoto) return;
    redraw(activePhoto, { forExport: true });
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activePhoto.name || 'rendu'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    redraw(activePhoto);
  };

  /** Position du pointeur relative au canvas : coordonnées normalisées (stockage, clampées 0..1) + pixels écran. */
  const pointerData = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const normalized = { x: clamp01(px.x / rect.width), y: clamp01(px.y / rect.height) };
    return { normalized, px, displayWidth: rect.width, displayHeight: rect.height };
  };

  /** Comme `pointerData` mais sans clamp — nécessaire pour laisser un objet déborder du cadre. */
  const pointerDataRaw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const normalized = { x: px.x / rect.width, y: px.y / rect.height };
    return { normalized, px, displayWidth: rect.width, displayHeight: rect.height };
  };

  // ---------- Mode Peinture ----------

  const handlePaintPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePhoto) return;
    const data = pointerData(e);
    if (!data) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draftStrokeRef.current = {
      points: [data.normalized],
      radius: brushPercent / 100,
      erase: tool === 'erase',
    };
    setIsDrawing(true);
    setCursorPreview({ x: data.px.x, y: data.px.y, size: (brushPercent / 100) * data.displayWidth * 2 });
    redraw(activePhoto);
  };

  const handlePaintPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const data = pointerData(e);
    if (!data) return;
    setCursorPreview({ x: data.px.x, y: data.px.y, size: (brushPercent / 100) * data.displayWidth * 2 });
    if (!activePhoto || !draftStrokeRef.current) return;
    draftStrokeRef.current.points.push(data.normalized);
    redraw(activePhoto);
  };

  const handlePaintPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDrawing(false);
    const stroke = draftStrokeRef.current;
    draftStrokeRef.current = null;
    if (activePhoto && stroke && stroke.points.length > 0) {
      updatePhoto(activePhoto.id, { strokes: [...activePhoto.strokes, stroke] });
    } else if (activePhoto) {
      redraw(activePhoto);
    }
  };

  // ---------- Mode Objets ----------

  const handleObjectPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePhoto) return;
    const data = pointerDataRaw(e);
    if (!data) return;

    // 1. Poignées de coin de l'objet actuellement sélectionné.
    const selected = overlays.find((o) => o.id === selectedOverlayId);
    if (selected) {
      for (let i = 0; i < 4; i++) {
        const corner = selected.quad[i];
        const cx = corner.x * data.displayWidth;
        const cy = corner.y * data.displayHeight;
        const distance = Math.hypot(data.px.x - cx, data.px.y - cy);
        if (distance < HANDLE_HIT_RADIUS) {
          e.currentTarget.setPointerCapture(e.pointerId);
          overlaysOverrideRef.current = overlays.map((o) => ({ ...o, quad: cloneQuad(o.quad) }));
          objectDragRef.current = { type: 'corner', overlayId: selected.id, cornerIndex: i as 0 | 1 | 2 | 3 };
          redraw(activePhoto);
          return;
        }
      }
    }

    // 2. Sélection / translation : de l'objet le plus au premier plan vers le fond.
    for (let i = overlays.length - 1; i >= 0; i--) {
      if (pointInQuad(data.normalized, overlays[i].quad)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setSelectedOverlayId(overlays[i].id);
        overlaysOverrideRef.current = overlays.map((o) => ({ ...o, quad: cloneQuad(o.quad) }));
        objectDragRef.current = {
          type: 'move',
          overlayId: overlays[i].id,
          startNormalized: data.normalized,
          startQuad: cloneQuad(overlays[i].quad),
        };
        redraw(activePhoto);
        return;
      }
    }

    // 3. Rien sous le pointeur : désélectionne.
    setSelectedOverlayId(null);
    redraw(activePhoto);
  };

  const handleObjectPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = objectDragRef.current;
    if (!activePhoto || !drag || !overlaysOverrideRef.current) return;
    const data = pointerDataRaw(e);
    if (!data) return;

    const overlaysDraft = overlaysOverrideRef.current;
    const idx = overlaysDraft.findIndex((o) => o.id === drag.overlayId);
    if (idx === -1) return;

    if (drag.type === 'corner') {
      const nextQuad = cloneQuad(overlaysDraft[idx].quad);
      nextQuad[drag.cornerIndex] = {
        x: clampQuadCoord(data.normalized.x),
        y: clampQuadCoord(data.normalized.y),
      };
      overlaysDraft[idx] = { ...overlaysDraft[idx], quad: nextQuad };
    } else {
      const dx = data.normalized.x - drag.startNormalized.x;
      const dy = data.normalized.y - drag.startNormalized.y;
      const nextQuad = drag.startQuad.map((p) => ({
        x: clampQuadCoord(p.x + dx),
        y: clampQuadCoord(p.y + dy),
      })) as [Vec2, Vec2, Vec2, Vec2];
      overlaysDraft[idx] = { ...overlaysDraft[idx], quad: nextQuad };
    }
    redraw(activePhoto);
  };

  const handleObjectPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const override = overlaysOverrideRef.current;
    objectDragRef.current = null;
    overlaysOverrideRef.current = null;
    if (activePhoto && override) {
      updatePhoto(activePhoto.id, { overlays: override });
    } else if (activePhoto) {
      redraw(activePhoto);
    }
  };

  // ---------- Dispatch des pointer events selon le mode actif ----------

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'paint') handlePaintPointerDown(e);
    else handleObjectPointerDown(e);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'paint') handlePaintPointerMove(e);
    else handleObjectPointerMove(e);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'paint') handlePaintPointerUp(e);
    else handleObjectPointerUp(e);
  };
  const handlePointerLeave = () => {
    setCursorPreview(null);
  };

  // ---------- Gestion des objets incrustés (panneau de contrôle) ----------

  /** Crée un nouvel objet centré, avec un quad rectangulaire respectant le ratio de l'image et une légère perspective. */
  const addObjectOverlay = (imageUrl: string, name: string) => {
    if (!activePhoto) return;
    const probe = new Image();
    probe.onload = () => {
      const photoImg = imgRef.current;
      const photoW = photoImg?.naturalWidth || 1;
      const photoH = photoImg?.naturalHeight || 1;
      const imgAspect = probe.naturalWidth / Math.max(1, probe.naturalHeight);

      const normW = 0.4;
      const realWidthPx = normW * photoW;
      const realHeightPx = realWidthPx / imgAspect;
      const normH = clamp01(realHeightPx / photoH) || normW;

      const cx = 0.5;
      const cy = 0.5;
      const halfW = normW / 2;
      const halfH = normH / 2;
      const spread = 0.04;

      const quad: [Vec2, Vec2, Vec2, Vec2] = [
        { x: cx - halfW, y: cy - halfH },
        { x: cx + halfW, y: cy - halfH },
        { x: cx + halfW + spread, y: cy + halfH },
        { x: cx - halfW - spread, y: cy + halfH },
      ];

      const overlay: PhotoOverlay = {
        id: uid(),
        name,
        imageUrl,
        quad,
        opacity: 1,
        blend: 'normal',
      };

      updatePhoto(activePhoto.id, { overlays: [...(activePhoto.overlays ?? []), overlay] });
      setSelectedOverlayId(overlay.id);
      setShowAddPanel(false);
    };
    probe.src = imageUrl;
  };

  /** Ajoute un objet en tentant d'abord le détourage automatique si la case est cochée (échec non bloquant). */
  const addObjectOverlayWithCutout = (imageUrl: string, name: string) => {
    setAddCutoutError('');
    if (!autoCutout) {
      addObjectOverlay(imageUrl, name);
      return;
    }
    removeBackground(imageUrl)
      .then((cutUrl) => addObjectOverlay(cutUrl, name))
      .catch((err: unknown) => {
        setAddCutoutError(err instanceof Error ? err.message : 'Détourage impossible.');
        addObjectOverlay(imageUrl, name);
      });
  };

  const handleObjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    readAndResizeImage(file, MAX_OBJECT_WIDTH)
      .then((dataUrl) => addObjectOverlayWithCutout(dataUrl, file.name.replace(/\.[^.]+$/, '') || 'Objet'))
      .catch(() => setImportError("Impossible de lire cette image. Essayez un autre fichier (JPG ou PNG)."));
  };

  const updateOverlay = (id: ID, patch: Partial<PhotoOverlay>) => {
    // Repart des overlays les plus récents (via la ref) : nécessaire car cette fonction
    // peut être appelée après un traitement asynchrone (détourage) dont la durée peut
    // dépasser un cycle de rendu.
    const photo = activePhotoRef.current;
    if (!photo) return;
    const current = photo.overlays ?? [];
    const next = current.map((o) => (o.id === id ? { ...o, ...patch } : o));
    updatePhoto(photo.id, { overlays: next });
  };

  /** Affiche un message d'erreur de détourage sous la liste des objets, effacé après 6 s. */
  const showCutoutError = useCallback((message: string) => {
    setCutoutError(message);
    if (cutoutErrorTimerRef.current !== null) window.clearTimeout(cutoutErrorTimerRef.current);
    cutoutErrorTimerRef.current = window.setTimeout(() => setCutoutError(''), 6000);
  }, []);

  /** Détoure (ou restaure) le fond de l'image d'un objet déjà incrusté. */
  const handleToggleCutout = (overlay: PhotoOverlay) => {
    const original = cutoutOriginals.get(overlay.id);
    if (original !== undefined) {
      // Déjà détouré durant cette session : on restaure l'image d'origine.
      updateOverlay(overlay.id, { imageUrl: original });
      setCutoutOriginals((prev) => {
        const next = new Map(prev);
        next.delete(overlay.id);
        return next;
      });
      return;
    }
    setCutoutBusyId(overlay.id);
    removeBackground(overlay.imageUrl)
      .then((cutUrl) => {
        setCutoutOriginals((prev) => {
          const next = new Map(prev);
          next.set(overlay.id, overlay.imageUrl);
          return next;
        });
        updateOverlay(overlay.id, { imageUrl: cutUrl });
        if (cutoutErrorTimerRef.current !== null) {
          window.clearTimeout(cutoutErrorTimerRef.current);
          cutoutErrorTimerRef.current = null;
        }
        setCutoutError('');
      })
      .catch((err: unknown) => {
        showCutoutError(err instanceof Error ? err.message : 'Détourage impossible.');
      })
      .finally(() => setCutoutBusyId(null));
  };

  const moveOverlay = (id: ID, direction: -1 | 1) => {
    if (!activePhoto) return;
    const next = [...overlays];
    const idx = next.findIndex((o) => o.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    updatePhoto(activePhoto.id, { overlays: next });
  };

  const deleteOverlay = (id: ID) => {
    if (!activePhoto) return;
    updatePhoto(activePhoto.id, { overlays: overlays.filter((o) => o.id !== id) });
    if (selectedOverlayId === id) setSelectedOverlayId(null);
    setCutoutOriginals((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="ps-hidden-input"
      onChange={handleFileChange}
    />
  );
  const objectFileInput = (
    <input
      ref={objectFileInputRef}
      type="file"
      accept="image/*"
      className="ps-hidden-input"
      onChange={handleObjectFileChange}
    />
  );

  if (photos.length === 0) {
    return (
      <div className="photo-studio ps-empty">
        {fileInput}
        <div className="ps-empty-card">
          <div className="ps-empty-icon" aria-hidden="true">🖌️</div>
          <h1>Studio Photo</h1>
          <p>
            Importez une photo de votre pièce, peignez au pinceau les murs à repeindre, testez
            instantanément différentes couleurs de peinture, puis incrustez des meubles ou luminaires
            en perspective pour visualiser le résultat final.
          </p>
          <ol className="ps-empty-steps">
            <li>Importez une photo de la pièce (JPG ou PNG).</li>
            <li>Peignez au pinceau les zones de mur à repeindre.</li>
            <li>Choisissez une couleur ou une palette et ajustez l'intensité.</li>
            <li>Passez en mode « Objets » pour poser des meubles en perspective dans la photo.</li>
            <li>Téléchargez le rendu pour comparer les options.</li>
          </ol>
          <button type="button" className="ps-btn ps-btn-primary ps-btn-large" onClick={() => fileInputRef.current?.click()}>
            + Ajouter une photo
          </button>
          {importError && <p className="ps-error">{importError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="photo-studio">
      {fileInput}
      {objectFileInput}

      <aside className="ps-sidebar">
        <div className="ps-sidebar-header">
          <h2>Photos</h2>
          <button type="button" className="ps-btn ps-btn-primary ps-btn-block" onClick={() => fileInputRef.current?.click()}>
            + Ajouter une photo
          </button>
          {importError && <p className="ps-error">{importError}</p>}
        </div>
        <ul className="ps-photo-list">
          {photos.map((photo) => (
            <li key={photo.id} className={`ps-photo-item${photo.id === activePhotoId ? ' active' : ''}`}>
              <button
                type="button"
                className="ps-photo-thumb-btn"
                onClick={() => setActivePhoto(photo.id)}
                title="Ouvrir cette photo"
              >
                <img src={photo.dataUrl} alt={photo.name} className="ps-photo-thumb" />
              </button>
              <div className="ps-photo-meta">
                <input
                  className="ps-photo-name"
                  value={photo.name}
                  onChange={(e) => updatePhoto(photo.id, { name: e.target.value })}
                  placeholder="Nom de la photo"
                />
                <select
                  className="ps-photo-room"
                  value={photo.roomId ?? ''}
                  onChange={(e) => updatePhoto(photo.id, { roomId: e.target.value || undefined })}
                >
                  <option value="">Aucune pièce</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="ps-photo-delete"
                title="Supprimer la photo"
                aria-label="Supprimer la photo"
                onClick={() => handleDeletePhoto(photo.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="ps-canvas-area">
        {activePhoto ? (
          <div className="ps-canvas-wrapper">
            <canvas
              ref={displayCanvasRef}
              className={`ps-canvas${isDrawing ? ' drawing' : ''}${mode === 'objects' ? ' ps-canvas-objects' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            />
            {mode === 'paint' && cursorPreview && (
              <div
                className={`ps-brush-cursor ${tool === 'erase' ? 'erase' : 'brush'}`}
                style={{
                  left: cursorPreview.x,
                  top: cursorPreview.y,
                  width: cursorPreview.size,
                  height: cursorPreview.size,
                }}
              />
            )}
          </div>
        ) : (
          <div className="ps-no-selection">Sélectionnez une photo dans la liste à gauche.</div>
        )}
      </main>

      <section className="ps-controls">
        <div className="ps-control-group">
          <span className="ps-control-label">Mode</span>
          <div className="ps-segmented">
            <button type="button" className={mode === 'paint' ? 'active' : ''} onClick={() => setMode('paint')}>
              🖌️ Peinture
            </button>
            <button type="button" className={mode === 'objects' ? 'active' : ''} onClick={() => setMode('objects')}>
              🛋️ Objets
            </button>
          </div>
        </div>

        {mode === 'paint' ? (
          <>
            <div className="ps-control-group">
              <span className="ps-control-label">Outil</span>
              <div className="ps-segmented">
                <button type="button" className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>
                  🖌️ Pinceau
                </button>
                <button type="button" className={tool === 'erase' ? 'active' : ''} onClick={() => setTool('erase')}>
                  🧽 Gomme
                </button>
              </div>
            </div>

            <div className="ps-control-group">
              <label htmlFor="ps-brush-size">Taille du pinceau — {brushPercent}%</label>
              <input
                id="ps-brush-size"
                type="range"
                min={MIN_BRUSH_PERCENT}
                max={MAX_BRUSH_PERCENT}
                step={0.5}
                value={brushPercent}
                onChange={(e) => setBrushPercent(Number(e.target.value))}
              />
            </div>

            <div className="ps-control-group">
              <label htmlFor="ps-opacity">
                Intensité — {Math.round((activePhoto?.paintOpacity ?? DEFAULT_PAINT_OPACITY) * 100)}%
              </label>
              <input
                id="ps-opacity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                disabled={!activePhoto}
                value={activePhoto?.paintOpacity ?? DEFAULT_PAINT_OPACITY}
                onChange={(e) => activePhoto && updatePhoto(activePhoto.id, { paintOpacity: Number(e.target.value) })}
              />
            </div>

            <div className="ps-control-group">
              <label htmlFor="ps-color">Couleur active</label>
              <input
                id="ps-color"
                type="color"
                className="ps-color-input"
                disabled={!activePhoto}
                value={activePhoto?.paintColor ?? DEFAULT_PAINT_COLOR}
                onChange={(e) => activePhoto && updatePhoto(activePhoto.id, { paintColor: e.target.value })}
              />
            </div>

            <div className="ps-palettes">
              {PAINT_PALETTES.map((palette) => (
                <div key={palette.name} className="ps-palette">
                  <div className="ps-palette-name" title={palette.description}>
                    {palette.name}
                  </div>
                  <div className="ps-swatches">
                    {palette.colors.map((color) => (
                      <button
                        key={color.hex}
                        type="button"
                        className={`ps-swatch${activePhoto?.paintColor === color.hex ? ' selected' : ''}`}
                        style={{ background: color.hex }}
                        title={color.name}
                        aria-label={color.name}
                        disabled={!activePhoto}
                        onClick={() => activePhoto && updatePhoto(activePhoto.id, { paintColor: color.hex })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="ps-actions">
              <button
                type="button"
                className="ps-btn"
                disabled={!activePhoto || activePhoto.strokes.length === 0}
                onClick={handleClearStrokes}
              >
                Tout effacer
              </button>
              <button type="button" className="ps-btn ps-btn-primary" disabled={!activePhoto} onClick={handleDownload}>
                Télécharger le rendu
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ps-control-group">
              <span className="ps-control-label">Objets</span>
              <button
                type="button"
                className="ps-btn ps-btn-primary ps-btn-block"
                disabled={!activePhoto}
                onClick={() => setShowAddPanel((v) => !v)}
              >
                + Ajouter un objet
              </button>
              {importError && <p className="ps-error">{importError}</p>}

              {showAddPanel && (
                <div className="ps-add-panel">
                  <label className="ps-cutout-checkbox">
                    <input
                      type="checkbox"
                      checked={autoCutout}
                      onChange={(e) => setAutoCutout(e.target.checked)}
                    />
                    Détourer automatiquement le fond
                  </label>
                  <button
                    type="button"
                    className="ps-btn ps-btn-block"
                    onClick={() => objectFileInputRef.current?.click()}
                  >
                    📁 Importer une image
                  </button>
                  <div className="ps-add-panel-divider">ou choisir un meuble du projet</div>
                  {furnitureWithPhoto.length > 0 ? (
                    <ul className="ps-furniture-pick-list">
                      {furnitureWithPhoto.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            className="ps-furniture-pick-item"
                            onClick={() => f.photoUrl && addObjectOverlayWithCutout(f.photoUrl, f.name)}
                          >
                            <img src={f.photoUrl} alt={f.name} className="ps-furniture-pick-thumb" />
                            <span>{f.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ps-hint">
                      Ajoutez des meubles avec photo via « Produit du web » dans le catalogue.
                    </p>
                  )}
                  {addCutoutError && <p className="ps-cutout-error">{addCutoutError}</p>}
                </div>
              )}
            </div>

            <div className="ps-control-group ps-overlay-list-group">
              <span className="ps-control-label">Calques ({overlays.length})</span>
              {overlays.length === 0 ? (
                <p className="ps-hint">Aucun objet ajouté pour cette photo.</p>
              ) : (
                <ul className="ps-overlay-list">
                  {overlays.map((ov, idx) => (
                    <li
                      key={ov.id}
                      className={`ps-overlay-item${ov.id === selectedOverlayId ? ' active' : ''}`}
                      onClick={() => setSelectedOverlayId(ov.id)}
                    >
                      <img src={ov.imageUrl} alt="" className="ps-overlay-thumb" />
                      <div className="ps-overlay-fields">
                        <input
                          className="ps-overlay-name"
                          value={ov.name}
                          onChange={(e) => updateOverlay(ov.id, { name: e.target.value })}
                        />
                        <label className="ps-overlay-opacity-label">
                          Opacité — {Math.round(ov.opacity * 100)}%
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={ov.opacity}
                            onChange={(e) => updateOverlay(ov.id, { opacity: Number(e.target.value) })}
                          />
                        </label>
                        <select
                          value={ov.blend}
                          title="Multiplier : intègre les photos sur fond blanc"
                          onChange={(e) => updateOverlay(ov.id, { blend: e.target.value === 'multiply' ? 'multiply' : 'normal' })}
                        >
                          <option value="normal">Normal</option>
                          <option value="multiply" title="Multiplier : intègre les photos sur fond blanc">
                            Multiplier
                          </option>
                        </select>
                      </div>
                      <div className="ps-overlay-actions">
                        <button
                          type="button"
                          className={`ps-cutout-btn${cutoutOriginals.has(ov.id) ? ' active' : ''}`}
                          title={
                            cutoutOriginals.has(ov.id)
                              ? "Restaurer l'image d'origine"
                              : 'Détourer automatiquement le fond'
                          }
                          disabled={cutoutBusyId === ov.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleCutout(ov);
                          }}
                        >
                          {cutoutBusyId === ov.id ? '…' : cutoutOriginals.has(ov.id) ? '↩ Original' : '✂ Détourer'}
                        </button>
                        <button
                          type="button"
                          title="Monter"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveOverlay(ov.id, -1);
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="Descendre"
                          disabled={idx === overlays.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveOverlay(ov.id, 1);
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="Supprimer"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteOverlay(ov.id);
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {cutoutError && <p className="ps-error ps-cutout-error">{cutoutError}</p>}
            </div>

            <div className="ps-actions">
              <button type="button" className="ps-btn ps-btn-primary" disabled={!activePhoto} onClick={handleDownload}>
                Télécharger le rendu
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
