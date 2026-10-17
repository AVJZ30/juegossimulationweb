// npm install --no-save playwright && npx playwright install chromium
// node tests/ps2-browser.cjs /absolute/path/to/legal-homebrew.elf (or .iso)
// Uses the actual service worker on localhost, WITHOUT server COOP/COEP headers.
const {chromium}=require('playwright');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=process.argv[2];
if(!file || !fs.existsSync(file)) throw Error('Pass a local legal ELF or ISO file.');
const mime={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!name.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.stat(name,(err,st)=>{
  if(err || !st.isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream'});
  fs.createReadStream(name).pipe(res);
 });
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();
  page.on('console',m=>console.log(m.type(),m.text()));
  page.on('pageerror',e=>console.error('PAGE ERROR',e));
  await page.goto(`http://127.0.0.1:${server.address().port}/ps2.html`);
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./coi-sw.js');await navigator.serviceWorker.ready;});
  await page.reload();
  if(!await page.evaluate(()=>crossOriginIsolated)) throw Error('Service-worker isolation failed');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='test-file';document.body.append(input);});
  await page.locator('#test-file').setInputFiles(path.resolve(file));
  // IndexedDB adapter uses browser transactions; in-game save/reload remains a manual test.
  const result=await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ps2-smoke',1);r.onupgradeneeded=()=>r.result.createObjectStore('cards');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const read=()=>new Promise((resolve,reject)=>{const r=db.transaction('cards').objectStore('cards').get('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   window.smokeRead=read;
   window.smokeSave=files=>new Promise((resolve,reject)=>{const t=db.transaction('cards','readwrite');t.objectStore('cards').put(files,'files');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
   window.smokeError=null;
   await AVJ_PS2.boot(document.querySelector('#test-file').files[0],{memcards:await read()}, {onError:e=>window.smokeError=e,onMemcards:window.smokeSave});
   return AVJ_PS2.diagnostics();
  });
  console.log('Boot requested:',result);
  await page.waitForFunction(()=>window.smokeError || AVJ_PS2.diagnostics().totalFrames>0,{},{timeout:120000});
  const state=await page.evaluate(()=>({error:window.smokeError,...AVJ_PS2.diagnostics()}));
  if(state.error || !state.totalFrames) throw Error(JSON.stringify(state));
  if(!/\.elf$/i.test(file) && !state.reads) throw Error('No disc reads observed');
  console.log('PASS: actual WASM frame counter increased',state);
  // Real in-game saves require a title that writes a memory card; this only requests flush.
  await page.evaluate(()=>AVJ_PS2.persistCards());
 } finally {await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
