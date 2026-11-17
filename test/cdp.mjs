/*
 * أداة CDP صغيرة: تتنقل وتقرأ الصفحة وتضغط زر بالاسم.
 *   node test/cdp.mjs open <url>
 *   node test/cdp.mjs click "<نص الزر>"
 *   node test/cdp.mjs text
 *   node test/cdp.mjs wait <selector>
 */

const PORT = process.env.CDP_PORT ?? 9222;
const base = `http://127.0.0.1:${PORT}`;

async function targets() {
  const res = await fetch(`${base}/json/list`);
  return res.json();
}

async function connect() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => ws.close(), pageUrl: page.url };
}

const evaluate = async (send, expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
};

const [, , command, ...rest] = process.argv;
const arg = rest.join(' ');

const { send, close } = await connect();

try {
  if (command === 'open') {
    await send('Page.enable');
    await send('Page.navigate', { url: arg });
    await new Promise((r) => setTimeout(r, 6000));
    console.log('url:', await evaluate(send, 'location.href'));
    console.log(await evaluate(send, 'document.body.innerText.slice(0,1500)'));
  } else if (command === 'text') {
    console.log('url:', await evaluate(send, 'location.href'));
    console.log(await evaluate(send, 'document.body.innerText.slice(0,2500)'));
  } else if (command === 'click') {
    const clicked = await evaluate(
      send,
      `(() => {
        const want = ${JSON.stringify(arg)}.toLowerCase();
        const nodes = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')];
        const hit = nodes.find((n) => ((n.innerText || n.value || n.getAttribute('aria-label') || '').toLowerCase().includes(want)) && !n.disabled);
        if (!hit) return 'NOT_FOUND';
        hit.scrollIntoView({ block: 'center' });
        hit.click();
        return 'CLICKED: ' + (hit.innerText || hit.value || '').trim().slice(0, 60);
      })()`,
    );
    console.log(clicked);
    await new Promise((r) => setTimeout(r, 4000));
    console.log('url:', await evaluate(send, 'location.href'));
  } else if (command === 'eval') {
    const value = await evaluate(send, arg);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } else if (command === 'shot') {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(arg || 'shot-browser.png', Buffer.from(shot.data, 'base64'));
    console.log('saved', arg || 'shot-browser.png');
  } else if (command === 'wait') {
    for (let i = 0; i < 20; i += 1) {
      const found = await evaluate(send, `!!document.querySelector(${JSON.stringify(arg)})`);
      if (found) {
        console.log('found:', arg);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('url:', await evaluate(send, 'location.href'));
  } else {
    console.log('usage: open <url> | text | click <label> | wait <selector>');
  }
} finally {
  close();
}
