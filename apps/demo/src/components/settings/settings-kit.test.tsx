// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';

import {
  ActionNotice,
  ExplainEmpty,
  SafetyNote,
  SettingOption,
  SettingsSection,
  StepDialog,
  UsageMeter,
  usagePercent,
} from './index';

afterEach(cleanup);

const wrap = (node: React.ReactElement, locale: Locale = 'pt-BR') => (
  <I18nProvider locale={locale} messages={clientDictionary(locale)}>
    {node}
  </I18nProvider>
);

describe('SettingsSection', () => {
  it('é uma região com o título como nome, a frase e a ação', () => {
    render(
      wrap(
        <SettingsSection title="Moderação" description="Filtra o chat." action={<button>Ligar</button>}>
          <p>cartões</p>
        </SettingsSection>,
      ),
    );
    const region = screen.getByRole('region', { name: 'Moderação' });
    expect(region.textContent).toContain('Filtra o chat.');
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeTruthy();
    expect(screen.getByText('cartões')).toBeTruthy();
  });
});

function Option({ initial = false }: { initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <SettingOption
      title="Moderação com IA"
      description="Revisa as mensagens antes de publicar."
      checked={on}
      onCheckedChange={setOn}
      allows="Esconder mensagens ofensivas."
      locks={<input type="checkbox" aria-label="Bloquear links" />}
      safety="Pode esconder mensagens legítimas."
    />
  );
}

describe('SettingOption', () => {
  it('nasce desligada, com o switch rotulado pelo título e descrito pela frase', () => {
    render(wrap(<Option />));
    const sw = screen.getByRole('switch', { name: 'Moderação com IA' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('a engrenagem abre o detalhe, e as travas ficam desabilitadas com a opção desligada', () => {
    render(wrap(<Option />));
    const gear = screen.getByRole('button', { name: 'Detalhes de Moderação com IA' });
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    act(() => gear.click());
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('O que esta opção permite?')).toBeTruthy();
    expect(screen.getByRole('note', { name: 'Nota de segurança' }).textContent).toContain(
      'Pode esconder mensagens legítimas.',
    );
    const group = screen.getByRole('group', { name: 'Travas' }) as HTMLFieldSetElement;
    expect(group.disabled).toBe(true);
    expect(screen.getByText('Ligue a opção principal para mudar as travas.')).toBeTruthy();

    act(() => screen.getByRole('switch').click());
    expect((screen.getByRole('group', { name: 'Travas' }) as HTMLFieldSetElement).disabled).toBe(false);
  });

  it('sem switch, mostra o controle passado e nenhuma engrenagem sem detalhe', () => {
    render(wrap(<SettingOption title="Exportar" control={<button>Baixar</button>} />));
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Detalhes/ })).toBeNull();
  });
});

describe('SafetyNote', () => {
  it.each(LOCALES)('%s: nota rotulada no idioma da tela', (locale) => {
    render(wrap(<SafetyNote>Risco</SafetyNote>, locale));
    const label = clientDictionary(locale).settings.safety.label;
    expect(screen.getByRole('note', { name: label }).textContent).toBe('Risco');
  });
});

describe('ActionNotice', () => {
  it('informação e alerta são status; erro interrompe como alert; o botão que resolve aparece', () => {
    const { rerender } = render(wrap(<ActionNotice tone="warning">Créditos no fim</ActionNotice>));
    expect(screen.getByRole('status').textContent).toContain('Créditos no fim');
    rerender(
      wrap(
        <ActionNotice tone="error" action={<button>Comprar créditos</button>}>
          Sem créditos
        </ActionNotice>,
      ),
    );
    expect(screen.getByRole('alert').textContent).toContain('Sem créditos');
    expect(screen.getByRole('button', { name: 'Comprar créditos' })).toBeTruthy();
  });
});

describe('UsageMeter', () => {
  it('calcula o % sem passar de 0–100 e sem limite não mede', () => {
    expect(usagePercent(3, 10)).toBe(30);
    expect(usagePercent(15, 10)).toBe(100);
    expect(usagePercent(-1, 10)).toBe(0);
    expect(usagePercent(3, null)).toBeNull();
    expect(usagePercent(3, 0)).toBeNull();
  });

  it.each([
    ['pt-BR', '1.200 de 5.000 · 24% usado'],
    ['en', '1,200 of 5,000 · 24% used'],
    ['es-AR', '1.200 de 5.000 · 24% usado'],
  ] as const)('%s: "X de Y", a barra rotulada e o %%', (locale, text) => {
    render(wrap(<UsageMeter label="Créditos" used={1200} total={5000} />, locale));
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1200');
    expect(bar.getAttribute('aria-valuemax')).toBe('5000');
    expect(bar.getAttribute('aria-valuetext')).toBe(text);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('sem limite: só o uso e "Sem limite", sem barra', () => {
    render(wrap(<UsageMeter label="Mensagens" used={42} total={null} />));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('42 · Sem limite')).toBeTruthy();
  });
});

describe('ExplainEmpty', () => {
  it('diz o que falta e oferece o botão para começar', () => {
    render(
      wrap(
        <ExplainEmpty
          title="Nenhum webhook"
          description="Cadastre a URL."
          action={<button>Cadastrar</button>}
        />,
      ),
    );
    expect(screen.getByText('Nenhum webhook')).toBeTruthy();
    expect(screen.getByText('Cadastre a URL.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeTruthy();
  });
});

describe('StepDialog', () => {
  const steps = [
    { title: 'Escolha o plano', description: 'Uma frase.', content: <p>passo 1</p> },
    { title: 'Confirme', content: <p>passo 2</p> },
  ];

  it('anda pelos passos, volta, e conclui no último', () => {
    const onFinish = vi.fn();
    render(wrap(<StepDialog open onOpenChange={() => {}} steps={steps} onFinish={onFinish} />));
    expect(screen.getByRole('dialog', { name: 'Escolha o plano' })).toBeTruthy();
    expect(screen.getByText('Passo 1 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(screen.getByText('Passo 2 de 2')).toBeTruthy();
    expect(screen.getByText('passo 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('passo 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('fechada pelo pai depois de concluir, volta ao passo 1 na próxima abertura', () => {
    const view = (open: boolean) => (
      <StepDialog open={open} onOpenChange={() => {}} steps={steps} onFinish={() => {}} />
    );
    const { rerender } = render(wrap(view(true)));
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(screen.getByText('Passo 2 de 2')).toBeTruthy();
    rerender(wrap(view(false)));
    rerender(wrap(view(true)));
    expect(screen.getByText('Passo 1 de 2')).toBeTruthy();
  });

  it('o passo que não pode seguir trava o botão', () => {
    render(
      wrap(
        <StepDialog
          open
          onOpenChange={() => {}}
          steps={[{ ...steps[0]!, canContinue: false }, steps[1]!]}
          onFinish={() => {}}
        />,
      ),
    );
    expect((screen.getByRole('button', { name: 'Seguir' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a janela não passa da altura visível: só o corpo rola e o rodapé fica fora da rolagem', () => {
    render(wrap(<StepDialog open onOpenChange={() => {}} steps={steps} onFinish={() => {}} />));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('flex-col');
    const body = dialog.querySelector('[data-slot="step-dialog-body"]')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')!;
    expect(footer.className).toContain('shrink-0');
    expect(body.contains(footer)).toBe(false);
  });
});
