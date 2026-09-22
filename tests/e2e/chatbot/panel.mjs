// Source-only browser regression: no repository bundles or production services are changed.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const files = new Map();
const register = (file) => { const id = String(files.size); files.set(id, file); return '/source/' + id; };
const panelModule = register(resolve(root, 'plugins/chatbot/embed-src/chatPanel.ts'));
const appearanceModule = register(resolve(root, 'plugins/chatbot/src/appearanceContract.ts'));
const stringsModule = register(resolve(root, 'plugins/chatbot/embed-src/strings.ts'));
function source(file) {
  const rewrite = context => {
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        let target = spec === 'deep-chat' ? resolve(root, 'node_modules/deep-chat/dist/deepChat.js') : resolve(dirname(file), spec);
        if (!existsSync(target) && target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
        const literal = context.factory.createStringLiteral(register(target));
        return ts.isImportDeclaration(node)
          ? context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, literal, node.attributes)
          : context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, literal, node.attributes);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  };
  return ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { after: [rewrite] },
  }).outputText;
}
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (req.url.startsWith('/source/')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(source(files.get(req.url.slice(8)))); return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel regression</title>
    <style>body{font:16px system-ui;margin:16px}</style><h1>Obnovená konverzace</h1>
    <script type="module">
      import { ChatPanel } from '${panelModule}';
      import { DEFAULT_APPEARANCE } from '${appearanceModule}';
      import { widgetStrings } from '${stringsModule}';
      const messages = JSON.parse(localStorage.getItem('transcript') || '[]');
      window.panel = new ChatPanel({look:{name:'Poradce',appearance:DEFAULT_APPEARANCE},strings:widgetStrings('cs'),onVisitorMessage(){},onStop(){}});
      document.body.append(panel.host);
      panel.restore(messages);
      window.ready = true;
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.E2E_BROWSER_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 320]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(request.url()));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => localStorage.setItem('transcript', JSON.stringify(Array.from({length:60}, (_,i) => ({ role: i % 2 ? 'ai' : 'user', text: 'Zpráva ' + i + ': Delší konverzace musí po obnovení ukázat poslední odpověď, nikoli začátek historie.' })))));
    await page.reload();
    await page.waitForFunction(() => window.ready && panel.host.shadowRoot.querySelector('deep-chat').getMessages().length === 60);
    await page.evaluate(() => panel.open());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => {
      const chat = panel.host.shadowRoot.querySelector('deep-chat');
      const list = chat.shadowRoot.querySelector('#messages');
      const input = chat.shadowRoot.querySelector('#text-input-container');
      const button = chat.shadowRoot.querySelector('.input-button');
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height, centerY:r.y+r.height/2 }; };
      return { scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,input:rect(input),button:rect(button) };
    });
    console.log(JSON.stringify({width,...metrics,errors}));
    await page.screenshot({ path: '/tmp/chatbot-panel-' + width + '.png' });
    assert(metrics.scrollHeight > metrics.clientHeight);
    assert(Math.abs(metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop) <= 1, 'Restored transcript must be at bottom');
    assert(Math.abs(metrics.input.centerY - metrics.button.centerY) <= 1, 'Send button must be vertically centered');
    // Once restored, opening and resizing must leave the visitor's chosen reading position alone.
    await page.evaluate(() => {
      panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop = 100;
      panel.close(); panel.open();
    });
    await page.setViewport({ width, height: 950 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop), 100);
    // The same alignment applies to a multiline draft and the enabled/hovered send button.
    await page.evaluate(() => {
      const input = panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#text-input');
      input.innerText = 'První řádek\nDruhý řádek';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const centers = await page.evaluate(() => {
      const shadow = panel.host.shadowRoot.querySelector('deep-chat').shadowRoot;
      const field = shadow.querySelector('#text-input-container').getBoundingClientRect();
      const button = shadow.querySelector('.input-button').getBoundingClientRect();
      return { field:field.y+field.height/2, button:button.y+button.height/2, x:button.x+button.width/2 };
    });
    await page.mouse.move(centers.x, centers.button);
    assert(Math.abs(centers.field-centers.button) <= 1);
    assert.deepEqual(errors, []);
    // A panel can be mounted below an initially hidden ancestor. Only layout observation sees its reveal.
    await page.evaluate(() => {
      panel.host.style.display = 'none';
      panel.restore([{role:'ai',text:'Poslední obnovená odpověď'}]);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { panel.host.style.display = ''; });
    await page.waitForFunction(() => {
      const list = panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages');
      return Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 1;
    });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
