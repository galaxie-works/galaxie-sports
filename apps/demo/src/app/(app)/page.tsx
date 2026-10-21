import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';

export default function MyDayPage() {
  return (
    <>
      <PageHeader title="Meu dia" />
      <EmptyState
        title="Sua agenda aparece aqui"
        description="Jogos do dia dos seus times e competições, com onde assistir."
      />
    </>
  );
}
