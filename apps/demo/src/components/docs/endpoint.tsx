import { Badge } from '@/components/reui/badge';

const METHOD_VARIANT = {
  GET: 'success-light',
  POST: 'info-light',
  PUT: 'warning-light',
  PATCH: 'warning-light',
  DELETE: 'destructive-light',
} as const;

/** Método + rota, como na referência. */
export function Endpoint({ method, route }: { method: string; route: string }) {
  const m = method.toUpperCase() as keyof typeof METHOD_VARIANT;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Badge variant={METHOD_VARIANT[m] ?? 'outline'} size="sm" className="font-mono">
        {m}
      </Badge>
      <code className="truncate font-mono text-xs">{route}</code>
    </span>
  );
}
