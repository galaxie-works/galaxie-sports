'use client';

import { DEFAULT_ZONE_COLORS, STANDINGS_ZONE_TONES, type StandingsOptions } from '@galaxie/widgets';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n/client';

import { ColorField } from './theme-editor';

/**
 * Zonas da tabela de classificação: legenda liga/desliga e a cor de cada faixa (vaga direta, fase prévia,
 * segunda e terceira copa, playoff e rebaixamento). Sem cor escolhida vale a padrão; a vaga direta segue a
 * cor primária do tema até ser trocada.
 */
export function StandingsZonesEditor({
  value,
  primary,
  onChange,
}: {
  value: StandingsOptions;
  /** Cor primária do tema (padrão da vaga direta). */
  primary: string;
  onChange: (next: StandingsOptions) => void;
}) {
  const { t } = useI18n();
  const z = t.client.editor.zones;
  const colors = value.zoneColors ?? {};
  const custom = Object.keys(colors).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Field orientation="horizontal" className="items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="zones-legend">{z.legend}</FieldLabel>
          <FieldDescription>{z.legendHint}</FieldDescription>
        </div>
        <Switch
          id="zones-legend"
          checked={value.showLegend ?? true}
          onCheckedChange={(checked) => onChange({ ...value, showLegend: checked })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {STANDINGS_ZONE_TONES.map((tone) => (
          <ColorField
            key={tone}
            id={`zone-${tone}`}
            label={z.tones[tone]}
            value={colors[tone] ?? DEFAULT_ZONE_COLORS[tone] ?? primary}
            onChange={(v) => onChange({ ...value, zoneColors: { ...colors, [tone]: v } })}
          />
        ))}
      </div>

      {custom ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => onChange({ ...value, zoneColors: undefined })}>
            <RotateCcw />
            {z.reset}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
