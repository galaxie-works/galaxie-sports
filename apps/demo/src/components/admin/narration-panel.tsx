'use client';

import {
  NARRATION_CATALOG,
  NARRATION_GROUPS,
  NARRATION_KEYS,
  NARRATION_LANGS,
  cleanNarrationVariants,
  validateNarration,
  type NarrationKey,
  type NarrationLang,
} from '@galaxie/contracts';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveNarrationAction } from '@/app/[locale]/(app)/ajustes/lance-a-lance/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface NarrationTemplateView {
  key: NarrationKey;
  lang: NarrationLang;
  variants: string[];
  version: number;
  updatedAt: string;
}

export interface NarrationLogView {
  key: string;
  lang: string;
  action: 'set' | 'reset';
  variants: string[] | null;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

/** Prévia com os valores de exemplo do dicionário (um jogo qualquer, só para ver a frase montada). */
const preview = (text: string, sample: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => sample[k] ?? m);

/**
 * Ajustes → Produtos → Lance a lance (#1167): as frases prontas da narração por grupo, no idioma escolhido, com a
 * edição de cada uma (variações, marcadores, prévia, voltar ao padrão) e o histórico.
 */
export function NarrationPanel({
  templates,
  log,
  timeZone,
}: {
  templates: NarrationTemplateView[];
  log: NarrationLogView[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.narrationAdmin;
  const f = useFormatters(timeZone);
  const [lang, setLang] = useState<NarrationLang>('pt');
  const [editing, setEditing] = useState<NarrationKey | null>(null);
  const edited = useMemo(() => new Map(templates.map((r) => [`${r.key}:${r.lang}`, r])), [templates]);
  const current = (key: NarrationKey) => edited.get(`${key}:${lang}`) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel>
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
            <div className="flex max-w-3xl flex-col gap-1">
              <FrameTitle>{T.intro.title}</FrameTitle>
              <FrameDescription>{T.intro.description}</FrameDescription>
            </div>
            <ToggleGroup
              value={[lang]}
              onValueChange={(v: string[]) => {
                const next = v[0] as NarrationLang | undefined;
                if (next) setLang(next);
              }}
              aria-label={T.intro.language}
              variant="outline"
              size="sm"
            >
              {NARRATION_LANGS.map((l) => (
                <ToggleGroupItem key={l} value={l}>
                  {T.langs[l]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FrameHeader>
        </FramePanel>
      </Frame>

      {NARRATION_GROUPS.map((group) => {
        const keys = NARRATION_KEYS.filter((k) => NARRATION_CATALOG[k].group === group);
        return (
          <Frame key={group}>
            <FramePanel className="p-0">
              <FrameHeader className="p-4">
                <FrameTitle>{T.groups[group]}</FrameTitle>
              </FrameHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-64">{T.table.phrase}</TableHead>
                    <TableHead>{T.table.text}</TableHead>
                    <TableHead className="w-28">{T.table.status}</TableHead>
                    <TableHead className="sr-only">{T.table.edit}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => {
                    const row = current(key);
                    const variants = row?.variants ?? NARRATION_CATALOG[key].defaults[lang];
                    return (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{T.keys[key]}</TableCell>
                        <TableCell className="text-sm">
                          {variants[0]}
                          {variants.length > 1 ? (
                            <span className="text-muted-foreground ml-2 text-xs">
                              {fill(T.table.variants, { count: variants.length - 1 })}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {row ? (
                            <Badge variant="primary-light" size="sm">
                              {T.table.edited}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" size="sm">
                              {T.table.default}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(key)}
                            aria-label={`${T.table.edit}: ${T.keys[key]}`}
                          >
                            <Pencil />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </FramePanel>
          </Frame>
        );
      })}

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{T.log.title}</FrameTitle>
            <FrameDescription>{T.log.description}</FrameDescription>
          </FrameHeader>
          {log.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.log.what}</TableHead>
                  <TableHead>{T.log.when}</TableHead>
                  <TableHead>{T.log.who}</TableHead>
                  <TableHead>{T.log.reason}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((l, idx) => (
                  <TableRow key={`${l.key}:${l.lang}:${l.changedAt}:${idx}`}>
                    <TableCell className="text-xs">
                      {(T.keys as Record<string, string>)[l.key] ?? l.key} ·{' '}
                      {(T.langs as Record<string, string>)[l.lang] ?? l.lang} ·{' '}
                      {l.action === 'set' ? T.log.set : T.log.reset}
                    </TableCell>
                    <TableCell className="text-xs">{f.relative(l.changedAt)}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{l.changedBy}</TableCell>
                    <TableCell className="text-xs">{l.reason ?? T.log.noReason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{T.log.empty}</p>
          )}
        </FramePanel>
      </Frame>

      {editing ? (
        <NarrationDialog
          key={`${editing}:${lang}:${current(editing)?.version ?? 0}`}
          phraseKey={editing}
          lang={lang}
          current={current(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function NarrationDialog({
  phraseKey,
  lang,
  current,
  onClose,
}: {
  phraseKey: NarrationKey;
  lang: NarrationLang;
  current: NarrationTemplateView | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.narrationAdmin;
  const F = T.form;
  const router = useRouter();
  const [pending, start] = useTransition();
  const entry = NARRATION_CATALOG[phraseKey];
  const defaults = entry.defaults[lang];
  const [text, setText] = useState((current?.variants ?? defaults).join('\n'));
  const [reason, setReason] = useState('');
  const variants = cleanNarrationVariants(text.split('\n'));
  const problems = validateNarration(phraseKey, variants);
  const problemText = problems.map((p) => {
    const line = 'variant' in p ? p.variant + 1 : 1;
    return p.code === 'unknown_placeholder'
      ? fill(T.errors.unknown_placeholder, { line, placeholder: `{${p.placeholder}}` })
      : fill(T.errors[p.code], { line });
  });

  const send = (next: string[] | null) =>
    start(async () => {
      const r = await saveNarrationAction({
        key: phraseKey,
        lang,
        variants: next,
        expectedVersion: current?.version ?? null,
        reason,
      });
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      toast.success(next ? F.saved : F.resetDone);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{fill(F.title, { phrase: T.keys[phraseKey], lang: T.langs[lang] })}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="narration-variants">{F.variants}</FieldLabel>
            <Textarea
              id="narration-variants"
              rows={Math.min(8, Math.max(3, variants.length + 1))}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={problems.length ? true : undefined}
            />
            {problemText.length ? (
              <FieldDescription className="text-destructive">{problemText[0]}</FieldDescription>
            ) : (
              <FieldDescription>{fill(F.defaultText, { text: defaults.join(' / ') })}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel>{F.placeholders}</FieldLabel>
            {entry.placeholders.length ? (
              <div className="flex flex-wrap gap-2">
                {entry.placeholders.map((p) => (
                  <Badge key={p} variant="secondary" size="sm" className="font-mono">
                    {`{${p}}`} · {(T.placeholders as Record<string, string>)[p] ?? p}
                  </Badge>
                ))}
              </div>
            ) : (
              <FieldDescription>{F.noPlaceholders}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel>{F.preview}</FieldLabel>
            <ul className="bg-muted/40 flex flex-col gap-1 rounded-md border p-3 text-sm">
              {(variants.length ? variants : defaults).map((v, i) => (
                <li key={i}>{preview(v, T.sample)}</li>
              ))}
            </ul>
          </Field>
          <Field>
            <FieldLabel htmlFor="narration-reason">{F.reason}</FieldLabel>
            <Input
              id="narration-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter className="gap-2">
          {current ? (
            <Button variant="outline" disabled={pending} onClick={() => send(null)}>
              {F.reset}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {F.cancel}
          </Button>
          <Button disabled={pending || problems.length > 0} onClick={() => send(variants)}>
            {pending ? <Spinner /> : null}
            {F.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
