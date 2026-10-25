import { redirect } from 'next/navigation';

/** O controle dos canais fica na aba de vídeos relacionados de Ajustes → Esportes e features. */
export default function RelatedVideosRedirect() {
  redirect('/ajustes/esportes?aba=related');
}
