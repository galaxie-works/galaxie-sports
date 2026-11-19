/**
 * Guia do painel para a Cosmos (#1411): o que cada área faz, onde fica e como se usa. Sem isto, a Cosmos só conhecia
 * os guias públicos e a referência da API, e respondia "não tenho essa informação" sobre as telas do próprio painel.
 *
 * Em pt-BR, como o contrato da API: a Cosmos responde no idioma da tela. Os trechos `staff` são das telas de Ajustes
 * da equipe Galaxie e só entram na busca de quem é da equipe (o cliente não vê nem ouve falar dessas telas).
 *
 * Mantenha cada trecho fiel à tela: ao mudar uma área do painel, atualize o trecho dela aqui.
 */
import type { DocChunk } from '@galaxie/cosmos';

export interface PanelGuideChunk extends DocChunk {
  /** Só para a equipe Galaxie (telas de Ajustes). */
  staff?: boolean;
}

const CLIENT: PanelGuideChunk[] = [
  {
    title: 'Painel do cliente: o que é a Galaxie e como o painel se organiza',
    href: '/client',
    text:
      'A Galaxie Sports é uma galáxia sobre esportes: resultados e estatísticas, contexto e história, escudos, onde assistir, a voz do torcedor, Comunidades, Chat ao vivo, Gamificação e Shopping. A API e os widgets são o jeito de levar isso ao público do cliente. ' +
      'O menu do painel tem cinco grupos: Conta (Visão geral, Usuários e cargos, Chaves publicáveis, Planos e módulos), Conteúdo (Builder, Temas, Grade e ofertas, Minha lista de canais), Engajamento (Patrocinadores, Comunidades, Gamificação, Shopping, Chat ao vivo, Fila de moderação), Inteligência (Cosmos AI) e Integrações (Webhooks, Domínios). ' +
      'Uma área só aparece quando o plano tem o módulo e o cargo da pessoa tem a permissão; sem o módulo, a página diz "Módulo fora do plano".',
  },
  {
    title: 'Visão geral',
    href: '/client',
    text:
      'Primeira tela do painel: estado da conta, o checklist de começo e os módulos de torcedor com a faixa contratada e o uso do mês (atualizado a cada 5 minutos). ' +
      'O checklist se marca sozinho: rodar o curl com a chave de teste, colar o embed do widget de exemplo numa página da origem cadastrada, convidar alguém em Usuários e cargos e sair do teste em Planos e módulos. ' +
      'Estados da conta: em teste, teste vencido (as chaves param; contrate em Planos e módulos), cobrança pendente (nada é cortado ainda), suspensa (as chaves respondem 402) e cancelada (os dados ficam guardados).',
  },
  {
    title: 'Usuários e cargos',
    href: '/client/users',
    text:
      'Quem da equipe do cliente entra no painel e o que cada cargo pode fazer. Cargos: Dono, Admin, Desenvolvedor, Financeiro, Moderador sênior, Moderador e Voluntário; Dono e Financeiro valem em todas as marcas da organização, e só o Dono convida e troca esses cargos. ' +
      'Na aba de permissões, marcar uma permissão num cargo marca nos cargos de cima; desmarcar desmarca nos de baixo. O registro mostra quem deu, trocou ou tirou cada cargo e quando. Moderadores e voluntários agem na moderação dos módulos de torcedor.',
  },
  {
    title: 'Chaves publicáveis',
    href: '/client/keys',
    text:
      'Chaves para os widgets no navegador: só leitura (GET) e só nos domínios (origens) permitidos. A chave secreta da API nunca vai para o front. ' +
      'Erros comuns: origem fora da lista, chave errada, limite por minuto e cota diária. A Cosmos pode ler os erros de acesso dos últimos 7 dias e dizer o que mudar (diagnóstico de chaves, pago em créditos).',
  },
  {
    title: 'Planos e módulos',
    href: '/client/plans',
    text: 'O que o plano inclui e o que dá para contratar, com o preço previsto. Para mudar de plano ou ativar um módulo, fale com o time da Galaxie. Sair do teste e regularizar cobrança também passam por aqui.',
  },
  {
    title: 'Builder de widgets',
    href: '/client/builder',
    text:
      'Monte o widget com a identidade da marca, veja com dados reais e instale no site ou app: código HTML para qualquer página ou componente React (shadcn). ' +
      'No editor dá para escolher quais jogos entram, como a lista se organiza e o que cada jogo mostra: símbolo da competição, rodada ou fase, selo do clássico (Fla-Flu, Gre-Nal), o que cada time busca na partida na voz da torcida e placar dos pênaltis. As zonas da tabela marcam cada tipo de vaga com uma cor. ' +
      'Com a Cosmos, você descreve o widget ou a página numa frase e ela monta com o catálogo e as opções do plano; o editor abre preenchido e nada é salvo até você salvar. Ela também escreve o passo a passo de instalação para o seu site.',
  },
  {
    title: 'Temas',
    href: '/client/themes',
    text:
      'A identidade visual da marca, criada uma vez e aplicada em todos os widgets: mudou o tema, todos os widgets ligados a ele mudam juntos, no site e no app. ' +
      'Em Temas > Novo tema, "Criar com a Cosmos" lê o PDF do manual da marca (até 20 MB): cores, fontes, cantos e espaçamento, e monta as versões clara e escura com o contraste conferido. O custo aparece antes de confirmar; você revisa e salva.',
  },
  {
    title: 'Grade e ofertas',
    href: '/client/lineup',
    text:
      'A grade da operadora como a API publica: planos, canais de cada plano e streamings inclusos. A Galaxie monta e confere tudo a partir de fontes públicas; o cliente só avisa se algo estiver errado, com um pedido de revisão que a Galaxie confere na fonte e responde no painel. ' +
      'A Cosmos pode ler um pedido escrito do seu jeito ("o plano Top agora tem ESPN"), achar o item e preencher o pedido para você conferir e enviar.',
  },
  {
    title: 'Minha lista de canais',
    href: '/client/channels',
    text:
      'Envie só os nomes dos canais (arquivo M3U ou um nome por linha), sem o EPG. A Galaxie casa cada canal com as emissoras que têm direitos nos seus mercados, e o "onde assistir" de cada jogo passa a mostrar os seus canais. Praças e afiliadas entram todas; a geolocalização é do cliente. ' +
      'Canais que não casaram (VOD, sem esporte ou fora do dicionário) aparecem à parte e não entram no onde assistir. A Cosmos monta a lista a partir de PDF, print ou planilha da grade.',
  },
  {
    title: 'Patrocinadores',
    href: '/client/sponsors',
    text:
      'Um cadastro só para a campanha de bolão, a sala do chat e as recompensas. Casa de aposta não entra; a peça não aparece para menores de 13 anos nem, onde a lei do país proíbe, para menores de 18. ' +
      'Links só https; países em código de duas letras (BR, AR), vazio vale para todos; início e fim no fuso do cliente. Arquivar tira a peça de tudo, mas as impressões continuam no relatório, somadas por dia, para prestar contas ao patrocinador.',
  },
  {
    title: 'Comunidades',
    href: '/client/communities',
    text:
      'No escopo você escolhe esportes, campeonatos, times ou atletas, e nasce uma Comunidade para cada um, com o nome da entidade; o torcedor nunca cria. Tirar do escopo arquiva a Comunidade, sem apagar nada. ' +
      'Cada Comunidade tem modo de entrada (Aberta, Com aprovação ou Só convite), post de membro, Chat da Comunidade e termos próprios. Publicar termos cria uma versão nova que os membros aceitam de novo. Convite válido entra direto, mesmo com aprovação; os pedidos ficam do mais antigo para o mais novo.',
  },
  {
    title: 'Gamificação',
    href: '/client/gamification',
    text:
      'Pontos, Ranking e Conquistas, com um programa por país-alvo (os de um país nunca se misturam com os de outro). O programa nasce sozinho no primeiro torcedor, ou na tela. ' +
      'O Catálogo de Conquistas é da Galaxie: o cliente liga ou desliga cada Conquista no programa dele; a mudança vale para o que vem depois, e o que já foi ganho continua com o torcedor.',
  },
  {
    title: 'Shopping',
    href: '/client/shopping',
    text:
      'Produtos oficiais das entidades da página (time, seleção, campeonato, atleta, piloto), por loja de afiliado. Entidade sem produto aprovado não aparece para o torcedor. ' +
      'No widget do Shopping você escolhe as lojas parceiras, a ordem e como cada uma leva o seu ganho: o seu código de afiliado ou o repasse pela Galaxie. Onde o widget vai ficar decide quais lojas os termos de cada programa permitem. ' +
      'O relatório mostra os cliques no "Comprar", sem robôs, e exporta CSV; pedidos, vendas e comissão aparecem quando a conciliação com as lojas estiver ligada.',
  },
  {
    title: 'Chat ao vivo',
    href: '/client/chat',
    text:
      'As salas dos jogos, ao vivo: tirar mensagens do ar, congelar a sala, ligar o modo lento, fixar mensagem, notas internas, ficha do torcedor e punir quem passar do limite. ' +
      'As configurações valem para todas as salas do cliente; cada sala pode mudar o modo lento, e vazio volta ao padrão da Galaxie.',
  },
  {
    title: 'Fila de moderação',
    href: '/client/moderation',
    text:
      'Denúncias, conteúdo segurado pelas regras, sugestões da Cosmos e apelações numa fila só, do mais grave para o mais leve. O histórico guarda toda decisão automática ou de pessoa, com a régua da hora. ' +
      'A prévia deixa escrever uma mensagem e ver o que as regras e a Cosmos fariam, sem ir para a fila. O cliente pode acrescentar termos à Lista proibida; as exceções são só da Galaxie.',
  },
  {
    title: 'Cosmos AI: créditos, pacotes, cotas e moderação',
    href: '/client/cosmos',
    text:
      'A Cosmos é a IA que o cliente liga e paga por uso, com créditos pré-pagos. Cada função mostra "cerca de N créditos" antes de rodar e o gasto real depois; resposta que não serve não é cobrada. ' +
      'Na área Cosmos AI: o saldo e o extrato, a compra de pacotes de créditos (os pacotes e preços de cada mercado são definidos pela Galaxie), a recarga automática (compra um pacote sozinha quando o saldo fica abaixo do limite, no cartão salvo), as cotas (reparte o saldo do ciclo entre o chat ao vivo, cada comunidade e o bolão) e o tom da marca para os textos de pré e pós-jogo. ' +
      'Na moderação da Cosmos o cliente escolhe o que ela modera (chat, comunidades, imagens, apelações, resumo da sala), com que rigor e até onde age sozinha; no padrão ela lê só o que foi denunciado ou marcado. Ler tudo é opção paga, com teto.',
  },
  {
    title: 'Webhooks',
    href: '/client/webhooks',
    text:
      'Receba um POST assinado na sua URL a cada mudança: placar, status, lances, onde assistir, cenário e vídeos. Confira o header x-galaxie-signature sobre o corpo bruto, com tolerância de 300 s. ' +
      'O histórico mostra as 20 últimas entregas; as entregues ficam 30 dias e as da DLQ, 90. A Cosmos lê as entregas que falharam e explica o que mudar, e escreve de graça o código para receber os eventos.',
  },
  {
    title: 'Domínios',
    href: '/client/domains',
    text: 'Os domínios da marca, comprovados por um registro TXT no DNS. Em breve, o domínio comprovado entra sozinho nas origens da chave publicável.',
  },
];

const STAFF: PanelGuideChunk[] = [
  {
    title: 'Ajustes da equipe Galaxie: como se organiza',
    href: '/settings',
    staff: true,
    text:
      'Ajustes é a área da equipe Galaxie, que o cliente não vê. Os grupos são Canais, Clientes, Comercial, Conformidade, Dados, Engajamento, Inteligência, Plataforma e Produtos. Itens com o selo "Em breve" ainda não existem e levam à issue da feature. ' +
      'A equipe também entra no painel de qualquer cliente, em todas as áreas, para corrigir, configurar e monitorar; o que a equipe usa da Cosmos sai da conta da Galaxie, não dos créditos do cliente.',
  },
  {
    title: 'Assinaturas e carteiras (Carteiras da Cosmos)',
    href: '/settings/wallets',
    staff: true,
    text:
      'Saldo, consumo, custo real e receita de cada cliente nos últimos 30 dias; a tela não mexe no orçamento da IA interna. Aqui ficam também duas seções: ' +
      'Funções: o catálogo do que a Cosmos faz (por exemplo assistant.ask, o assistente do painel), com o mínimo em créditos, a permissão, o provedor e o modelo de cada função. Toda mudança pede um motivo de pelo menos 5 caracteres, que fica no registro. Modelo vazio usa o modelo leve do provedor; o crédito sai do custo real do modelo, então um modelo mais barato gasta menos créditos do cliente. ' +
      'Pacotes: o que cada mercado vê na compra de créditos (nome, créditos e preço, por mercado e moeda). Preço e créditos ficam no banco, nunca no código.',
  },
  {
    title: 'Ajustes > Cosmos AI',
    href: '/settings/cosmos',
    staff: true,
    text: 'Valor do crédito, teste e teto de segurança diário da Cosmos AI, e as chaves da Cosmos em cada provedor (COSMOS_ANTHROPIC_API_KEY e as outras), separadas das chaves da IA interna. Chave gravada no painel fica cifrada e vale em até 1 minuto.',
  },
  {
    title: 'Ajustes > IA e orçamento (IA interna)',
    href: '/settings/ai',
    staff: true,
    text: 'Política de orçamento, provedor e modelos de todos os agentes de IA internos da Galaxie (não da Cosmos). O teto da IA muda aqui, nunca por banco.',
  },
  {
    title: 'Ajustes > Moderação: regras e listas',
    href: '/settings/moderation',
    staff: true,
    text: 'Termos e domínios que o filtro confere em mensagem, mural, enquete, apelido e nome de Comunidade ou Liga, em todos os clientes. Um termo por linha; cada gravação vira uma versão nova, com o motivo no histórico. O cliente só acrescenta; as exceções são só da Galaxie. Há um teste que confere um texto do jeito que o servidor confere.',
  },
  {
    title: 'Ajustes > Shopping',
    href: '/settings/shopping',
    staff: true,
    text: 'Lojas da Galaxie por país (a mesma rede em dois países são duas lojas), curadoria de produtos por entidade (só produto oficial, com o link da própria loja, sem código de afiliado) e os conectores, que ligam e desligam cada loja sem deploy e guardam as credenciais da conta da Galaxie (gravadas, nunca mostradas de volta).',
  },
  {
    title: 'Ajustes > Grades e ofertas',
    href: '/settings/lineups',
    staff: true,
    text: 'A Galaxie monta sozinha a grade de cada operadora a partir de fontes públicas: tudo entra como rascunho e só o aprovado sai na API. Aprovar aplica a mudança; descartar mantém o dado aprovado. Aqui também se liga cada tenant à grade da operadora dele.',
  },
  {
    title: 'Ajustes > Cadastros, trials e Organizações e marcas',
    href: '/settings/signups',
    staff: true,
    text: 'Cadastros: a fila de cadastros a aprovar, os trials por módulo e o que vence. Organizações e marcas (/settings/organizations): a organização acima do tenant, as marcas, o estado da conta e os ajustes com motivo e validade.',
  },
];

/** Trechos do guia do painel; os da equipe só para quem é da equipe Galaxie. */
export function panelGuideChunks(staff: boolean): DocChunk[] {
  return [...CLIENT, ...(staff ? STAFF : [])].map(({ title, href, text }) => ({ title, href, text }));
}
