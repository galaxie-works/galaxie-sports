'use client';

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useI18n } from '@/lib/i18n/client';

/**
 * Créditos usados por dia: o gráfico de barras do exemplo ReUI c-chart-1 (cópia fiel em
 * `components/examples/c-chart-1.tsx`), com os dados da carteira no lugar da receita de exemplo. O dia vem
 * em UTC (AAAA-MM-DD); o rótulo sai no idioma da tela.
 */
export function UsageChart({
  title,
  description,
  data,
  empty,
}: {
  title: string;
  description: string;
  data: { day: string; credits: number }[];
  empty: string;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const n = new Intl.NumberFormat(locale);
  const short = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const date = (day: string) => new Date(`${day}T00:00:00Z`);
  const chartConfig = { credits: { label: T.credits, color: 'var(--chart-1)' } } satisfies ChartConfig;
  const total = data.reduce((sum, d) => sum + d.credits, 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{total > 0 ? description : empty}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
              tickFormatter={(value: string) => short.format(date(value))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  className="min-w-40 gap-2.5"
                  labelFormatter={(value) => (
                    <div className="border-border/50 mb-0.5 flex flex-col gap-0.5 border-b pb-2">
                      <span className="text-xs font-medium">{long.format(date(String(value)))}</span>
                    </div>
                  )}
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="bg-chart-1 h-2.5 w-2.5 shrink-0 rounded-xs" />
                        <span className="text-muted-foreground">{chartConfig.credits.label}</span>
                      </div>
                      <span className="text-foreground font-semibold">{n.format(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="credits" fill="var(--color-credits)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
