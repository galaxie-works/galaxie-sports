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
  /** Relógios da ficha do país do autor: só calculados quando a mensagem vai mesmo ao motor. */
  clocks: () => Promise<ModerationClocks>;
  /** `report`: denunciada (já está na fila); `filter`: marcada pelas regras. */
  source: 'filter' | 'report';
}

export interface ChatReportInput {
  tenantId: string;
  messageId: string;
}

interface RoomConfig {
  on: boolean;
  fullRead: boolean;
}

/** Mensagens já mandadas ao motor: cada uma vai uma vez só (filtro e 50 denúncias da mesma mensagem pagam uma). */
const SENT_TTL_MS = 6 * 3_600_000;
const SENT_MAX = 50_000;
/** Erro na leitura da configuração: fica desligado por um instante, sem martelar o banco a cada mensagem. */
const CONFIG_ERROR_TTL_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatCosmosOptions {
  batcher?: Pick<ModerationBatcher, 'submit' | 'drain'>;
  now?: () => number;
  /** Relógios da ficha pelo país do autor (a denúncia usa o do autor, não o de quem denunciou). */
  clocksFor?: (tenantId: string, country: string, at: Date) => Promise<ModerationClocks>;
  /** Mensagem tirada do ar: avisa quem está na sala (o stream manda `chat.removed`). */
  onRemoved?: (tenantId: string, fixtureId: string, messageId: string) => Promise<void>;
}

export class ChatCosmos {
  private readonly configs = new Map<string, { at: number; ttl: number; value: Promise<RoomConfig> }>();
  private readonly sent = new Map<string, number>();
  private readonly batcher: Pick<ModerationBatcher, 'submit' | 'drain'>;
  private readonly now: () => number;
  private readonly clocksFor: ChatCosmosOptions['clocksFor'];
  private readonly onRemoved: ChatCosmosOptions['onRemoved'];

  constructor(
    private readonly db: Database,
    options: ChatCosmosOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.clocksFor = options.clocksFor;
    this.onRemoved = options.onRemoved;
    this.batcher =
      options.batcher ??
      createModerationBatcher(db, {
        onDecision: (o) => this.applyDecision(o),
      });
  }

  /** A função da Cosmos para o chat vale nesta sala? (cache curto: o envio é o caminho quente) */
  roomConfig(tenantId: string, roomId: string): Promise<RoomConfig> {
    const key = `${tenantId}:${roomId}`;
    const hit = this.configs.get(key);
    if (hit && this.now() - hit.at < hit.ttl) return hit.value;
    const entry = {
      at: this.now(),
      ttl: CONFIG_TTL_MS,
      value: Promise.resolve({ on: false, fullRead: false }),
    };
    entry.value = (async () => {
      const ceiling = await readModerationCeiling(this.db);
      const { effective } = await loadModerationConfig(this.db, tenantId, ceiling, {
        kind: 'room',
        id: roomId,
      });
      return { on: effective.features.live_chat === true, fullRead: effective.features.full_read === true };
    })().catch((err: unknown) => {
      // erro na leitura não liga nada: a sala segue com o filtro e a fila (e tenta de novo daqui a pouco)
      entry.ttl = CONFIG_ERROR_TTL_MS;
      console.error('[chat] configuração da Cosmos indisponível', { tenantId, err });
      return { on: false, fullRead: false };
    });
    if (this.configs.size > CONFIG_CACHE_MAX) this.configs.clear();
    this.configs.set(key, entry);
    return entry.value;
  }

  /** Já foi ao motor? Marca, se não foi. */
  private firstTime(tenantId: string, messageId: string): boolean {
    const key = `${tenantId}:${messageId}`;
    const at = this.sent.get(key);
    const now = this.now();
    if (at !== undefined && now - at < SENT_TTL_MS) return false;
    if (this.sent.size >= SENT_MAX) {
      for (const [k, t] of this.sent) if (now - t >= SENT_TTL_MS) this.sent.delete(k);
      if (this.sent.size >= SENT_MAX) this.sent.delete(this.sent.keys().next().value!);
    }
    this.sent.set(key, now);
    return true;
  }

  /**
   * Manda a mensagem ao lote quando cabe (nunca espera o modelo): a entrega ao torcedor já aconteceu. Os relógios só
   * são calculados para o que vai. Devolve se foi.
   */
  async submit(m: ChatCosmosMessage): Promise<boolean> {
    const cfg = await this.roomConfig(m.tenantId, m.roomId);
    if (!cfg.on) return false;
    const marked = m.source === 'report' || m.rules.suspect;
    const send =
      marked || (cfg.fullRead && m.rules.action === 'allow' && classify(m.text, m.rules).outcome !== 'clean');
    if (!send || !this.firstTime(m.tenantId, m.messageId)) return false;
    const clocks = await m.clocks();
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
      clocks,
    });
    return true;
  }

  /**
   * Mensagem denunciada (#971): vai ao lote da sala com a origem `report` (o caso já está na fila), uma vez só. O
   * texto, o autor e o país (relógios) vêm do chat, nunca de quem denunciou; a que já saiu do ar não vai.
   */
  async submitReport(r: ChatReportInput): Promise<boolean> {
    if (!UUID.test(r.messageId) || !this.clocksFor) return false;
    const messageId = r.messageId.toLowerCase();
    const rows = await this.db.execute<{
      room_id: string;
      profile_id: string;
      body: string;
      visibility: string;
      locale: string | null;
      country: string | null;
    }>(
      sql`select m.room_id, m.profile_id, m.body, m.visibility, p.locale, p.country
            from chat.message m
            left join fan.profile p on p.tenant_id = m.tenant_id and p.id = m.profile_id
           where m.tenant_id = ${r.tenantId} and m.id = ${messageId}
           limit 1`,
    );
    const m = rows[0];
    if (!m || m.visibility === 'hidden' || !m.country) return false;
    const country = m.country;
    const shadow = m.visibility === 'shadow';
    return this.submit({
      tenantId: r.tenantId,
      roomId: m.room_id,
      messageId,
      profileId: m.profile_id,
      text: m.body,
      locale: m.locale ?? 'pt-BR',
      // a retida (só o autor vê) chega ao motor como retida, não como publicada
      rules: {
        action: shadow ? 'shadow' : 'allow',
        reasons: [],
        categories: [],
        suspect: shadow,
        evasion: false,
      },
      clocks: () => this.clocksFor!(r.tenantId, country, new Date(this.now())),
      source: 'report',
    });
  }

  /**
   * O que a Cosmos escondeu (fora do "só sugere") sai do ar na sala e deixa de estar fixado. A mensagem que a equipe
   * devolveu ao ar (`restored`) não volta a ser escondida por uma decisão atrasada.
   */
  async applyDecision(o: ModerationOutcome): Promise<void> {
    if (o.item.module !== 'chat' || o.item.targetType !== 'message' || !o.plan || o.plan.allow) return;
    const hide = o.plan.actions.some((a) => a.action === 'hide' && a.step !== 'flag');
    if (!hide) return;
    const rows = await this.db.execute<{ event_id: string; id: string }>(sql`
      with hidden as (
        update chat.message
           set visibility = 'hidden',
               flags = case when visibility = 'shadow' then array_append(flags, 'was_shadow') else flags end
         where tenant_id = ${o.item.tenantId} and id = ${o.item.targetId} and visibility <> 'hidden'
           and not ('restored' = any(flags))
        returning tenant_id, id, room_id
      ),
      unpinned as (
        update chat.room r set pinned_message_id = null
          from hidden h
         where r.tenant_id = h.tenant_id and r.pinned_message_id = h.id
        returning r.id
      )
      select r.event_id, h.id
        from hidden h
        join chat.room r on r.tenant_id = h.tenant_id and r.id = h.room_id`);
    // já entregue na sala: sai da tela de quem está vendo
    for (const r of rows) await this.onRemoved?.(o.item.tenantId, r.event_id, r.id);
  }

  /** Desligamento: manda o que está juntando, sem passar do prazo do processo. */
  async drain(timeoutMs = 8_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), timeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([this.batcher.drain().then(() => 'done' as const), late]);
    if (timer) clearTimeout(timer);
    if (result === 'late') console.error('[chat] lotes da Cosmos ainda em andamento no desligamento');
  }
}
