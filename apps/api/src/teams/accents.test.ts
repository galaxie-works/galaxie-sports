import { describe, expect, it } from 'vitest';
import { accentLanguage, accentTeamName } from './accents.js';

describe('accentTeamName — português', () => {
  it('acentua os nomes da lista nos países de língua portuguesa', () => {
    expect(accentTeamName('Sao Paulo', 'BR')).toBe('São Paulo');
    expect(accentTeamName('Gremio', 'BR')).toBe('Grêmio');
    expect(accentTeamName('Atletico-MG', 'BR')).toBe('Atlético-MG');
    expect(accentTeamName('Atletico Paranaense', 'BR')).toBe('Atlético Paranaense');
    expect(accentTeamName('America Mineiro', 'BR')).toBe('América Mineiro');
    expect(accentTeamName('Vitoria', 'BR')).toBe('Vitória');
    expect(accentTeamName('Uniao Rondonopolis', 'BR')).toBe('União Rondonópolis');
    expect(accentTeamName('Nova Iguacu', 'BR')).toBe('Nova Iguaçu');
    expect(accentTeamName('Ceara', 'BR')).toBe('Ceará');
    expect(accentTeamName('Sampaio Correa', 'BR')).toBe('Sampaio Corrêa');
    expect(accentTeamName('Tres Coracoes', 'BR')).toBe('Três Corações');
  });

  it('Portugal escreve com acento agudo onde o Brasil usa circunflexo', () => {
    expect(accentTeamName('Gremio', 'PT')).toBe('Grémio');
    expect(accentTeamName('Academica', 'PT')).toBe('Académica');
    expect(accentTeamName('Academica', 'BR')).toBe('Academica'); // no Brasil seria Acadêmica: fica de fora
    expect(accentTeamName('Pacos Ferreira', 'PT')).toBe('Paços Ferreira');
    expect(accentTeamName('Vitoria Guimaraes', 'PT')).toBe('Vitória Guimarães');
    expect(accentTeamName('Vitoria Setubal', 'PT')).toBe('Vitória Setúbal');
    expect(accentTeamName('Santo Antonio', 'PT')).toBe('Santo António');
    expect(accentTeamName('Gremio Santo Antonio', 'BR')).toBe('Grêmio Santo Antônio');
  });

  it('palavra que só existe acentuada em espanhol não muda no Brasil', () => {
    expect(accentTeamName('Leon', 'BR')).toBe('Leon');
    expect(accentTeamName('Guarani', 'BR')).toBe('Guarani'); // o de Campinas não tem acento
    expect(accentTeamName('Paysandu', 'BR')).toBe('Paysandu');
  });
});

describe('accentTeamName — espanhol', () => {
  it('acentua os nomes da lista nos países de língua espanhola', () => {
    expect(accentTeamName('Leon', 'MX')).toBe('León');
    expect(accentTeamName('Club America', 'MX')).toBe('Club América');
    expect(accentTeamName('America de Cali', 'CO')).toBe('América de Cali');
    expect(accentTeamName('Atletico Nacional', 'CO')).toBe('Atlético Nacional');
    expect(accentTeamName('Independiente Medellin', 'CO')).toBe('Independiente Medellín');
    expect(accentTeamName('Huracan', 'AR')).toBe('Huracán');
    expect(accentTeamName('Penarol', 'UY')).toBe('Peñarol');
    expect(accentTeamName('Cerro Porteno', 'PY')).toBe('Cerro Porteño');
    expect(accentTeamName('Club Guarani', 'PY')).toBe('Club Guaraní');
    expect(accentTeamName('Union Espanola', 'CL')).toBe('Unión Española');
    expect(accentTeamName('Deportivo Tachira', 'VE')).toBe('Deportivo Táchira');
    expect(accentTeamName('Atletico Madrid', 'ES')).toBe('Atlético Madrid');
    expect(accentTeamName('Atletico Guemes', 'AR')).toBe('Atlético Güemes');
    expect(accentTeamName('Atletico Parana', 'AR')).toBe('Atlético Paraná');
    expect(accentTeamName('Santo Antonio', 'AR')).toBe('Santo Antonio'); // em espanhol, sem acento
  });

  it('expressão de várias palavras só quando inteira (San Martín, não qualquer Martin)', () => {
    expect(accentTeamName('San Martin de Tucuman', 'AR')).toBe('San Martín de Tucumán');
    expect(accentTeamName('San  Martin', 'AR')).toBe('San  Martín');
    expect(accentTeamName('Martin FC', 'AR')).toBe('Martin FC');
  });

  it('palavra acentuada só em português não muda nos países hispânicos', () => {
    expect(accentTeamName('Vitoria', 'ES')).toBe('Vitoria'); // Vitoria-Gasteiz não tem acento
    expect(accentTeamName('Gremio', 'AR')).toBe('Gremio');
    expect(accentTeamName('Ferroviario', 'AR')).toBe('Ferroviario');
  });

  it('Cusco já é a grafia certa e fica igual', () => {
    expect(accentTeamName('Cusco', 'PE')).toBe('Cusco');
  });
});

describe('accentTeamName — conservador', () => {
  it('só se aplica a países de língua portuguesa ou espanhola', () => {
    expect(accentTeamName('Sao Paulo', null)).toBe('Sao Paulo');
    expect(accentTeamName('Sao Paulo', undefined)).toBe('Sao Paulo');
    expect(accentTeamName('Leon', 'US')).toBe('Leon');
    expect(accentTeamName('Union Berlin', 'DE')).toBe('Union Berlin');
    expect(accentTeamName('America', 'WORLD')).toBe('America');
  });

  it('nunca acentua parte de palavra nem palavra já acentuada', () => {
    expect(accentTeamName('Saoense', 'BR')).toBe('Saoense');
    expect(accentTeamName('Atlético-GO', 'BR')).toBe('Atlético-GO');
    expect(accentTeamName('Grêmio', 'BR')).toBe('Grêmio');
    expect(accentTeamName('Americano', 'BR')).toBe('Americano');
    expect(accentTeamName('Leones Negros', 'MX')).toBe('Leones Negros');
  });

  it('mantém a caixa do original e os sinais em volta', () => {
    expect(accentTeamName('SAO PAULO', 'BR')).toBe('SÃO PAULO');
    expect(accentTeamName('sao paulo', 'BR')).toBe('são paulo');
    expect(accentTeamName('Sao Paulo U20', 'BR')).toBe('São Paulo U20');
    expect(accentTeamName('Sao Jose (SP)', 'BR')).toBe('São José (SP)');
    expect(accentTeamName('Aguilas Doradas', 'CO')).toBe('Águilas Doradas');
    expect(accentTeamName('', 'BR')).toBe('');
  });

  it('idioma do país', () => {
    expect(accentLanguage('br')).toBe('pt');
    expect(accentLanguage('PT')).toBe('pt');
    expect(accentLanguage('AR')).toBe('es');
    expect(accentLanguage('ES')).toBe('es');
    expect(accentLanguage('GB-ENG')).toBeNull();
    expect(accentLanguage(null)).toBeNull();
  });
});
