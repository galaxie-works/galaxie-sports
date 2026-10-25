const API = process.env.GALAXIE_API_URL ?? 'http://api:8080';
const KEY = process.env.GALAXIE_DEMO_KEY ?? '';
const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: { 'x-galaxie-key': KEY } });
  return [r.status, r.ok ? await r.json() : await r.text()];
};
for (const sport of [
  'basketball',
  'american-football',
  'handball',
  'volleyball',
  'mma',
  'nba',
  'baseball',
  'rugby',
  'formula-1',
]) {
  const [s, b] = await get(`/v1/competitions?sport=${sport}&limit=3`);
  const d = b?.data ?? [];
  console.log(
    sport,
    s,
    d.length,
    d
      .slice(0, 2)
      .map((c) => `${c.name}|${c.country?.code ?? c.country_code ?? '-'}|logo:${c.logo_url ? 'sim' : 'não'}`)
      .join(' ; '),
  );
}
const [s2, eq] = await get('/v1/equestrian/athletes?limit=2');
console.log('equestrian', s2, JSON.stringify(eq).slice(0, 200));
