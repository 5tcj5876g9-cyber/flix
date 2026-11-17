/*
 * ينشئ Space على Hugging Face ويدفع الكود.
 * التوكن من HF_TOKEN، ما يُطبع.
 */

const TOKEN = process.env.HF_TOKEN;
const USER = process.env.HF_USER ?? 'awadmax';
const SPACE = process.env.HF_SPACE ?? 'flix';

if (!TOKEN) {
  console.error('HF_TOKEN missing');
  process.exit(1);
}

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const who = await fetch('https://huggingface.co/api/whoami-v2', { headers }).then((r) => r.json());
console.log('user:', who.name ?? who.user);

const create = await fetch('https://huggingface.co/api/repos/create', {
  method: 'POST',
  headers,
  body: JSON.stringify({ type: 'space', name: SPACE, sdk: 'docker', private: false }),
});
const created = await create.json().catch(() => ({}));
console.log('create:', create.status, JSON.stringify(created).slice(0, 200));

const info = await fetch(`https://huggingface.co/api/spaces/${USER}/${SPACE}`, { headers })
  .then((r) => r.json())
  .catch(() => ({}));
console.log('space:', info.id ?? 'unknown', 'sdk=', info.sdk ?? '?');
console.log('remote:', `https://${USER}:<token>@huggingface.co/spaces/${USER}/${SPACE}`);
console.log('url:', `https://${USER}-${SPACE}.hf.space`);
