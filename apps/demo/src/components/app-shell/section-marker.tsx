'use client';

import { useEffect } from 'react';

import { setActiveSection } from '@/lib/active-section';

/** Marca na sidebar o item de topo da página (ver lib/active-section.ts). */
export function SectionMarker({ href }: { href: string }) {
  useEffect(() => {
    setActiveSection(href);
    return () => setActiveSection(null);
  }, [href]);
  return null;
}
