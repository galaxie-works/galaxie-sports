'use client';

import { settingDef } from '@galaxie/runtime-config';
import { type ColumnDef, useTable } from '@tanstack/react-table';
import { Pencil, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { displayValue } from '@/components/ops/format';
import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { groupJobs, type JobArea } from '@/lib/ops/job-areas';
import type { JobStatus, OpsSetting } from '@/lib/ops/types';

import { isChanged } from './logic';
import { SettingRow } from './setting-row';
import { useHash } from './use-hash';

/**
 * Tira o hash da URL sem navegar (mantém o estado do histórico, que o roteador do Next usa) e avisa quem lê o hash:
 * o `replaceState` não dispara `hashchange` sozinho.
 */
function clearHash() {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export interface JobRow {
  job: string;
  key: string;
  label: string;
  setting: OpsSetting;
  status: JobStatus;
}

const CRON_OFF = new Set(['off', 'false', 'disabled', '0']);

/**
 * Agenda dos jobs em `data-grid` (#1075): busca no topo e uma tabela por área (ao vivo, dados, IA, conteúdo,
 * manutenção), com job, agenda, estado e última execução. "Editar agenda" abre a linha de ajuste de sempre num
 * diálogo: o salvamento é o mesmo, uma chave por vez. O link com a chave no hash já abre o diálogo dela; fechar tira
 * o hash da URL, para o mesmo link abrir de novo.
 */
export function JobsGrid({
  rows,
  timeZone,
  now,
  lastRun,
  runNow,
  footer,
}: {
  rows: readonly JobRow[];
  timeZone: string;
  now: string;
  /** Última execução do job (o resumo que o painel já mostra). */
  lastRun: (job: JobStatus) => ReactNode;
  /** "Rodar agora", quando o job permite. */
  runNow: (job: JobStatus) => ReactNode;
  /** Abaixo das tabelas (os outros ajustes da agenda). */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks.jobs;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const hash = useHash();
  const fromHash = rows.some((r) => r.key === hash) ? hash : null;
  const openKey = editing ?? fromHash;
  const open = rows.find((r) => r.key === openKey) ?? null;
  const groups = groupJobs(rows, query);

  return (
    <Frame stacked>
      <FrameHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FrameTitle>{B.title}</FrameTitle>
          <FrameDescription>{B.description}</FrameDescription>
        </div>
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={B.search}
            aria-label={B.searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      </FrameHeader>
      {groups.length ? (
        groups.map((g) => (
          <AreaGrid
            key={g.area}
            area={g.area}
            rows={g.rows}
            timeZone={timeZone}
            lastRun={lastRun}
            runNow={runNow}
            onEdit={setEditing}
          />
        ))
      ) : (
        <FramePanel>
          <p className="text-muted-foreground text-sm">{B.empty}</p>
        </FramePanel>
      )}
      {footer}

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (next) return;
          setEditing(null);
          if (fromHash) clearHash();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fill(B.editTitle, { name: open?.label ?? '' })}</DialogTitle>
          </DialogHeader>
          {open ? (
            <SettingRow
              key={`${open.key}:${open.setting.source}:${open.setting.value}`}
              setting={open.setting}
              timeZone={timeZone}
              now={now}
              variant="nested"
              aside={lastRun(open.status)}
              actions={runNow(open.status)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Frame>
  );
}

function AreaGrid({
  area,
  rows,
  timeZone,
  lastRun,
  runNow,
  onEdit,
}: {
  area: JobArea;
  rows: JobRow[];
  timeZone: string;
  lastRun: (job: JobStatus) => ReactNode;
  runNow: (job: JobStatus) => ReactNode;
  onEdit: (key: string) => void;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const B = T.blocks.jobs;
  const f = useFormatters(timeZone);

  const columns = useMemo<ColumnDef<DataGridFeatures, JobRow>[]>(
    () => [
      {
        id: 'job',
        header: T.jobs.columns.job,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{row.original.label}</span>
            <code className="text-muted-foreground truncate font-mono text-xs">
              {row.original.job} · {T.services[row.original.status.service]}
            </code>
          </div>
        ),
        enableSorting: false,
        size: 260,
      },
      {
        id: 'schedule',
        header: T.jobs.columns.schedule,
        cell: ({ row }) => {
          const s = row.original.setting;
          const def = settingDef(s.key)!;
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-xs">{displayValue(T, def, s.value, { locale })}</span>
              {s.nextRuns.length ? (
                <span className="text-muted-foreground truncate text-xs">
                  {T.cron.next}: {s.nextRuns.map((r) => f.dayTime(r)).join(' · ')}
                </span>
              ) : null}
            </div>
          );
        },
        enableSorting: false,
        size: 240,
      },
      {
        id: 'state',
        header: B.state,
        cell: ({ row }) => {
          const s = row.original.setting;
          const off = !s.value || CRON_OFF.has(s.value.trim().toLowerCase());
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={off ? 'secondary' : 'success-light'}>{off ? B.off : B.on}</Badge>
              {isChanged(s) ? <Badge variant="primary-light">{T.blocks.changed}</Badge> : null}
            </div>
          );
        },
        enableSorting: false,
        size: 150,
      },
      {
        id: 'last',
        header: T.jobs.columns.last,
        cell: ({ row }) => <div className="whitespace-normal">{lastRun(row.original.status)}</div>,
        enableSorting: false,
        size: 300,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {runNow(row.original.status)}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${B.edit}: ${row.original.label}`}
              title={B.edit}
              onClick={() => onEdit(row.original.key)}
            >
              <Pencil />
            </Button>
          </div>
        ),
        enableSorting: false,
        size: 160,
      },
    ],
    [T, B, locale, f, lastRun, runNow, onEdit],
  );

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (r) => r.key,
    initialState: { pagination: { pageIndex: 0, pageSize: 100 } },
  });

  return (
    <FramePanel className="p-0" data-job-area={area}>
      <div className="border-b px-4 py-3">
        <span className="text-sm font-semibold">{B.areas[area]}</span>
      </div>
      <DataGrid
        table={table}
        recordCount={rows.length}
        tableLayout={{ headerBackground: true }}
        i18n={{ labels: { empty: B.empty } }}
      >
        <DataGridContainer>
          <DataGridTable />
        </DataGridContainer>
      </DataGrid>
    </FramePanel>
  );
}
