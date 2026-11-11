'use client';

import { useState } from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { countChanged, effectiveMode, showSetting, type ChangedMode, type ChangedSource } from './changed';

/**
 * "Todos / Alterados no painel (N)" (#1072), na barra de abas da moldura. Com zero alterados, fica desabilitado e
 * diz "Nenhum alterado". Controlado: a página guarda o modo (estado ou URL) e esconde as linhas com `showSetting`.
 */
export function ChangedFilter({
  value,
  onValueChange,
  count,
  className,
}: {
  value: ChangedMode;
  onValueChange: (mode: ChangedMode) => void;
  count: number;
  className?: string;
}) {
  const { t } = useI18n();
  const T = t.ops.pageChrome.filter;
  const none = count === 0;
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[effectiveMode(value, count)]}
      onValueChange={(next) => {
        // o grupo não fica sem escolha: clicar no já escolhido não desmarca
        const mode = next[0] as ChangedMode | undefined;
        if (mode) onValueChange(mode);
      }}
      disabled={none}
      aria-label={T.label}
      title={none ? T.none : T.hint}
      className={className}
    >
      <ToggleGroupItem value="all">{T.all}</ToggleGroupItem>
      <ToggleGroupItem value="changed" className="tabular-nums">
        {none ? T.none : fill(T.changed, { count })}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * Estado do filtro numa página cliente: o modo, quantas linhas foram alteradas e se uma linha aparece. Sem
 * alteradas, o modo volta a "Todos".
 */
export function useChangedFilter(settings: readonly ChangedSource[], keys?: readonly string[]) {
  const [mode, setMode] = useState<ChangedMode>('all');
  const count = countChanged(settings, keys);
  const current = effectiveMode(mode, count);
  return {
    mode: current,
    setMode,
    count,
    visible: (s: ChangedSource) => showSetting(s, current),
  };
}
