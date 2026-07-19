import { Suspense, lazy, useRef } from 'react';
import CatalogPanel from './components/panels/CatalogPanel';
import PropertiesPanel from './components/panels/PropertiesPanel';
import FloorPlanEditor from './components/plan/FloorPlanEditor';
import { useStore } from './store/useStore';
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
  const importProject = useStore((s) => s.importProject);
  const importRef = useRef<HTMLInputElement>(null);

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
            <button className={tool === 'addRoom' ? 'active' : ''} onClick={() => setTool('addRoom')} title="Dessiner une pièce">
              ▭ Pièce
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
          <button className="btn btn-sm" onClick={exportJson} title="Exporter le projet en JSON">
            Exporter
          </button>
          <button className="btn btn-sm" onClick={() => importRef.current?.click()} title="Importer un projet">
            Importer
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              if (confirm('Repartir d’un nouveau projet ? Le projet actuel sera remplacé (pensez à l’exporter).')) newProject();
            }}
          >
            Nouveau
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

      <main className="workspace">
        {viewMode !== 'photo' && <CatalogPanel />}
        <Suspense fallback={<div className="loading">Chargement…</div>}>
          {viewMode === 'plan' && <FloorPlanEditor />}
          {viewMode === '3d' && <View3D />}
          {viewMode === 'photo' && <PhotoStudio />}
        </Suspense>
        {viewMode !== 'photo' && <PropertiesPanel />}
      </main>
    </div>
  );
}
