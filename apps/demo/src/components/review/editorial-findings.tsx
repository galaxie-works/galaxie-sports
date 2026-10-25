'use client';

/**
 * Achados do validador no perfil editorial da F1: cada campo com achado aparece com o texto inteiro e o trecho
 * destacado na cor da gravidade (vermelho = grave, âmbar = alerta), e abaixo o motivo de cada achado. O revisor
 * aprova, edita (sugestão) ou recusa (volta a rascunho) com as ações do painel, como em qualquer item.
 */
import { Badge } from '@/components/reui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/client';
import { plural } from '@/lib/i18n/text';
import {
  fieldText,
  findingCounts,
  findingsByField,
  findingsOf,
  parseField,
  segments,
  type Finding,
} from '@/lib/review/findings';
import { cn } from '@/lib/utils';

const MARK = {
  severe:
    'bg-destructive/20 text-foreground underline decoration-destructive decoration-2 underline-offset-2',
  alert: 'bg-warning/25 text-foreground underline decoration-warning decoration-dotted underline-offset-2',
} as const;

export function EditorialFindings({ content }: { content: Record<string, unknown> }) {
  const { t, locale } = useI18n();
  const T = t.review.findings;
  const counts = findingCounts(content);
  if (!counts) return null;
  const label = (field: string) => {
    const p = parseField(field);
    if (!p) return field;
    const name = T.parts[p.part] ?? p.part;
    return `${name}${p.index != null ? ` ${p.index + 1}` : ''}${p.source ? ` · ${T.source}` : ''}`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {T.title}
          {counts.severe ? (
            <Badge variant="destructive-light">{plural(locale, counts.severe, T.severe)}</Badge>
          ) : null}
          {counts.alert ? (
            <Badge variant="warning-light">{plural(locale, counts.alert, T.alert)}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{T.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {findingsByField(findingsOf(content)).map(([field, list]) => (
          <FieldFindings key={field} label={label(field)} text={fieldText(content, field)} findings={list} />
        ))}
      </CardContent>
    </Card>
  );
}

function FieldFindings({
  label,
  text,
  findings,
}: {
  label: string;
  text: string | null;
  findings: Finding[];
}) {
  const { t } = useI18n();
  const T = t.review.findings;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      {text ? (
        <p className="bg-muted/40 rounded-md border p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {segments(text, findings).map((s, i) =>
            s.severity ? (
              <mark
                key={i}
                className={cn('rounded-sm px-0.5', MARK[s.severity])}
                title={s.findings.map((f) => f.reason).join(' · ')}
              >
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm">
        {/* o grave primeiro, depois na ordem do texto */}
        {[...findings]
          .sort((a, b) => (a.severity === b.severity ? a.start - b.start : a.severity === 'severe' ? -1 : 1))
          .map((f, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2">
              <Badge variant={f.severity === 'severe' ? 'destructive-light' : 'warning-light'} size="sm">
                {f.severity === 'severe' ? T.severeLabel : T.alertLabel}
              </Badge>
              <span>{f.reason}</span>
              {text && f.end > f.start && !(f.start === 0 && f.end >= text.length) ? (
                <span className="text-muted-foreground text-xs">“{text.slice(f.start, f.end)}”</span>
              ) : text && f.end > f.start ? (
                <span className="text-muted-foreground text-xs">({T.whole})</span>
              ) : null}
            </li>
          ))}
      </ul>
    </section>
  );
}
