// Source-only browser regression: no repository bundles or production services are changed.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
      window.panel = new ChatPanel({look:{name:'Poradce',appearance:DEFAULT_APPEARANCE},strings:widgetStrings('cs'),onVisitorMessage(text,image){window.latestSubmission={text,name:image?.name||null};panel.beginAnswer();window.submissions=(window.submissions||0)+1;},onStop(){window.stops=(window.stops||0)+1;}});
      document.body.append(panel.host);
      panel.restore(messages);
      window.ready = true;
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const fixtureDirectory = mkdtempSync(resolve(tmpdir(), 'chatbot-attachment-e2e-'));
const imagePath = resolve(fixtureDirectory, 'visitor.png');
writeFileSync(imagePath, imageBytes);
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
    // Exercise the same submit/stream signals as a visitor typing, including a second turn.
    for (const turn of [1, 2]) {
      await page.evaluate(turn => {
        panel.host.shadowRoot.querySelector('deep-chat').submitUserMessage({text:'Question ' + turn});
      }, turn);
      await page.waitForFunction(turn => window.submissions === turn, {}, turn);
      for (let delta = 0; delta < 3; delta++) {
        await page.evaluate(() => panel.streamAnswer('A streamed sentence. '.repeat(30)));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const atBottom = await page.evaluate(() => {
          const list = panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages');
          return Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 1;
        });
        assert(atBottom, 'Submitted stream must follow each delta');
      }
      await page.evaluate(() => { panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop = 100; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => panel.streamAnswer('More while reading history.'.repeat(40)));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop), 100);
      await page.evaluate(() => panel.finishAnswer('Final submitted response.'.repeat(220)));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop), 100);
      await page.evaluate(() => panel.host.shadowRoot.querySelector('deep-chat').scrollToBottom());
    }
    // A resumed answer has no submit signals: updating its growing bubble must still follow.
    const listMetrics = () => {
      const list = panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages');
      return { scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight };
    };
    await page.evaluate(() => { panel.beginAnswer(); panel.streamAnswer('Start'); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => panel.streamAnswer(' More resumed content.'.repeat(180)));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resumed = await page.evaluate(listMetrics);
    assert(Math.abs(resumed.scrollHeight - resumed.clientHeight - resumed.scrollTop) <= 1, 'Resumed stream must follow growing content');
    await page.evaluate(() => { panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('#messages').scrollTop = 100; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => panel.streamAnswer(' More while reading history.'.repeat(40)));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await page.evaluate(listMetrics)).scrollTop, 100, 'Resumed stream must preserve manual scroll-up');
    await page.evaluate(() => panel.finishAnswer('Final resumed answer.'.repeat(220)));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await page.evaluate(listMetrics)).scrollTop, 100, 'Final overwrite must preserve manual scroll-up');
    // Scrolling back to the bottom resumes following the next answer.
    await page.evaluate(() => {
      panel.host.shadowRoot.querySelector('deep-chat').scrollToBottom();
      panel.beginAnswer();
      panel.finishAnswer('A single long final response. '.repeat(150));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const final = await page.evaluate(listMetrics);
    assert(Math.abs(final.scrollHeight - final.clientHeight - final.scrollTop) <= 1, 'A new long answer must finish at bottom');
    console.log(JSON.stringify({width,resumed,final}));
    await page.screenshot({ path: '/tmp/chatbot-stream-' + width + '.png' });
    assert.deepEqual(errors, []);
    await page.evaluate(() => panel.beginAnswer());
    const stopState = await page.evaluate(() => {
      const chat = panel.host.shadowRoot.querySelector('deep-chat');
      const stop = chat.shadowRoot.querySelector('.input-button:has([data-cb-stop-icon])');
      if (!stop) throw new Error('Session stop control is missing');
      const rect = stop.getBoundingClientRect();
      const parents = [];
      for (let el=stop.parentElement;el;el=el.parentElement) {
        const css=getComputedStyle(el), box=el.getBoundingClientRect();
        parents.push({id:el.id,overflow:css.overflow,room:[rect.left-box.left,box.right-rect.right,rect.top-box.top,box.bottom-rect.bottom]});
      }
      return {active:chat.hasAttribute('data-answer-active'),label:stop.getAttribute('aria-label'),display:getComputedStyle(stop).display,animation:getComputedStyle(stop).animationName,duration:getComputedStyle(stop).animationDuration,icon:getComputedStyle(stop.querySelector('svg')).animationName,iconFilter:getComputedStyle(stop.querySelector('svg')).filter,iconColor:getComputedStyle(stop.querySelector('svg')).color,color:getComputedStyle(stop).color,border:getComputedStyle(stop).border,parents,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
    });
    console.log(JSON.stringify({width,stopState}));
    assert(stopState.active && stopState.display !== 'none');
    assert.equal(stopState.animation,'stop-pulse');
    assert.equal(stopState.duration,'1.6s');
    assert.equal(stopState.icon,'stop-pulse-icon');
    assert.equal(stopState.iconFilter,'none');
    assert.equal(stopState.iconColor,stopState.color);
    for (const parent of stopState.parents) if(parent.overflow !== 'visible') assert(Math.min(...parent.room)>=16, 'The 16px halo must fit inside clipping ancestors');
    await page.screenshot({path:'/tmp/chatbot-stop-'+width+'.png'});
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    assert.equal(await page.evaluate(() => getComputedStyle(panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('.input-button:has([data-cb-stop-icon])')).animationName),'none');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
    await page.mouse.click(stopState.rect.x+stopState.rect.width/2,stopState.rect.y+stopState.rect.height/2);
    assert.equal(await page.evaluate(() => window.stops),1);
    assert.equal(await page.evaluate(() => panel.host.shadowRoot.querySelector('deep-chat').hasAttribute('data-answer-active')),false);
    assert.deepEqual(errors,[]);
    if (width === 320) {
      await page.setViewport({ width, height: 900, hasTouch: true });
      await page.reload();
      await page.waitForFunction(() => window.ready);
      await page.evaluate(() => panel.open());
    }
    const picker = await page.evaluateHandle(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('.input-button:has(#upload-images-icon)'));
    assert(picker.asElement(), 'Image picker button is absent');
    const choosing = page.waitForFileChooser();
    await picker.asElement().click();
    await (await choosing).accept([imagePath]);
    await page.waitForFunction(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('.input-button.inside-end:not(.custom-button):not(.disabled-button)'));
    const send = await page.evaluateHandle(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelector('.input-button.inside-end:not(.custom-button):not(.disabled-button)'));
    await send.asElement().click();
    await page.waitForFunction(() => window.latestSubmission?.name === 'visitor.png');
    assert.deepEqual(await page.evaluate(() => window.latestSubmission), {text:'',name:'visitor.png'}, 'Image-only turn after chat history reused earlier text');
    console.log(JSON.stringify({width,imageOnly:await page.evaluate(() => window.latestSubmission)}));
    const attachmentState = await page.evaluate(async png => {
      await panel.finishAnswer('Zde jsou soubory.');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      panel.showFeedback('shared-turn', null);
      panel.showAttachment('shared-turn', {kind:'image',storedName:'a'.repeat(64)+'.png',caption:'Náhled'},
        async () => new Blob([new Uint8Array(png)], {type:'image/png'}));
      panel.showAttachment('shared-turn', {kind:'file',storedName:'b'.repeat(64)+'.bin',name:'document.pdf',size:4},
        async () => new Blob(['test'], {type:'application/octet-stream'}));
      return true;
    }, [...imageBytes]);
    assert(attachmentState);
    await page.waitForFunction(() => panel.host.shadowRoot.querySelector('deep-chat').shadowRoot.querySelectorAll('.cb-shared-file a[href^="blob:"]').length === 2, {timeout:5000});
    const shared=await page.evaluate(() => {
      const root=panel.host.shadowRoot.querySelector('deep-chat').shadowRoot;
      const items=[...root.querySelectorAll('.cb-shared-file')];
      return {names:items.map(item=>item.textContent.trim()),links:items.map(item=>item.querySelector('a')?.getAttribute('href').startsWith('blob:')),
        viewportWidth:innerWidth,bodyWidth:document.documentElement.scrollWidth};
    });
    assert.equal(shared.names.length,2);
    assert(shared.names.some(name=>name.includes('document.pdf')));
    assert(shared.links.every(Boolean));
    assert(shared.bodyWidth<=shared.viewportWidth, 'Attachment widens the page');
    await page.screenshot({path:'/tmp/chatbot-attachments-'+width+'.png'});
    console.log(JSON.stringify({width,shared,errors}));
    assert.deepEqual(errors,[]);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  unlinkSync(imagePath);
  rmdirSync(fixtureDirectory);
}
