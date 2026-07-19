import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { ID, PhotoPaintStroke, RoomPhoto } from '../../types';
import { PAINT_PALETTES } from '../../data/palettes';
import './photoStudio.css';

/** Largeur maximale (px) des photos stockées, pour limiter le poids localStorage. */
const MAX_STORED_WIDTH = 1600;
const DEFAULT_PAINT_COLOR = '#e7ddce';
const DEFAULT_PAINT_OPACITY = 0.85;
const MIN_BRUSH_PERCENT = 1;
const MAX_BRUSH_PERCENT = 20;

type BrushTool = 'brush' | 'erase';

interface CursorPreview {
  x: number;
  y: number;
  size: number;
}

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

  const [tool, setTool] = useState<BrushTool>('brush');
  const [brushPercent, setBrushPercent] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPreview, setCursorPreview] = useState<CursorPreview | null>(null);
  const [importError, setImportError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftStrokeRef = useRef<PhotoPaintStroke | null>(null);

  /** Recompose la photo + le calque de peinture (masqué) + les traits en cours, sur le canvas visible. */
  const redraw = useCallback((photo: RoomPhoto | null) => {
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
    dispCtx.drawImage(img, 0, 0, width, height);
    dispCtx.globalAlpha = clamp01(photo.paintOpacity);
    dispCtx.drawImage(paintLayer, 0, 0);
    dispCtx.globalAlpha = 1;
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

  // Redessine dès que la couleur, l'intensité ou les tracés changent.
  useEffect(() => {
    redraw(activePhoto);
  }, [activePhoto, redraw]);

  // Sélectionne automatiquement une photo si aucune n'est active mais qu'il en existe.
  useEffect(() => {
    if (!activePhotoId && photos.length > 0) {
      setActivePhoto(photos[0].id);
    }
  }, [activePhotoId, photos, setActivePhoto]);

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
        });
      })
      .catch(() => setImportError("Impossible de lire cette image. Essayez un autre fichier (JPG ou PNG)."));
  };

  const handleDeletePhoto = (id: ID) => {
    if (window.confirm('Supprimer cette photo et ses retouches de peinture ?')) {
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
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activePhoto.name || 'rendu'}-peinture.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /** Position du pointeur relative au canvas : coordonnées normalisées (stockage) + pixels écran (curseur). */
  const pointerData = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const normalized = { x: clamp01(px.x / rect.width), y: clamp01(px.y / rect.height) };
    return { normalized, px, displayWidth: rect.width };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const data = pointerData(e);
    if (!data) return;
    setCursorPreview({ x: data.px.x, y: data.px.y, size: (brushPercent / 100) * data.displayWidth * 2 });
    if (!activePhoto || !draftStrokeRef.current) return;
    draftStrokeRef.current.points.push(data.normalized);
    redraw(activePhoto);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

  const handlePointerLeave = () => {
    setCursorPreview(null);
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

  if (photos.length === 0) {
    return (
      <div className="photo-studio ps-empty">
        {fileInput}
        <div className="ps-empty-card">
          <div className="ps-empty-icon" aria-hidden="true">🖌️</div>
          <h1>Studio Photo</h1>
          <p>
            Importez une photo de votre pièce, peignez au pinceau les murs à repeindre, puis testez
            instantanément différentes couleurs de peinture. Le rendu conserve les ombres et la texture
            du mur pour un résultat réaliste.
          </p>
          <ol className="ps-empty-steps">
            <li>Importez une photo de la pièce (JPG ou PNG).</li>
            <li>Peignez au pinceau les zones de mur à repeindre.</li>
            <li>Choisissez une couleur ou une palette et ajustez l'intensité.</li>
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
              className={`ps-canvas${isDrawing ? ' drawing' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            />
            {cursorPreview && (
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
      </section>
    </div>
  );
}
