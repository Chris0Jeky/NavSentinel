const ICON_PATHS: Record<string, string> = {
  shield: '<path d="M12 3 L20 5 V11 C20 16 16 19.5 12 21 C8 19.5 4 16 4 11 V5 Z"/>',
  key: '<circle cx="8" cy="13" r="3"/><path d="M11 13 H21 M18 13 V16 M21 13 V11"/>',
  eye: '<path d="M2 12 C5 6 9 5 12 5 C15 5 19 6 22 12 C19 18 15 19 12 19 C9 19 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2 L4 14 H11 L10 22 L19 10 H12 Z"/>',
  block: '<circle cx="12" cy="12" r="9"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="10" x2="12" y2="14"/>',
  check: '<polyline points="4,12 10,18 20,6"/>',
  x: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  chevron: '<polyline points="8,6 14,12 8,18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M5 19 L7 17 M17 7 L19 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>',
  download: '<path d="M12 3 V15 M7 11 L12 16 L17 11 M4 19 H20"/>',
  upload: '<path d="M12 16 V4 M7 8 L12 3 L17 8 M4 19 H20"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<path d="M5 7 H19 M8 7 V5 H16 V7 M7 7 L8 20 H16 L17 7"/>',
  search: '<circle cx="11" cy="11" r="6"/><line x1="16" y1="16" x2="20" y2="20"/>',
  filter: '<path d="M4 5 H20 L14 13 V20 L10 18 V13 L4 5 Z"/>',
  chart: '<polyline points="3,17 9,11 13,15 21,5"/><polyline points="15,5 21,5 21,11"/>',
  list: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  cube: '<path d="M12 3 L20 7 V17 L12 21 L4 17 V7 Z M12 3 V12 M4 7 L12 12 L20 7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11 V8 C8 5.8 9.8 4 12 4 C14.2 4 16 5.8 16 8 V11"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12 H21 M12 3 C15 7 15 17 12 21 C9 17 9 7 12 3"/>',
  cursor: '<path d="M5 3 L5 19 L9 15 L12 21 L14 20 L11 14 L17 14 Z"/>',
  layers: '<path d="M12 3 L21 8 L12 13 L3 8 Z"/><polyline points="3,12 12,17 21,12"/><polyline points="3,16 12,21 21,16"/>',
  activity: '<polyline points="3,12 7,12 10,4 14,20 17,12 21,12"/>',
  rollback: '<path d="M4 12 A8 8 0 1 1 12 20"/><polyline points="4,8 4,12 8,12"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  tab: '<path d="M3 19 V8 H8 L10 5 H21 V19 Z"/>',
};

export function icon(name: string, size = 16, strokeColor = 'currentColor', strokeWidth = 1.6): string {
  const path = ICON_PATHS[name];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${path}</svg>`;
}

export function logoSentinel(size = 40, animated = true): string {
  const id = `ns-${Math.round(Math.random() * 9999)}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="display:block">
    <defs>
      <linearGradient id="${id}-sweep" x1="0" y1="0" x2="1" y2="0.4">
        <stop offset="0%" stop-color="#f5a623" stop-opacity="0.7"/>
        <stop offset="80%" stop-color="#f5a623" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${id}-core" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#fff5dc" stop-opacity="0.9"/>
        <stop offset="40%" stop-color="#f5a623" stop-opacity="1"/>
        <stop offset="100%" stop-color="#f5a623" stop-opacity="0.6"/>
      </radialGradient>
      <radialGradient id="${id}-frame" cx="50%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#181318" stop-opacity="1"/>
        <stop offset="100%" stop-color="#08070a" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="${id}-blade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff5dc" stop-opacity="0.85"/>
        <stop offset="50%" stop-color="#f5a623" stop-opacity="1"/>
        <stop offset="100%" stop-color="#f5a623" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="40" height="40" rx="9" fill="url(#${id}-frame)"/>
    <rect x="0.5" y="0.5" width="39" height="39" rx="8.5" fill="none" stroke="#f5a623" stroke-width="0.4" opacity="0.25"/>
    <circle cx="20" cy="20" r="15.5" fill="none" stroke="#f5a623" stroke-width="0.35" opacity="0.18"/>
    <circle cx="20" cy="20" r="12" fill="none" stroke="#f5a623" stroke-width="0.5" opacity="0.4"/>
    <circle cx="20" cy="20" r="7.5" fill="none" stroke="#f5a623" stroke-width="0.6" opacity="0.7"/>
    ${[0, 90, 180, 270].map(deg => `<line x1="20" y1="3.5" x2="20" y2="5.5" stroke="#f5a623" stroke-width="0.6" opacity="0.6" transform="rotate(${deg} 20 20)"/>`).join('')}
    ${[0, 60, 120, 180, 240, 300].map(deg => `<path d="M 20 20 L 17.5 9.5 L 22.5 9.5 Z" fill="url(#${id}-blade)" transform="rotate(${deg} 20 20)"/>`).join('')}
    ${animated ? `<path d="M 20 20 L 20 4.5 A 15.5 15.5 0 0 1 35.5 20 Z" fill="url(#${id}-sweep)"><animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="3.6s" repeatCount="indefinite"/></path>` : ''}
    <circle cx="20" cy="20" r="3.2" fill="url(#${id}-core)"/>
    <circle cx="19" cy="19" r="0.9" fill="#fff5dc" opacity="0.85"/>
    <circle cx="32.5" cy="8" r="1.7" fill="#7ab787"/>
  </svg>`;
}
