// Deletes every production deployment except the newest one.
// Usage: VERCEL_TOKEN=... VERCEL_PROJECT_ID=... [VERCEL_TEAM_ID=...] node scripts/prune-deployments.mjs
const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = process.env;
if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
  console.error('Set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for team projects).');
  process.exit(1);
}
const team = VERCEL_TEAM_ID ? `&teamId=${VERCEL_TEAM_ID}` : '';
const api = (path, opts = {}) =>
  fetch(`https://api.vercel.com${path}`, { ...opts, headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  });

const { deployments } = await api(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=100${team}`);
const sorted = deployments.sort((a, b) => b.created - a.created);
const [keep, ...old] = sorted;
console.log(`keeping ${keep?.url}`);
for (const d of old) {
  await api(`/v13/deployments/${d.uid}?${team.slice(1)}`, { method: 'DELETE' });
  console.log(`deleted ${d.url}`);
}
