import { SettingsShell } from '@/components/admin/settings-shell';
import { settingsNavCounts } from '@/lib/ops/nav-counts';

/**
 * Moldura de Ajustes (#1067): o menu do app recolhe e o menu de Ajustes vira a segunda coluna. As contagens do menu
 * não são aguardadas aqui: chegam por streaming, sem segurar a página.
 */
export default function SettingsLayout({ children }: LayoutProps<'/[locale]/ajustes'>) {
  return <SettingsShell counts={settingsNavCounts()}>{children}</SettingsShell>;
}
