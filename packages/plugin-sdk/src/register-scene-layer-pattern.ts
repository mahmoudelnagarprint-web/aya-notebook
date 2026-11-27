/**
 * Scene-layer pattern: an optional ambient canvas behind the workspace.
 *
 * Disabled by default so the crisp dashboard canvas stays flat; themes can turn
 * it on for a subtle depth layer without touching component code.
 */
const PATTERN_ID = 'td-scene-layer';

export function registerSceneLayerPattern(color = 'rgba(30,120,255,0.06)'): void {
  if (typeof document === 'undefined' || document.getElementById(PATTERN_ID)) return;
  const layer = document.createElement('div');
  layer.id = PATTERN_ID;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:0',
    `background-image:radial-gradient(${color} 1px, transparent 1px)`,
    'background-size:22px 22px',
    'opacity:0.5',
  ].join(';');
  document.body.appendChild(layer);
}

export function deactivateSceneLayerPattern(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(PATTERN_ID)?.remove();
}
