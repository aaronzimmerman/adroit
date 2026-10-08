import { useEffect, useRef } from 'react';
import type { LedgerSnapshot } from '@adroit/shared';
import { StarMap } from '../map/StarMap.js';

/**
 * Hosts the framework-agnostic canvas renderer. React owns only the prose around it
 * (@DecisionRef eng:react-with-vite); the map itself is canvas, never DOM nodes
 * (@DecisionRef eng:map-on-gpu-canvas).
 */
export function MapView({
  snapshot,
  rootId,
  focus,
  onOpen,
  onSelect,
  mapRef,
}: {
  snapshot: LedgerSnapshot;
  rootId: string;
  focus: { id: string; n: number } | null;
  onOpen: (id: string) => void;
  onSelect: (id: string | null) => void;
  mapRef: React.MutableRefObject<StarMap | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacksRef = useRef({ onOpen, onSelect });
  callbacksRef.current = { onOpen, onSelect };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const map = new StarMap(canvas, {
      onOpen: (id) => callbacksRef.current.onOpen(id),
      onSelect: (id) => callbacksRef.current.onSelect(id),
    });
    mapRef.current = map;
    const resize = () => {
      const parent = canvas.parentElement!;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      map.dispose();
      mapRef.current = null;
    };
  }, [mapRef]);

  useEffect(() => {
    mapRef.current?.setData(snapshot, rootId);
  }, [snapshot, rootId, mapRef]);

  // Selection is travel: fly to the focused record once the data for its tree is set
  // (@DecisionRef ui:search-any-text — the view moves to the decision in the space).
  useEffect(() => {
    if (focus) mapRef.current?.flyTo(focus.id);
  }, [focus, mapRef]);

  return (
    <div className="map-host">
      <canvas ref={canvasRef} />
      <div className="map-hint muted">
        drag to fly · scroll to zoom · click a star to approach it · click a rule to expand it
      </div>
    </div>
  );
}
