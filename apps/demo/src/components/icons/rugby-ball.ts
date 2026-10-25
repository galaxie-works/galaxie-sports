import { createLucideIcon } from 'lucide-react';

/**
 * Bola de rúgbi no traço do lucide (24 × 24, stroke 2): oval na diagonal com as costuras dos gomos de ponta a
 * ponta. O `RugbyBall` do lucide tem cadarço (é a bola do futebol americano), por isso este fica à parte.
 */
export const RugbyBall = createLucideIcon('rugby-ball-seams', [
  ['ellipse', { cx: '12', cy: '12', rx: '10.5', ry: '6.5', transform: 'rotate(-45 12 12)', key: 'ball' }],
  ['path', { d: 'M4.6 19.4Q9 9 19.4 4.6', key: 'seam-top' }],
  ['path', { d: 'M4.6 19.4Q15 15 19.4 4.6', key: 'seam-bottom' }],
]);
