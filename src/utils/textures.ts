import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { TextureRef } from '../types';
import { textureUrl } from '../data/textures';

/**
 * Cache mutualisé de textures Three.js, indexé par (URL de l'image, échelle de
 * répétition). Deux surfaces partageant la même image ET la même échelle
 * réutilisent le MÊME objet THREE.Texture — un seul upload GPU.
 */
const cache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

/** Clé de cache : image + répétition (arrondie) car repeat est porté par la Texture. */
function keyOf(url: string, repeat: number): string {
  return `${url}|${repeat.toFixed(4)}`;
}

/**
 * Charge (ou récupère du cache) une texture prête à l'emploi, répétée pour que
 * le motif mesure `tileMeters` en taille réelle. `onReady` est appelé une fois
 * l'image décodée (pour re-render), le tout sans bloquer.
 */
export function getTexture(url: string, tileMeters: number, onReady?: () => void): THREE.Texture {
  const repeat = 1 / Math.max(0.05, tileMeters);
  const key = keyOf(url, repeat);
  const existing = cache.get(key);
  if (existing) return existing;

  const tex = loader.load(
    url,
    () => onReady?.(),
    undefined,
    () => onReady?.()
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/**
 * Hook : renvoie la THREE.Texture correspondant à une référence, répétée à la
 * bonne échelle, ou null (pas de texture / en cours de chargement au 1er rendu).
 * Ne suspend pas : le composant affiche sa couleur unie tant que null.
 */
export function useSurfaceTexture(ref: TextureRef | undefined, tileMeters: number): THREE.Texture | null {
  const url = ref ? textureUrl(ref) : null;
  const [, force] = useState(0);
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    const t = getTexture(url, tileMeters, () => force((v) => v + 1));
    setTex(t);
  }, [url, tileMeters]);

  // Si l'image n'est pas encore prête, la texture existe mais sans dimensions.
  if (tex && !tex.image) return null;
  return tex;
}
