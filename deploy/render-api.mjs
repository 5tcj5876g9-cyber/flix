/*
 * ينشر الخدمة على Render عبر REST API.
 * التوكن يقرأ من RENDER_API_KEY فقط — ما يُطبع ولا يُخزن.
 *   RENDER_API_KEY=rnd_xxx node deploy/render-api.mjs
 */

const KEY = process.env.RENDER_API_KEY;
if (!KEY) {
  console.error('RENDER_API_KEY missing');
  process.exit(1);
}

const API = 'https://api.render.com/v1';
const REPO = 'https://github.com/5tcj5876g9-cyber/flix';

async function call(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

const owners = await call('/owners?limit=20');
const owner = owners[0]?.owner ?? owners[0];
if (!owner?.id) throw new Error('no owner found');
console.log('owner:', owner.name ?? owner.id, owner.type);

const existing = await call('/services?limit=100');
const found = (existing ?? [])
  .map((row) => row.service ?? row)
  .find((service) => service.name === 'flix');

let service = found;

if (!service) {
  const payload = {
    type: 'web_service',
    name: 'flix',
    ownerId: owner.id,
    repo: REPO,
    branch: 'main',
    autoDeploy: 'yes',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'HOST', value: '0.0.0.0' },
      { key: 'TRUST_PROXY', value: '1' },
      { key: 'SEED_PAGES', value: '20' },
    ],
    serviceDetails: {
      env: 'docker',
      plan: 'free',
      region: 'frankfurt',
      healthCheckPath: '/healthz',
      envSpecificDetails: {
        dockerfilePath: './Dockerfile',
        dockerContext: '.',
      },
      numInstances: 1,
    },
  };
  const created = await call('/services', { method: 'POST', body: JSON.stringify(payload) });
  service = created.service ?? created;
  console.log('created:', service.id, service.name);
} else {
  console.log('exists:', service.id, service.name, service.serviceDetails?.plan);
}

for (let i = 0; i < 3; i += 1) {
  console.log(`waiting for deploy ${i + 1}/3…`);
  await new Promise((r) => setTimeout(r, 10_000));
}

const detail = await call(`/services/${service.id}`);
const svc = detail.service ?? detail;
console.log(
  JSON.stringify(
    {
      id: svc.id,
      name: svc.name,
      url: svc.serviceDetails?.url ?? null,
      plan: svc.serviceDetails?.plan,
      suspended: svc.suspended,
      autoDeploy: svc.autoDeploy,
    },
    null,
    2,
  ),
);

const deploys = await call(`/services/${service.id}/deploys?limit=3`);
console.log(
  (deploys ?? [])
    .map((row) => row.deploy ?? row)
    .map((deploy) => `${deploy.id} ${deploy.status} ${deploy.commit?.id?.slice(0, 7) ?? ''}`)
    .join('\n'),
);
