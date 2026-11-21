const ICONS = {
  home: 'M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.6H9.2v5.6H5A1.5 1.5 0 0 1 3.5 19z',
  doc: 'M6.5 3.5h7.8l4.2 4.2v12.8H6.5z M9.5 11.5h6 M9.5 15h6 M9.5 8h2.5',
  users: 'M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z M5 20.5c.4-3.6 3.3-5.5 7-5.5s6.6 1.9 7 5.5',
  link: 'M10.5 13.5a4 4 0 0 0 5.6.4l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.2 1.2 M13.5 10.5a4 4 0 0 0-5.6-.4l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.2-1.2',
  check: 'M5 4.5h14v15H5z M8.5 12l2.5 2.5 4.5-5',
  sparkles: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4.5 21v-2a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v2',
  edit: 'm4 16-1 5 5-1L20 8l-4-4z M14 6l4 4',
  search: 'M15.5 10a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z M14 14l6 6',
  compass: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M16 8l-2 6-6 2 2-6z',
  message: 'M4 5h16v11H10l-5 4v-4H4z',
  bulb: 'M9 18h6m-5 3h4m-5-6a6 6 0 1 1 6 0v1H9z',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7m4-7v7',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7v5l3 2',
  heart: 'M12 20 4.8 13a4.5 4.5 0 0 1 6.4-6.4l.8.9.8-.9a4.5 4.5 0 0 1 6.4 6.4z',
  folder: 'M3 6h7l2 2h9v12H3z',
  archive: 'M4 4h16v5H4z M6 9v11h12V9 M10 13h4',
  warning: 'M12 3 2.5 20h19z M12 9v4m0 3h.01',
  crown: 'm3 7 4 4 5-6 5 6 4-4-2 12H5z',
};

export function icon(name, className = 'ui-icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
