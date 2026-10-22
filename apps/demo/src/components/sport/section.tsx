export function Section({
  title,
  icon,
  description,
  action,
  children,
}: {
  title: string;
  /** Ícone ou bandeira antes do título. */
  icon?: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </h2>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
