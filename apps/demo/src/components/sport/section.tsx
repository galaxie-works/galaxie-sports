import { ApiCodeButton } from '@/components/docs/api-code-button';
import type { ApiRequest } from '@/lib/galaxie/request';

export function Section({
  title,
  icon,
  description,
  action,
  api,
  children,
}: {
  title: string;
  /** Ícone ou bandeira antes do título. */
  icon?: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  /** Chamada da API que produz os dados da seção: mostra o botão "Ver código" no cabeçalho. */
  api?: ApiRequest;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
            {api ? <ApiCodeButton request={api} /> : null}
          </h2>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
