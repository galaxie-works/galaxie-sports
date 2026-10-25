import { createLucideIcon } from 'lucide-react';

/** Bola de futebol no traço do lucide (24 × 24, stroke 2), que não tem o ícone: gomo central e costuras. */
export const SoccerBall = createLucideIcon('soccer-ball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'm12 7 4.8 3.5-1.8 5.5H9l-1.8-5.5z', key: 'patch' }],
  [
    'path',
    {
      d: 'M12 7V2m4.8 8.5 4.7-1.6M15 16l2.9 4M9 16l-2.9 4m1.1-9.5L2.5 8.9',
      key: 'seams',
    },
  ],
]);
