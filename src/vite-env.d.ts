/// <reference types="vite/client" />

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (element: HTMLElement, config?: Record<string, unknown>) => Viewer3Dmol;
    };
  }
}

export interface Viewer3Dmol {
  addModel: (data: string, format: string) => unknown;
  setStyle: (sel: Record<string, unknown>, style: Record<string, unknown>) => void;
  addSurface: (type: unknown, opts: Record<string, unknown>) => void;
  removeAllModels: () => void;
  removeAllSurfaces: () => void;
  setBackgroundColor: (color: string, alpha?: number) => void;
  zoomTo: () => void;
  render: () => void;
  spin: (axis: string | boolean) => void;
  resize: () => void;
  clear: () => void;
}
