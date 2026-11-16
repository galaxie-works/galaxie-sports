'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addNoteAction } from '@/lib/chat/user-file-actions';
import { useI18n } from '@/lib/i18n/client';

/** Campo de nota interna na ficha do torcedor (#973). Depois de salvar, a página relê a ficha. */
export function UserNotesForm({ profileId }: { profileId: string }) {
  const { t } = useI18n();
  const T = t.chatPanel.userFile;
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const tooLong = [...body].length > 1_000;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addNoteAction({ profileId, body });
          if (!r.ok) return void toast.error(r.error ?? t.chatPanel.errors.generic);
          setBody('');
          toast.success(T.noteSaved);
          router.refresh();
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={T.notePlaceholder}
        aria-label={T.notes}
        aria-invalid={tooLong || undefined}
        rows={3}
      />
      {tooLong ? <p className="text-destructive text-xs">{T.noteTooLong}</p> : null}
      <div>
        <Button type="submit" size="sm" disabled={pending || !body.trim() || tooLong}>
          {T.addNote}
        </Button>
      </div>
    </form>
  );
}
