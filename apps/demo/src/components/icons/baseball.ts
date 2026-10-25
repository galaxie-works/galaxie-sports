import { createLucideIcon } from 'lucide-react';

/** Bola de beisebol no traço do lucide (24 × 24, stroke 2), que não tem o ícone: duas costuras com pontos. */
export const Baseball = createLucideIcon('baseball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M5 4.9c2.9 3.9 2.9 10.3 0 14.2M19 4.9c-2.9 3.9-2.9 10.3 0 14.2', key: 'seams' }],
  [
    'path',
    {
      d: 'm5.3 8.6 2-.8m-1.4 4.2h2.1m-2.7 3.4 2 .8M18.7 8.6l-2-.8m1.4 4.2h-2.1m2.7 3.4-2 .8',
      key: 'stitches',
    },
  ],
]);
