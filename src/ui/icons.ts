const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  pencil: svg('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  brush: svg('<path d="M20 4c-4 2-8 6-10 9l2 2c3-2 7-6 8-11z"/><path d="M9 14c-3 0-4 2-4 4 0 1-1 2-2 2 3 1 7 0 8-3z"/>'),
  eraser: svg('<path d="M4 15l9-9 6 6-7 7H8z"/><path d="M9 10l6 6"/><path d="M12 19h8"/>'),
  fill: svg('<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15c1 2 1.5 3 1.5 3.6a1.5 1.5 0 0 1-3 0c0-.6.5-1.6 1.5-3.6z"/>'),
  eyedropper: svg('<path d="M14 4l6 6-2 2-6-6z"/><path d="M13 7l-8 8v4h4l8-8"/>'),
  line: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>'),
  polyline: svg('<path d="M3 18l5-9 6 5 7-9"/><circle cx="3" cy="18" r="1.2"/><circle cx="8" cy="9" r="1.2"/><circle cx="14" cy="14" r="1.2"/><circle cx="21" cy="5" r="1.2"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="0.5"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  newFile: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>'),
  open: svg('<path d="M3 7V5h7l2 2h9v12H3z"/>'),
  save: svg('<path d="M5 3h12l4 4v14H3V3z"/><path d="M7 3v6h9V3"/><path d="M7 21v-7h10v7"/>'),
  spawn: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.3 6.3C3.6 8.1 2 12 2 12s4 7 10 7c1.8 0 3.4-.6 4.7-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>'),
};
