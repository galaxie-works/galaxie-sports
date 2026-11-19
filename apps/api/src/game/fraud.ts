/**
 * Varredura do antifraude da Gamificação (#934) no processo da API: a cada 15 min procura os três sinais da janela
 * recente e grava os alertas novos. Só alerta: quem decide é uma pessoa, no painel do cliente ou da Galaxie. Várias
 * réplicas podem rodar ao mesmo tempo: o mesmo alerta do dia não se repete (`dedupe_key` único).
 */
import { detectFraudSignals, type Database } from '@galaxie/db';

type Logger = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export const FRAUD_SWEEP_MS = 15 * 60_000;

export function startFraudSweep(db: Database, log: Logger, everyMs = FRAUD_SWEEP_MS): () => void {
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    detectFraudSignals(db)
      .then((r) => {
        if (r.predictionBurst || r.simultaneousPresence || r.newProfilesBurst)
          log.info?.(r, 'gamificação: alertas antifraude novos para revisão');
      })
      .catch((err: unknown) => log.warn({ err }, 'gamificação: varredura do antifraude falhou'))
      .finally(() => {
        busy = false;
      });
  };
  // a primeira passa depois da subida, espalhada entre as réplicas
  const first = setTimeout(run, Math.floor(60_000 + Math.random() * 120_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
