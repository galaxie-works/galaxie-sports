'use client';

import { Check, ImageUp, Moon, Pencil, Plus, Save, Sun, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  createLineupItem,
  editLineupItem,
  revertLineupLogo,
  uploadLineupLogo,
} from '@/app/[locale]/(app)/ajustes/grades/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { fill } from '@/lib/i18n/text';
import {
  CREATABLE_TYPES,
  FIELD_MAX,
  LOGO_MAX_KB,
  LOGO_MIN_PX,
  MANUAL_ACCESS,
  MANUAL_FIELDS,
  PLATFORM_KINDS,
  libraryTargetType,
  type CreatableType,
  type ItemView,
  type LogoTargetView,
  type LogoVariant,
} from '@/lib/lineup/types';

type Result = { ok: boolean; error?: string };

/** Exemplo de endereço nos campos de URL (não é texto traduzível). */
const URL_PLACEHOLDER = 'https://';

/** Roda a ação; erro fica no diálogo, sucesso fecha, avisa e recarrega os dados da página. */
function useAction(onDone: () => void) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, done: string) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void setError(res.error ?? t.lineup.errors.generic);
      toast.success(done);
      onDone();
      router.refresh();
    });
  };
  return { run, error, setError, pending };
}

/** Select do projeto com rótulos (o `items` dá o texto do valor escolhido). */
function Choice({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v == null ? '' : String(v))} items={options}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const asText = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** Campo da grade: select para tipo e acesso, texto para o resto (preço aceita vírgula). */
function ManualInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const M = t.lineup.admin.manual;
  if (field === 'kind')
    return (
      <Choice
        id={id}
        value={value}
        onChange={onChange}
        placeholder={M.choose}
        options={PLATFORM_KINDS.map((k) => ({ value: k, label: t.lineup.kinds[k] }))}
      />
    );
  if (field === 'access')
    return (
      <Choice
        id={id}
        value={value}
        onChange={onChange}
        placeholder={M.choose}
        options={MANUAL_ACCESS.map((a) => ({ value: a, label: t.lineup.access[a] }))}
      />
    );
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(field === 'priceCurrency' ? e.target.value.toUpperCase() : e.target.value)}
      maxLength={field === 'priceCurrency' ? 3 : field === 'url' || field === 'website' ? 1000 : FIELD_MAX}
      inputMode={
        field === 'priceAmount' ? 'decimal' : field === 'url' || field === 'website' ? 'url' : undefined
      }
      placeholder={
        field === 'priceCurrency' ? 'BRL' : field === 'url' || field === 'website' ? URL_PLACEHOLDER : ''
      }
    />
  );
}

function SourceUrlField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const M = t.lineup.admin.manual;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{M.sourceUrl}</FieldLabel>
      <Input
        id={id}
        inputMode="url"
        placeholder={URL_PLACEHOLDER}
        maxLength={1000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldDescription>{M.sourceUrlHint}</FieldDescription>
    </Field>
  );
}

/** Logo sobre um fundo (claro ou escuro), para conferir o contraste antes de enviar. */
function LogoSwatch({ url, dark, label }: { url: string | null; dark: boolean; label: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <div
        className={cn(
          'flex h-14 w-24 items-center justify-center rounded-md border p-2',
          dark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-white',
        )}
      >
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : null}
      </div>
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
    </figure>
  );
}

/**
 * Enviar o logo da operadora ou do canal (PNG ou SVG), para fundo claro ou para o tema escuro, e voltar
 * ao anterior. A prévia mostra como cada um sai hoje; sem versão escura, o claro sai sobre uma placa clara.
 */
export function LogoUploader({
  target,
  storageEnabled,
}: {
  target: LogoTargetView;
  storageEnabled: boolean;
}) {
  const { t } = useI18n();
  const L = t.lineup.admin.manual.logo;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [variant, setVariant] = useState<LogoVariant>('light');
  const { run, error, pending } = useAction(() => {
    setFile(null);
    if (input.current) input.current.value = '';
  });
  const id = `logo-${target.type}-${target.id}`;
  const logo = target.logo ?? null;
  const logoDark = target.logoDark ?? null;
  const upload = () => {
    if (!file) return;
    const form = new FormData();
    form.set('targetType', target.type);
    form.set('targetId', target.id);
    form.set('variant', variant);
    form.set('file', file);
    run(() => uploadLineupLogo(form), variant === 'dark' ? L.uploadedDark : L.uploaded);
  };
  const canRevert = variant === 'dark' ? target.customDark === true : target.custom;
  return (
    <FieldSet>
      <FieldLegend variant="label">{fill(L.title, { target: L.targets[target.type] })}</FieldLegend>
      <FieldDescription>{fill(L.hint, { min: LOGO_MIN_PX, kb: LOGO_MAX_KB })}</FieldDescription>
      {logo || logoDark ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{L.preview}</span>
          <div className="flex flex-wrap gap-3">
            <LogoSwatch url={logo ?? logoDark} dark={false} label={L.onLight} />
            {logoDark ? (
              <LogoSwatch url={logoDark} dark label={L.onDark} />
            ) : (
              <figure className="flex flex-col gap-1">
                <div className="flex h-14 w-24 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 p-2">
                  <span className="flex size-full items-center justify-center rounded-sm bg-white p-1">
                    <img src={logo!} alt="" className="max-h-full max-w-full object-contain" />
                  </span>
                </div>
                <figcaption className="text-muted-foreground text-xs">{L.onDark}</figcaption>
              </figure>
            )}
          </div>
          {!logoDark ? <p className="text-muted-foreground text-xs">{L.darkMissing}</p> : null}
        </div>
      ) : null}
      {storageEnabled ? (
        <>
          <Field>
            <FieldLabel>{L.variant}</FieldLabel>
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[variant]}
              onValueChange={(next) => {
                const v = next[0];
                if (v === 'light' || v === 'dark') setVariant(v);
              }}
            >
              <ToggleGroupItem value="light">
                <Sun />
                {L.variants.light}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" disabled={!logo}>
                <Moon />
                {L.variants.dark}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={id} className="sr-only">
              {L.file}
            </FieldLabel>
            <Input
              ref={input}
              id={id}
              type="file"
              accept="image/png,image/svg+xml,.png,.svg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!file || pending} onClick={upload}>
              {pending ? <Spinner /> : <ImageUp />}
              {L.upload}
            </Button>
            {canRevert ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(() => revertLineupLogo({ type: target.type, id: target.id, variant }), L.reverted)
                }
              >
                <Undo2 />
                {variant === 'dark' ? L.revertDark : L.revert}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{L.unavailable}</p>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </FieldSet>
  );
}

/**
 * Editar um item à mão: os campos do tipo, a URL da fonte e, no canal, tirar do plano. Salvar deixa a
 * edição pendente (aprovar publica); "Salvar e aprovar" faz os dois. No mesmo diálogo, o logo.
 */
export function ManualEditDialog({
  row,
  storageEnabled,
  timeZone,
}: {
  row: ItemView;
  storageEnabled: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const M = t.lineup.admin.manual;
  const f = useFormatters(timeZone);
  const fields = MANUAL_FIELDS[row.type] as readonly string[];
  const initial = () => Object.fromEntries(fields.map((k) => [k, asText(row.edit?.[k])]));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [sourceUrl, setSourceUrl] = useState('');
  const [removed, setRemoved] = useState(false);
  const removable = row.type === 'plan_channel' || row.type === 'plan_service';
  const { run, error, setError, pending } = useAction(() => setOpen(false));
  const reset = () => {
    setValues(initial());
    setSourceUrl('');
    setRemoved(false);
    setError(null);
  };
  const save = (approve: boolean) =>
    run(
      () =>
        editLineupItem(
          { type: row.type, id: row.id },
          {
            // só o que mudou em relação ao dado atual
            fields: Object.fromEntries(
              fields.filter((k) => values[k] !== asText(row.edit?.[k])).map((k) => [k, values[k]]),
            ),
            removed,
            sourceUrl,
            approve,
          },
        ),
      approve ? M.savedApproved : removed ? M.removed : M.saved,
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="icon-sm" variant="outline" aria-label={`${M.edit}: ${row.name}`} title={M.edit} />
        }
      >
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fill(M.editTitle, { type: t.lineup.types[row.type].toLowerCase() })}</DialogTitle>
          <DialogDescription>
            <span className="text-foreground font-medium">{row.name}</span> · {M.editDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <FieldGroup>
            <FieldSet disabled={removed}>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((k) => {
                  const id = `manual-${row.type}-${k}`;
                  const by = row.manual?.fields[k];
                  return (
                    <Field
                      key={k}
                      className={k === 'url' || k === 'website' || k === 'name' ? 'sm:col-span-2' : undefined}
                    >
                      <FieldLabel htmlFor={id}>
                        {(t.lineup.fields as Record<string, string>)[k] ?? M.kind}
                      </FieldLabel>
                      <ManualInput
                        id={id}
                        field={k}
                        value={values[k] ?? ''}
                        onChange={(v) => setValues((p) => ({ ...p, [k]: v }))}
                      />
                      {by ? (
                        <FieldDescription>
                          {M.badge} ·{' '}
                          {fill(t.lineup.admin.decidedBy, { who: by.by, when: f.relative(by.at) })}
                        </FieldDescription>
                      ) : null}
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
            {removable ? (
              <Field orientation="horizontal">
                <Checkbox
                  id={`manual-removed-${row.id}`}
                  checked={removed}
                  onCheckedChange={(v) => setRemoved(v === true)}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor={`manual-removed-${row.id}`}>{M.removeFromPlan}</FieldLabel>
                  <FieldDescription>{M.removeHint}</FieldDescription>
                </div>
              </Field>
            ) : null}
            <SourceUrlField id={`manual-source-${row.type}`} value={sourceUrl} onChange={setSourceUrl} />
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? <Spinner /> : <Save />}
              {M.save}
            </Button>
            <Button type="button" disabled={pending} onClick={() => save(true)}>
              {pending ? <Spinner /> : <Check />}
              {M.saveApprove}
            </Button>
          </DialogFooter>
        </form>
        {row.logoTarget ? (
          <>
            <Separator />
            <LogoUploader target={row.logoTarget} storageEnabled={storageEnabled} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface CreateOptions {
  platforms: { id: string; name: string; country: string }[];
  plans: { id: string; name: string; platformId: string }[];
  library: { id: string; name: string; kind: string; countries: string[] }[];
}

/** Campos do item novo por tipo (os mesmos que o banco aceita em `createManualLineupItem`). */
const CREATE_FIELDS: Record<CreatableType, readonly string[]> = {
  platform: ['name', 'kind', 'country', 'website'],
  plan: ['platformId', 'name', 'priceText', 'priceAmount', 'priceCurrency', 'url'],
  plan_channel: ['planId', 'refId', 'access'],
  plan_service: ['planId', 'refId', 'access'],
  addon: [
    'platformId',
    'refId',
    'addonKind',
    'name',
    'channel',
    'priceText',
    'priceAmount',
    'priceCurrency',
    'commitmentMonths',
    'url',
  ],
};

/** Criar um item da grade à mão: operadora, plano, canal ou streaming num plano, complemento. */
export function CreateItemDialog({ options }: { options: CreateOptions }) {
  const { t } = useI18n();
  const M = t.lineup.admin.manual;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CreatableType>('plan_channel');
  const [values, setValues] = useState<Record<string, string>>({});
  const [sourceUrl, setSourceUrl] = useState('');
  const { run, error, setError, pending } = useAction(() => setOpen(false));
  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const reset = () => {
    setValues({ access: 'included', addonKind: 'service' });
    setSourceUrl('');
    setError(null);
  };
  const plan = options.plans.find((p) => p.id === values.planId);
  const platformOf = (id: string | undefined) => options.platforms.find((p) => p.id === id);
  const country = platformOf(
    type === 'plan_channel' || type === 'plan_service' ? plan?.platformId : values.platformId,
  )?.country;
  // canal de TV num plano, streaming como incluso; complemento aceita os dois; só do país da plataforma
  const library = options.library.filter(
    (e) =>
      (!country || e.countries.includes(country)) && (type === 'addon' || libraryTargetType(e.kind) === type),
  );
  const label = (k: string): string =>
    ({
      platformId: M.platform,
      planId: M.plan,
      refId: M.channel,
      country: M.country,
      kind: M.kind,
      addonKind: M.addonKind,
      channel: M.addonChannel,
      commitmentMonths: M.commitment,
    })[k] ??
    (t.lineup.fields as Record<string, string>)[k] ??
    k;
  const input = (k: string) => {
    const id = `create-${k}`;
    const value = values[k] ?? '';
    if (k === 'platformId')
      return (
        <Choice
          id={id}
          value={value}
          onChange={(v) => set(k, v)}
          placeholder={M.choose}
          options={options.platforms.map((p) => ({ value: p.id, label: `${p.name} (${p.country})` }))}
        />
      );
    if (k === 'planId')
      return (
        <Choice
          id={id}
          value={value}
          onChange={(v) => set(k, v)}
          placeholder={M.choose}
          options={options.plans.map((p) => ({
            value: p.id,
            label: `${p.name} · ${platformOf(p.platformId)?.name ?? ''}`,
          }))}
        />
      );
    if (k === 'refId')
      return (
        <Choice
          id={id}
          value={value}
          onChange={(v) => set(k, v)}
          placeholder={M.choose}
          options={library.map((e) => ({ value: e.id, label: e.name }))}
        />
      );
    if (k === 'addonKind')
      return (
        <Choice
          id={id}
          value={value}
          onChange={(v) => set(k, v)}
          placeholder={M.choose}
          options={(['service', 'channel'] as const).map((x) => ({ value: x, label: M.addonKinds[x] }))}
        />
      );
    if (k === 'country')
      return (
        <Input
          id={id}
          maxLength={2}
          placeholder="BR"
          value={value}
          onChange={(e) => set(k, e.target.value.toUpperCase())}
        />
      );
    if (k === 'commitmentMonths')
      return <Input id={id} inputMode="numeric" value={value} onChange={(e) => set(k, e.target.value)} />;
    return <ManualInput id={id} field={k} value={value} onChange={(v) => set(k, v)} />;
  };
  const save = (approve: boolean) =>
    run(
      () => createLineupItem({ type, ...values }, { sourceUrl, approve }),
      approve ? M.createdApproved : M.created,
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        {M.create}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{M.createTitle}</DialogTitle>
          <DialogDescription>{M.createDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="create-type">{M.type}</FieldLabel>
              <Choice
                id="create-type"
                value={type}
                onChange={(v) => {
                  setType((v || 'plan_channel') as CreatableType);
                  set('refId', '');
                }}
                placeholder={M.choose}
                options={CREATABLE_TYPES.map((x) => ({ value: x, label: t.lineup.types[x] }))}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {CREATE_FIELDS[type].map((k) => (
                <Field
                  key={`${type}-${k}`}
                  className={
                    ['name', 'url', 'website', 'planId', 'platformId', 'refId'].includes(k)
                      ? 'sm:col-span-2'
                      : undefined
                  }
                >
                  <FieldLabel htmlFor={`create-${k}`}>{label(k)}</FieldLabel>
                  {input(k)}
                </Field>
              ))}
            </div>
            <SourceUrlField id="create-source" value={sourceUrl} onChange={setSourceUrl} />
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? <Spinner /> : <Save />}
              {M.save}
            </Button>
            <Button type="button" disabled={pending} onClick={() => save(true)}>
              {pending ? <Spinner /> : <Check />}
              {M.saveApprove}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
