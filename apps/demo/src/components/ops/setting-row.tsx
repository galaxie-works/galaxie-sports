'use client';

import { Badge } from '@/components/reui/badge';
import { useI18n } from '@/lib/i18n/client';
import type { OpsSetting } from '@/lib/ops/types';

/** A linha de ajuste mora nos blocos de Ajustes (padrão settings-3, #1074); aqui fica o nome antigo. */
export { SettingRow, type SettingRowProps } from '@/components/settings/blocks/setting-row';
export { useOpsAction } from './use-ops-action';

const SOURCE_VARIANT = {
  db: 'primary-light',
  env: 'info-light',
  default: 'secondary',
} as const;

export function SourceBadge({ source }: { source: OpsSetting['source'] }) {
  const { t } = useI18n();
  return (
    <Badge variant={SOURCE_VARIANT[source]} title={t.ops.source.label}>
      {t.ops.source[source]}
    </Badge>
  );
}
