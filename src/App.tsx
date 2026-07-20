import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import CatalogPanel from './components/panels/CatalogPanel';
import PropertiesPanel from './components/panels/PropertiesPanel';
import FloorPlanEditor from './components/plan/FloorPlanEditor';
import { redoProject, undoProject, useStore } from './store/useStore';
import type { Project } from './types';
import './App.css';

const View3D = lazy(() => import('./components/three/View3D'));
const PhotoStudio = lazy(() => import('./components/photo/PhotoStudio'));

export default function App() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const snap = useStore((s) => s.snap);
  const setSnap = useStore((s) => s.setSnap);
  const project = useStore((s) => s.project);
  const renameProject = useStore((s) => s.renameProject);
  const newProject = useStore((s) => s.newProject);
  const loadDemoProject = useStore((s) => s.loadDemoProject);
  const importProject = useStore((s) => s.importProject);
  const importRef = useRef<HTMLInputElement>(null);
  const placement = useStore((s) => s.placement);
  const openingPlacement = useStore((s) => s.openingPlacement);
  const openingFlip = useStore((s) => s.openingFlip);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Raccourcis globaux (plan 2D et vue 3D) : rotation, duplication,
  // suppression, pose au curseur, annuler/refaire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoProject();
        else undoProject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoProject();
        return;
      }
      if (e.key === 'Escape' && (s.placement || s.openingPlacement)) {
        if (s.placement) s.setPlacement(null);
        if (s.openingPlacement) s.setOpeningPlacement(null);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        const delta = e.shiftKey ? -15 : 15;
        if (s.placement) {
          s.rotatePlacement(delta);
        } else if (s.openingPlacement) {
          s.flipOpeningPlacement();
        } else if (s.selection?.kind === 'furniture') {
          const selId = s.selection.id;
          const f = s.project.furniture.find((x) => x.id === selId);
          if (f) s.updateFurniture(f.id, { rotation: (((f.rotation + delta) % 360) + 360) % 360 });
        } else if (s.selection?.kind === 'opening') {
          const { roomId, id } = s.selection;
          const o = s.project.rooms.find((r) => r.id === roomId)?.openings.find((x) => x.id === id);
          if (o) s.updateOpening(roomId, id, { flip: !o.flip });
        }
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && s.selection?.kind === 'furniture') {
        s.duplicateFurniture(s.selection.id);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        if (s.selection.kind === 'room') s.removeRoom(s.selection.id);
        if (s.selection.kind === 'furniture') s.removeFurniture(s.selection.id);
        if (s.selection.kind === 'opening') s.removeOpening(s.selection.roomId, s.selection.id);
        if (s.selection.kind === 'roofWindow') s.removeRoofWindow(s.selection.roomId, s.selection.id);
        if (s.selection.kind === 'wall') {
          // Supprimer une section de mur = l'ouvrir (espace traversant), comme dans un mode construction.
          s.updateWall(s.selection.roomId, s.selection.index, { open: true });
          s.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, '_') || 'projet'}.homedesign.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Project;
      if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.furniture)) throw new Error('format');
      importProject({ ...parsed, photos: parsed.photos ?? [] });
    } catch {
      alert('Fichier de projet invalide.');
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◧</span> Home Design Studio
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => renameProject(e.target.value)}
          title="Nom du projet"
        />
        <nav className="view-tabs">
          <button className={viewMode === 'plan' ? 'active' : ''} onClick={() => setViewMode('plan')}>
            Plan 2D
          </button>
          <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>
            Vue 3D
          </button>
          <button className={viewMode === 'photo' ? 'active' : ''} onClick={() => setViewMode('photo')}>
            Studio Photo
          </button>
        </nav>
        {viewMode === 'plan' && (
          <div className="tools">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Sélectionner / déplacer">
              ☰ Sélection
            </button>
            <button className={tool === 'addRoom' ? 'active' : ''} onClick={() => setTool('addRoom')} title="Dessiner une pièce rectangulaire (ou un couloir étroit)">
              ▭ Pièce
            </button>
            <button
              className={tool === 'addPoly' ? 'active' : ''}
              onClick={() => setTool('addPoly')}
              title="Tracer les murs point par point, cotes en direct (accrochage 45°)"
            >
              ✏ Murs
            </button>
            <button className={tool === 'measure' ? 'active' : ''} onClick={() => setTool('measure')} title="Mesurer">
              ⤢ Mesure
            </button>
            <label className="check-row snap-toggle" title="Accrochage à la grille (5 cm)">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              Aimant
            </label>
          </div>
        )}
        <div className="spacer" />
        <div className="project-actions">
          <button className="btn btn-sm" onClick={undoProject} title="Annuler (Ctrl+Z)">
            ↩
          </button>
          <button className="btn btn-sm" onClick={redoProject} title="Refaire (Ctrl+Y)">
            ↪
          </button>
          <button className="btn btn-sm" onClick={exportJson} title="Exporter le projet en JSON">
            Exporter
          </button>
          <button className="btn btn-sm" onClick={() => importRef.current?.click()} title="Importer un projet">
            Importer
          </button>
          <button
            className="btn btn-sm btn-accent"
            title="Partir d'une feuille blanche : aucune pièce, vous concevez tout vous-même"
            onClick={() => {
              if (confirm('Créer un projet vierge ? Le projet actuel sera remplacé (pensez à l’exporter).')) newProject();
            }}
          >
            Nouveau
          </button>
          <button
            className="btn btn-sm"
            title="Charger la maison d'exemple"
            onClick={() => {
              if (confirm('Charger le projet d’exemple ? Le projet actuel sera remplacé (pensez à l’exporter).')) loadDemoProject();
            }}
          >
            Exemple
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {placement && (
        <div className="placement-banner">
          🛋️ <strong>{placement.name}</strong> accroché au curseur — cliquez sur le plan ou dans la 3D pour
          le poser · <kbd>R</kbd> pivoter · <kbd>Échap</kbd> annuler
        </div>
      )}
      {openingPlacement && (
        <div className="placement-banner">
          🚪 <strong>{openingPlacement === 'velux' ? 'Fenêtre de toit' : ''}</strong>
          {openingPlacement === 'velux'
            ? ' accrochée au curseur — cliquez dans une pièce pour la poser'
            : ' Menuiserie accrochée au curseur — glissez le long d’un mur puis cliquez pour la poser'}
          {openingPlacement !== 'velux' && (
            <>
              {' '}· <kbd>R</kbd> inverser le sens{openingFlip ? ' (inversé)' : ''}
            </>
          )}{' '}
          · <kbd>Échap</kbd> annuler
        </div>
      )}

      <main className="workspace">
        {viewMode !== 'photo' && leftOpen && <CatalogPanel />}
        {viewMode !== 'photo' && (
          <button
            className={`panel-toggle left ${leftOpen ? '' : 'closed'}`}
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? 'Masquer le catalogue' : 'Afficher le catalogue'}
          >
            {leftOpen ? '⟨' : '⟩'}
          </button>
        )}
        <Suspense fallback={<div className="loading">Chargement…</div>}>
          {viewMode === 'plan' && <FloorPlanEditor />}
          {viewMode === '3d' && <View3D />}
          {viewMode === 'photo' && <PhotoStudio />}
        </Suspense>
        {viewMode !== 'photo' && (
          <button
            className={`panel-toggle right ${rightOpen ? '' : 'closed'}`}
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? 'Masquer les propriétés' : 'Afficher les propriétés'}
          >
            {rightOpen ? '⟩' : '⟨'}
          </button>
        )}
        {viewMode !== 'photo' && rightOpen && <PropertiesPanel />}
      </main>
    </div>
  );
}
