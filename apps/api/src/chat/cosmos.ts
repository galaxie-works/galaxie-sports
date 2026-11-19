/**
 * Adaptador da Cosmos para o Chat ao vivo (#981). O motor é o da base (#998): lote por sala (o juntador fecha a
 * cada `ENGINE_LIMITS.batchWaitMs`), uma chamada por lote, reserva e extrato com o escopo `chat:<sala>` (a cota por
 * sala de #1116 é o teto do jogo), escada do cliente e fila humana.
 *
 * Decisão do Wagner (19/11): só vale para o cliente com a função de moderação da Cosmos ligada para o chat (os outros
 * seguem como hoje, só com o filtro e a fila). Sem saldo no meio do jogo, o chat não para: o lote segue as regras e o
 * que pedia a Cosmos vai para a fila (regra do motor).
 *
 * Vai ao motor: a mensagem publicada que o filtro marcou (`suspect`), a denunciada e, com a Leitura total contratada,
 * o que o classificador não acha limpo (o motor confere de novo). O que a Cosmos esconde sai do ar na hora
 * (`visibility = 'hidden'`, como o "tirar mensagem" do painel).
 */
import {
  classify,
  createModerationBatcher,
  loadModerationConfig,
  readModerationCeiling,
  type ModerationBatcher,
  type ModerationOutcome,
} from '@galaxie/cosmos';
import type { Database } from '@galaxie/db';
import type { ModerationClocks } from '@galaxie/db/moderation-queue';
import type { ScreenResult } from '@galaxie/engage';
import { sql } from 'drizzle-orm';

/** Quanto tempo a configuração do cliente fica guardada (a mudança no painel vale em até 1 min). */
const CONFIG_TTL_MS = 60_000;
const CONFIG_CACHE_MAX = 10_000;

export interface ChatCosmosMessage {
  tenantId: string;
  roomId: string;
  messageId: string;
  profileId: string;
  text: string;
  locale: string;
  rules: Pick<ScreenResult, 'action' | 'reasons' | 'categories' | 'suspect' | 'evasion'>;
  clocks: ModerationClocks;
  /** `report`: denunciada (já está na fila); `filter`: marcada pelas regras. */
  source: 'filter' | 'report';
}

export interface ChatReportInput {
  tenantId: string;
  messageId: string;
  clocks: ModerationClocks;
}

interface RoomConfig {
  on: boolean;
  fullRead: boolean;
}

export class ChatCosmos {
  private readonly configs = new Map<string, { at: number; value: Promise<RoomConfig> }>();
  private readonly batcher: Pick<ModerationBatcher, 'submit' | 'drain'>;

  constructor(
    private readonly db: Database,
    options: { batcher?: Pick<ModerationBatcher, 'submit' | 'drain'>; now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.batcher =
      options.batcher ??
      createModerationBatcher(db, {
        onDecision: (o) => this.applyDecision(o),
      });
  }

  private readonly now: () => number;

  /** A função da Cosmos para o chat vale nesta sala? (cache curto: o envio é o caminho quente) */
  roomConfig(tenantId: string, roomId: string): Promise<RoomConfig> {
    const key = `${tenantId}:${roomId}`;
    const hit = this.configs.get(key);
    if (hit && this.now() - hit.at < CONFIG_TTL_MS) return hit.value;
    const value = (async () => {
      const ceiling = await readModerationCeiling(this.db);
      const { effective } = await loadModerationConfig(this.db, tenantId, ceiling, {
        kind: 'room',
        id: roomId,
      });
      return { on: effective.features.live_chat === true, fullRead: effective.features.full_read === true };
    })().catch((err: unknown) => {
      // erro na leitura não liga nada: a sala segue com o filtro e a fila
      this.configs.delete(key);
      console.error('[chat] configuração da Cosmos indisponível', { tenantId, err });
      return { on: false, fullRead: false };
    });
    if (this.configs.size > CONFIG_CACHE_MAX) this.configs.clear();
    this.configs.set(key, { at: this.now(), value });
    return value;
  }

  /**
   * Manda a mensagem ao lote quando cabe (nunca espera o modelo nem lança): a entrega ao torcedor já aconteceu.
   * Devolve se foi.
   */
  async submit(m: ChatCosmosMessage): Promise<boolean> {
    const cfg = await this.roomConfig(m.tenantId, m.roomId);
    if (!cfg.on) return false;
    const marked = m.source === 'report' || m.rules.suspect;
    const send =
      marked || (cfg.fullRead && m.rules.action === 'allow' && classify(m.text, m.rules).outcome !== 'clean');
    if (!send) return false;
    this.batcher.submit({
      tenantId: m.tenantId,
      kind: 'chat_message',
      text: m.text,
      targetType: 'message',
      targetId: m.messageId,
      targetProfileId: m.profileId,
      module: 'chat',
      room: m.roomId,
      community: null,
      locale: m.locale,
      source: m.source,
      rules: m.rules,
      clocks: m.clocks,
    });
    return true;
  }

  /**
   * Mensagem denunciada (#971): vai ao lote da sala com a origem `report` (o caso já está na fila). O texto e o autor
   * vêm do chat, nunca de quem denunciou.
   */
  async submitReport(r: ChatReportInput): Promise<boolean> {
    const rows = await this.db.execute<{
      room_id: string;
      profile_id: string;
      body: string;
      locale: string | null;
    }>(
      sql`select m.room_id, m.profile_id, m.body, p.locale
            from chat.message m
            left join fan.profile p on p.tenant_id = m.tenant_id and p.id = m.profile_id
           where m.tenant_id = ${r.tenantId} and m.id = ${r.messageId}
           limit 1`,
    );
    const m = rows[0];
    if (!m) return false;
    return this.submit({
      tenantId: r.tenantId,
      roomId: m.room_id,
      messageId: r.messageId,
      profileId: m.profile_id,
      text: m.body,
      locale: m.locale ?? 'pt-BR',
      rules: { action: 'allow', reasons: [], categories: [], suspect: false, evasion: false },
      clocks: r.clocks,
      source: 'report',
    });
  }

  /** O que a Cosmos escondeu (fora do "só sugere") sai do ar na sala. */
  async applyDecision(o: ModerationOutcome): Promise<void> {
    if (o.item.module !== 'chat' || o.item.targetType !== 'message' || !o.plan || o.plan.allow) return;
    const hide = o.plan.actions.some((a) => a.action === 'hide' && a.step !== 'flag');
    if (!hide) return;
    await this.db.execute(sql`
      update chat.message
         set visibility = 'hidden',
             flags = case when visibility = 'shadow' then array_append(flags, 'was_shadow') else flags end
       where tenant_id = ${o.item.tenantId} and id = ${o.item.targetId} and visibility <> 'hidden'`);
  }

  /** Desligamento: manda o que está juntando. */
  drain(): Promise<void> {
    return this.batcher.drain();
  }
}
