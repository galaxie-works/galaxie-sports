import { createLucideIcon } from 'lucide-react';

/** Bola de basquete no traço do lucide (24 × 24, stroke 2), que não tem o ícone: gomos em cruz e curvas laterais. */
export const Basketball = createLucideIcon('basketball', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M12 2v20M2 12h20', key: 'cross' }],
  [
    'path',
    { d: 'M4.9 4.9C7 7 8 9.5 8 12s-1 5-3.1 7.1M19.1 4.9C17 7 16 9.5 16 12s1 5 3.1 7.1', key: 'sides' },
  ],
]);
