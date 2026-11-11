'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ChangedFilter } from './changed-filter';
import {
  countChanged,
  effectiveMode,
  isChangedInPanel,
  type ChangedMode,
  type ChangedSource,
} from './changed';

/**
 * O que o conteúdo de uma página de Ajustes conta ao topo dela (#1072): quando os dados foram lidos (o "Atualizado"
 * do cabeçalho) e as linhas de ajuste que a página mostra (o filtro "Alterados no painel"). O cabeçalho e a barra de
 * abas ficam fora do Suspense do conteúdo; o conteúdo chega depois e conta por aqui.
 */
export interface PageChromeReport {
  /** Quando os dados da página foram lidos (ISO). */
  updatedAt?: string;
  /** Fuso de quem vê, para o "Atualizado 21:42". */
  timeZone?: string;
  /** Linhas de ajuste da página (chave e de onde vem o valor). */
  settings?: readonly ChangedSource[];
}

interface PageChromeState {
  report: PageChromeReport | null;
  setReport: (report: PageChromeReport | null) => void;
  mode: ChangedMode;
  setMode: (mode: ChangedMode) => void;
}

const PageChromeContext = createContext<PageChromeState | null>(null);

/**
 * Esconde as linhas que não foram alteradas no painel. Por `id` (a linha de ajuste tem `id` igual à chave, a âncora
 * da busca): assim o filtro vale para todo bloco da página sem que cada um precise saber dele.
 */
function HiddenRows({ keys }: { keys: readonly string[] }) {
  const css = hiddenRowsCss(keys);
  return css ? <style data-changed-filter="">{css}</style> : null;
}

/**
 * CSS que esconde as linhas das chaves. As chaves do registro já são seguras como seletor (maiúsculas, dígitos e `_`),
 * mas passam pelo `CSS.escape` mesmo assim: uma chave estranha não quebra a regra nem injeta outra. Sem `CSS.escape`
 * (servidor), fica só o que é seguro sem escape.
 */
export function hiddenRowsCss(keys: readonly string[]): string | null {
  const escape =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? (k: string) => CSS.escape(k)
      : (k: string) => (/^[A-Za-z_][\w-]*$/.test(k) ? k : null);
  const selectors = keys.map(escape).filter((k): k is string => !!k);
  return selectors.length ? `${selectors.map((k) => `#${k}`).join(',')}{display:none}` : null;
}

/** Estado do topo da página de Ajustes; monte um por página (o `SettingsArea` monta). */
export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<PageChromeReport | null>(null);
  const [mode, setMode] = useState<ChangedMode>('all');
  const value = useMemo(() => ({ report, setReport, mode, setMode }), [report, mode]);
  const settings = report?.settings ?? [];
  const current = effectiveMode(mode, countChanged(settings));
  const hidden = current === 'changed' ? settings.filter((s) => !isChangedInPanel(s)).map((s) => s.key) : [];
  return (
    <PageChromeContext value={value}>
      <HiddenRows keys={hidden} />
      {children}
    </PageChromeContext>
  );
}

/** O que o conteúdo contou (null fora de uma página de Ajustes ou antes de o conteúdo chegar). */
export const usePageChromeReport = () => useContext(PageChromeContext)?.report ?? null;

/**
 * O conteúdo conta ao topo da página quando leu os dados e quais linhas mostra. Fora de uma página de Ajustes não
 * faz nada. A lista é comparada pelo conteúdo, para um novo retrato com os mesmos valores não repintar o topo.
 */
export function useReportPageChrome({ updatedAt, timeZone, settings }: PageChromeReport) {
  const ctx = useContext(PageChromeContext);
  const setReport = ctx?.setReport;
  const signature = settings?.map((s) => `${s.key}:${s.source}`).join(' ') ?? null;
  useEffect(() => {
    if (!setReport) return;
    const rows =
      signature === null
        ? undefined
        : signature
          ? signature.split(' ').map((pair) => {
              const [key, source] = pair.split(':') as [string, ChangedSource['source']];
              return { key, source };
            })
          : [];
    setReport({ updatedAt, timeZone, ...(rows ? { settings: rows } : {}) });
    return () => setReport(null);
  }, [setReport, updatedAt, timeZone, signature]);
}

/** "Todos / Alterados no painel (N)" ligado à página; nada enquanto a página não tem linhas de ajuste. */
export function PageChangedFilter({ className }: { className?: string }) {
  const ctx = useContext(PageChromeContext);
  const settings = ctx?.report?.settings;
  if (!ctx || !settings?.length) return null;
  return (
    <ChangedFilter
      value={ctx.mode}
      onValueChange={ctx.setMode}
      count={countChanged(settings)}
      className={className}
    />
  );
}
