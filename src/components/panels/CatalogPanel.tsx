import { useMemo, useRef, useState } from 'react';
import { CATALOG } from '../../data/catalog';
import { useStore } from '../../store/useStore';
import type { CatalogItem, FurnitureCategory, FurnitureShape } from '../../types';
import { CATEGORY_LABELS, formatLength } from '../../types';
import { removeBackground } from '../../utils/cutout';

function readImageAsDataUrl(file: File, maxW = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Image invalide'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface WebForm {
  name: string;
  category: FurnitureCategory;
  widthCm: string;
  depthCm: string;
  heightCm: string;
  color: string;
  shape: FurnitureShape;
  photoUrl?: string;
  urlInput: string;
  existing: boolean;
}

const EMPTY_FORM: WebForm = {
  name: '',
  category: 'canape',
  widthCm: '',
  depthCm: '',
  heightCm: '',
  color: '#8a8f98',
  shape: 'rect',
  urlInput: '',
  existing: false,
};

export default function CatalogPanel() {
  const setPlacement = useStore((s) => s.setPlacement);
  const placement = useStore((s) => s.placement);
  const [cat, setCat] = useState<FurnitureCategory | 'tous'>('tous');
  const [search, setSearch] = useState('');
  const [showWebForm, setShowWebForm] = useState(false);
  const [form, setForm] = useState<WebForm>(EMPTY_FORM);
  const [webError, setWebError] = useState('');
  const [cutoutBusy, setCutoutBusy] = useState(false);
  /** Image avant détourage, pour pouvoir revenir en arrière. */
  const [photoOriginal, setPhotoOriginal] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cutout = async () => {
    if (!form.photoUrl || cutoutBusy) return;
    setCutoutBusy(true);
    setWebError('');
    try {
      const cut = await removeBackground(form.photoUrl);
      setPhotoOriginal(form.photoUrl);
      setForm((f) => ({ ...f, photoUrl: cut }));
    } catch (e) {
      setWebError(e instanceof Error ? e.message : 'Détourage impossible.');
    } finally {
      setCutoutBusy(false);
    }
  };

  const undoCutout = () => {
    if (!photoOriginal) return;
    setForm((f) => ({ ...f, photoUrl: photoOriginal }));
    setPhotoOriginal(null);
  };

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATALOG.filter(
      (i) =>
        (cat === 'tous' || i.category === cat) &&
        (!q || i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q))
    );
  }, [cat, search]);

  /** Accroche l'article au curseur : il se pose d'un clic sur le plan ou dans la 3D. */
  const place = (item: CatalogItem, existing = false) => {
    setPlacement({
      catalogId: item.id,
      name: item.name,
      category: item.category,
      shape: item.shape,
      width: item.width,
      depth: item.depth,
      height: item.height,
      color: item.color,
      existing,
    });
  };

  const loadFromUrl = async () => {
    setWebError('');
    try {
      const res = await fetch(form.urlInput);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error("L'URL ne pointe pas vers une image");
      const dataUrl = await readImageAsDataUrl(new File([blob], 'web-image', { type: blob.type }));
      setPhotoOriginal(null);
      setForm((f) => ({ ...f, photoUrl: dataUrl }));
    } catch {
      setWebError(
        "Impossible de charger l'image depuis cette URL (protection du site). Enregistrez l'image sur votre appareil puis importez le fichier."
      );
    }
  };

  const submitWeb = () => {
    const w = parseFloat(form.widthCm.replace(',', '.')) / 100;
    const d = parseFloat(form.depthCm.replace(',', '.')) / 100;
    const h = parseFloat(form.heightCm.replace(',', '.')) / 100;
    if (!form.name.trim() || !(w > 0) || !(d > 0) || !(h > 0)) {
      setWebError('Renseignez un nom et les trois dimensions (en cm) indiquées sur la fiche produit.');
      return;
    }
    setPlacement({
      name: form.name.trim(),
      category: form.category,
      shape: form.shape,
      width: w,
      depth: d,
      height: h,
      color: form.color,
      existing: form.existing,
      photoUrl: form.photoUrl,
    });
    setForm(EMPTY_FORM);
    setPhotoOriginal(null);
    setWebError('');
    setShowWebForm(false);
  };

  return (
    <aside className="panel catalog-panel">
      <h2>Catalogue</h2>

      <button className="btn btn-accent btn-block" onClick={() => setShowWebForm((v) => !v)}>
        {showWebForm ? '← Retour au catalogue' : '+ Produit du web / meuble existant'}
      </button>

      {showWebForm ? (
        <div className="web-form">
          <p className="hint">
            Ajoutez un meuble ou luminaire repéré sur un site marchand : reportez ses dimensions depuis la
            fiche produit et sa photo pour tester le rendu chez vous. Sert aussi à relever vos meubles
            existants.
          </p>
          <label>
            Nom du produit
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : Canapé KIVIK 3 places"
            />
          </label>
          <label>
            Catégorie
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as FurnitureCategory })}
            >
              {(Object.keys(CATEGORY_LABELS) as FurnitureCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="dims-row">
            <label>
              Largeur (cm)
              <input inputMode="decimal" value={form.widthCm} onChange={(e) => setForm({ ...form, widthCm: e.target.value })} placeholder="220" />
            </label>
            <label>
              Prof. (cm)
              <input inputMode="decimal" value={form.depthCm} onChange={(e) => setForm({ ...form, depthCm: e.target.value })} placeholder="95" />
            </label>
            <label>
              Haut. (cm)
              <input inputMode="decimal" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} placeholder="83" />
            </label>
          </div>
          <div className="dims-row">
            <label>
              Forme
              <select value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as FurnitureShape })}>
                <option value="rect">Rectangulaire</option>
                <option value="round">Ronde</option>
                <option value="lshape">Angle (L)</option>
              </select>
            </label>
            <label>
              Couleur
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.existing}
              onChange={(e) => setForm({ ...form, existing: e.target.checked })}
            />
            Meuble déjà présent chez moi (relevé)
          </label>
          <label>
            Photo du produit — URL de l'image
            <div className="url-row">
              <input
                value={form.urlInput}
                onChange={(e) => setForm({ ...form, urlInput: e.target.value })}
                placeholder="https://…/produit.jpg"
              />
              <button className="btn" onClick={loadFromUrl} disabled={!form.urlInput.trim()}>
                Charger
              </button>
            </div>
          </label>
          <button className="btn btn-block" onClick={() => fileRef.current?.click()}>
            … ou importer un fichier image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setForm((f) => ({ ...f }));
                const dataUrl = await readImageAsDataUrl(file);
                setPhotoOriginal(null);
                setForm((f) => ({ ...f, photoUrl: dataUrl }));
                setWebError('');
              } catch {
                setWebError("Impossible de lire cette image.");
              }
              e.target.value = '';
            }}
          />
          {form.photoUrl && (
            <>
              <img className="web-preview" src={form.photoUrl} alt="Aperçu produit" />
              <div className="dims-row">
                <button className="btn btn-sm" onClick={cutout} disabled={cutoutBusy || !!photoOriginal}>
                  {cutoutBusy ? 'Détourage…' : '✂ Détourer le fond'}
                </button>
                {photoOriginal && (
                  <button className="btn btn-sm" onClick={undoCutout}>
                    ↩ Rétablir l'original
                  </button>
                )}
              </div>
            </>
          )}
          {webError && <p className="error">{webError}</p>}
          <button className="btn btn-accent btn-block" onClick={submitWeb}>
            Placer sur le plan
          </button>
        </div>
      ) : (
        <>
          <input
            className="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un meuble…"
          />
          <div className="cat-tabs">
            <button className={cat === 'tous' ? 'active' : ''} onClick={() => setCat('tous')}>
              Tous
            </button>
            {(Object.keys(CATEGORY_LABELS) as FurnitureCategory[]).map((c) => (
              <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <div className="catalog-list">
            {items.map((item) => (
              <div key={item.id} className="catalog-item">
                <span className="swatch" style={{ background: item.color, borderRadius: item.shape === 'round' ? '50%' : '4px' }} />
                <div className="item-info">
                  <strong>{item.name}</strong>
                  <span className="dims">
                    {formatLength(item.width)} × {formatLength(item.depth)} × H {formatLength(item.height)}
                  </span>
                  {item.description && <span className="desc">{item.description}</span>}
                </div>
                <div className="item-actions">
                  <button
                    className={`btn btn-sm btn-accent ${placement?.catalogId === item.id ? 'placing' : ''}`}
                    onClick={() => place(item)}
                    title="Accrocher au curseur puis cliquer sur le plan ou la 3D pour poser"
                  >
                    {placement?.catalogId === item.id ? '…' : '+'}
                  </button>
                  <button className="btn btn-sm" onClick={() => place(item, true)} title="Poser comme meuble existant (relevé)">
                    Existant
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="hint">Aucun résultat.</p>}
          </div>
        </>
      )}
    </aside>
  );
}
