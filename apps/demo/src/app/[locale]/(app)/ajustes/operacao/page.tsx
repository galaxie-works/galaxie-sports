import { redirect } from 'next/navigation';

/** O painel de Operação virou Ajustes → Sistema (e o que é por esporte ou feature, Esportes e features). */
export default function OperationsRedirect() {
  redirect('/ajustes/sistema');
}
