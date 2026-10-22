'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { switchLocale, useI18n } from '@/lib/i18n/client';
import { LANGUAGES, isLocale, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

/** Sigla em chip + nome do idioma (também no campo de idioma do painel de usuários). */
export function LanguageOption({ value }: { value: Locale }) {
  const language = LANGUAGES.find((l) => l.value === value)!;
  return (
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground rounded border px-1 text-[10px] leading-4 font-medium">
        {language.short}
      </span>
      <span>{language.label}</span>
    </span>
  );
}

/**
 * Seletor de idioma no padrão do @reui/c-select-25 (sigla + rótulo), o mesmo do login do app desktop da
 * Galaxie. Trocar grava o cookie e recarrega a página no novo idioma; `onBeforeSwitch` deixa quem usa
 * guardar a preferência antes (ex.: no perfil do usuário logado).
 */
export function LanguageSelect({
  className,
  onBeforeSwitch,
}: {
  className?: string;
  onBeforeSwitch?: (next: Locale) => Promise<unknown> | void;
}) {
  const { locale, t } = useI18n();

  async function change(value: unknown) {
    if (!isLocale(value) || value === locale) return;
    try {
      await onBeforeSwitch?.(value);
    } finally {
      switchLocale(value);
    }
  }

  return (
    <Select items={LANGUAGES} value={locale} onValueChange={(v) => void change(v)}>
      <SelectTrigger className={cn('min-w-44', className)} aria-label={t.shell.language.label}>
        <SelectValue>{(value: Locale) => <LanguageOption value={value} />}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {LANGUAGES.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              <LanguageOption value={l.value} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
