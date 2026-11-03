/** Erros que o `runTask` trata de um jeito próprio (ficam fora do run.ts para os executores não importarem o registro). */

/**
 * O worker está encerrando (SIGTERM do deploy): o executor para entre dois lotes, depois do último checkpoint, e o
 * `runTask` devolve a tarefa à fila (`release`), sem gastar tentativa. A próxima tomada continua do checkpoint.
 */
export class TaskInterruptedError extends Error {
  constructor(id: string) {
    super(`tarefa ${id}: interrompida pelo encerramento do worker`);
    this.name = 'TaskInterruptedError';
  }
}

/**
 * Recusa determinística do executor (ex.: o pacote ou o manifesto mudou desde a prévia aprovada): a tarefa encerra
 * em erro na hora, sem nova tentativa, porque repetir não muda a resposta.
 */
export class TaskRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskRefusedError';
  }
}
