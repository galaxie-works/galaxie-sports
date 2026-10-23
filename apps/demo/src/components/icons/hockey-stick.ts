import { createLucideIcon } from 'lucide-react';

/** Taco e disco de hóquei no traço do lucide (24 × 24, stroke 2), que não tem ícone do esporte. */
export const HockeyStick = createLucideIcon('hockey-stick', [
  ['path', { d: 'M18 3 10.5 17', key: 'shaft' }],
  ['path', { d: 'M3 17h7.5l-1.4 2.8a1 1 0 0 1-.9.7H4a1 1 0 0 1-1-1z', key: 'blade' }],
  ['ellipse', { cx: '18', cy: '18', rx: '3', ry: '1.5', key: 'puck-top' }],
  ['path', { d: 'M15 18v1.5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5V18', key: 'puck-side' }],
]);
