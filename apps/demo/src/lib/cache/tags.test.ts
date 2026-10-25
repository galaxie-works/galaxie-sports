import { describe, expect, it } from 'vitest';

import { limitTags, parseSurrogateKey, parseTagList, revalidateProfile } from './tags';

describe('parseSurrogateKey', () => {
  it('separa por espaço e tira repetidas', () => {
    expect(parseSurrogateKey('f1_editorial  team:abc\tf1_editorial')).toEqual(['f1_editorial', 'team:abc']);
    expect(parseSurrogateKey(null)).toEqual([]);
    expect(parseSurrogateKey('')).toEqual([]);
  });
});

describe('limitTags', () => {
  it('até o teto, as tags passam como vieram (sem repetidas, vazias ou longas demais)', () => {
    expect(limitTags(['event:1', 'event', 'event:1', '', 'x'.repeat(257)])).toEqual(['event:1', 'event']);
  });

  it('acima do teto, a coleção com mais entidades vira só a coleção; as raras continuam precisas', () => {
    const events = Array.from({ length: 100 }, (_, i) => `event:${i}`);
    const out = limitTags(['participant:p1', 'standing', 'competition:c1', ...events], 10);
    expect(out).toEqual(expect.arrayContaining(['participant:p1', 'standing', 'competition:c1', 'event']));
    expect(out.some((t) => t.startsWith('event:'))).toBe(false);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it('colapsa quantas coleções forem precisas, da maior para a menor', () => {
    const tags = [
      ...Array.from({ length: 6 }, (_, i) => `event:${i}`),
      ...Array.from({ length: 4 }, (_, i) => `platform:${i}`),
      'where_to_watch:e1',
    ];
    expect(limitTags(tags, 6).sort()).toEqual([
      'event',
      'platform:0',
      'platform:1',
      'platform:2',
      'platform:3',
      'where_to_watch:e1',
    ]);
    expect(limitTags(tags, 5).sort()).toEqual(['event', 'platform', 'where_to_watch:e1']);
  });

  it('a coleção já presente não é repetida', () => {
    const tags = ['event', ...Array.from({ length: 5 }, (_, i) => `event:${i}`), 'team:t1'];
    expect(limitTags(tags, 3)).toEqual(['event', 'team:t1']);
  });
});

describe('revalidateProfile', () => {
  it('coleções do ao vivo em segundo plano; entidades e coleções editoriais expiram na hora', () => {
    expect(revalidateProfile('event')).toBe('max');
    expect(revalidateProfile('standing')).toBe('max');
    expect(revalidateProfile('event:e1')).toEqual({ expire: 0 });
    expect(revalidateProfile('f1_editorial')).toEqual({ expire: 0 });
    expect(revalidateProfile('team_profile')).toEqual({ expire: 0 });
  });
});

describe('parseTagList', () => {
  it('aceita só lista de strings válidas', () => {
    expect(parseTagList(['a', 'a', 1, '', 'b'])).toEqual(['a', 'b']);
    expect(parseTagList('a')).toBeNull();
    expect(
      parseTagList(
        Array.from({ length: 3 }, () => 'a'),
        2,
      ),
    ).toBeNull();
  });
});
