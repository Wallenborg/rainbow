const puppeteer = require(process.env.RAINBOW_PUPPETEER || 'puppeteer-core');
const fs = require('fs');
const assert = require('assert/strict');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,timeout:120000,args:['--no-sandbox']});
 try {
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const html=fs.readFileSync(process.cwd()+'/index.html','utf8').replace(/import \{[\s\S]*?from "https:[^"]+";/,`const env = {}; const pipeline = async () => window.mockDetector;
 const RawImage = {fromCanvas: c => ({width:c.width,height:c.height,data:c.getContext('2d').getImageData(0,0,c.width,c.height).data})};`).replace('  loadDetector();',`  window.artTest = { acceptFragment, fragmentCoverage, recomputeCoverage, checkCompletion, renderCompositionToCanvas, prepareImage, inspectItem, inferSerial, createBrowserDetector, refillQueue, searchSession, getSafeFragmentPosition, get state(){return state}, setDetector(d){detector=d}, get token(){return runToken} };`);
 await page.setRequestInterception(true);
 page.on('request',req=>{
 if(req.url().startsWith('https://rainbow.test')) return req.respond({status:200,contentType:'text/html',body:html});
 if(req.url().startsWith('https://commons.wikimedia.org')) {const u=new URL(req.url());const category=u.searchParams.get('gcmtitle'); return req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({continue:{gcmcontinue:'next-'+category},query:{pages:[{title:'File:'+category+u.searchParams.get('gcmcontinue'),imageinfo:[{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6woAAAAASUVORK5CYII=',mime:'image/png'}]}]}})});}
 req.abort();
 });
 await page.goto('https://rainbow.test'+(process.env.RAINBOW_TEST_INPUT ? '?rainbowInput='+process.env.RAINBOW_TEST_INPUT : ''));
 const results=await page.evaluate(async()=>{
 const t=artTest; const c=document.createElement('canvas');c.width=900;c.height=400;c.getContext('2d').fillRect(0,0,520,240);
 let calls=0,active=0,maxActive=0;
 t.setDetector(async(input,labels,opts)=>{calls++;active++;maxActive=Math.max(maxActive,active);if(opts.top_k!==8)throw Error('top_k');await new Promise(r=>setTimeout(r,5));active--;return [{score:0.2,label:'rainbow',box:{xmin:input.width*.1,ymin:input.height*.2,xmax:input.width*.9,ymax:input.height*.6}}]});
 await Promise.all([t.inferSerial({width:100,height:100},t.token),t.inferSerial({width:100,height:100},t.token)]);
 const url=c.toDataURL();const a=t.prepareImage({thumburl:url}),b=t.prepareImage({thumburl:url});const reused=a===b;await a;
 await t.inspectItem({thumburl:url,title:'fixture'},t.token);
 const detected=t.state.fragments.length===1;
 const uniqueBefore=t.state.fragments.length;
 t.acceptFragment(c,{label:'rainbow',score:.2},{title:'fixture'});
 const titleDeduplicated=t.state.fragments.length===uniqueBefore;
 t.acceptFragment(c,{label:'rainbow',score:.2},{title:'hashed',sha1:'same-photo'});
 const hashBefore=t.state.fragments.length;
 t.acceptFragment(c,{label:'rainbow',score:.2},{title:'alias',sha1:'same-photo'});
 const hashDeduplicated=t.state.fragments.length===hashBefore;
 await t.refillQueue();
 const continuation = t.searchSession.categoryStates[0].continueToken === 'next-Category:Quality images of rainbows';
 const seenBefore = t.searchSession.seenTitles.size;
 t.searchSession.categoryIndex=0;
 await t.refillQueue();
 const pagination = t.searchSession.seenTitles.size === seenBefore+1;
 // Removing a photograph must clear its contribution.
 const saved=t.state.fragments.slice();t.state.fragments.length=0;t.recomputeCoverage();
 const coverageClears=t.state.coveredSectors.every(v=>!v);
 t.state.fragments.push(...saved);t.recomputeCoverage();
 let added=0;while(!t.state.complete&&added<300){t.acceptFragment(c,{label:'rainbow',score:.2},{title:'fixture'+added});added++}
 const complete=t.state.complete;
 // A late model result must be discarded after completion invalidates its token.
 const oldToken=t.token;
 t.state.paused=false;
 const late=t.inspectItem({thumburl:url,title:'late'},oldToken);
 t.state.paused=true;
 const count=t.state.fragments.length;
 await late;
 const lateDiscarded=t.state.fragments.length===count;
 const apiBefore=rainbowDiagnostics().apiRequests;
 const status=document.querySelector('#status').textContent;
 const controls=[...document.querySelectorAll('button')].every(b=>b.classList.contains('is-visible'));
 const exportC=document.createElement('canvas');exportC.width=exportC.height=3000;t.renderCompositionToCanvas(exportC);
 const placement=t.state.fragments[0];const screen=t.getSafeFragmentPosition(placement,400,400,216,800,800);const exp=t.getSafeFragmentPosition(placement,1500,1500,810,3000,3000);
 const exportMatches=Math.abs(screen.x/800-exp.x/3000)<1e-8 && Math.abs(screen.y/800-exp.y/3000)<1e-8;
 await t.refillQueue(); // completed state should prevent request
 const completionStopsApi=rainbowDiagnostics().apiRequests===apiBefore;
 const png=await new Promise(resolve=>exportC.toBlob(resolve,'image/png'));
 const pngValid=png.type==='image/png'&&png.size>0;
 t.searchSession.seenTitles.add('sentinel');t.searchSession.categoryStates[0].continueToken='continuation';
 document.querySelector('#newRainbowBtn').click();
 const session=t.searchSession.seenTitles.has('sentinel');const reset=t.state.fragments.length===0&&!t.state.complete;
 // Stop the reset's autonomous loop to inspect pagination deterministically.
 t.state.paused=true;
 await new Promise(r=>setTimeout(r,30));
 const snapshot=rainbowDiagnostics();
 // Directly inserted fixture fragments bypass inference; do not treat their ratio as a benchmark.
 delete snapshot.acceptanceRate;
 return {maxActive,reused,detected,titleDeduplicated,hashDeduplicated,continuation,pagination,coverageClears,lateDiscarded,completionStopsApi,pngValid,complete,status,controls,exportMatches,session,reset,added,snapshot};
 });
 assert.equal(results.maxActive,1);for(const key of ['reused','detected','titleDeduplicated','hashDeduplicated','continuation','pagination','coverageClears','lateDiscarded','completionStopsApi','pngValid','complete','controls','exportMatches','session','reset'])assert.equal(results[key],true,key);
 assert.equal(results.status,'complete'); assert.deepEqual(errors,[]);
 console.log(JSON.stringify(results,null,2));
 // Exercise backend failures without model downloads, in a fresh application.
 await page.goto('https://rainbow.test');
 const fallback = await page.evaluate(async () => {
   let initializationFailure = true;
   let inferenceFailure = false;
   let gpuAttempts = 0, cpuAttempts = 0, active = 0, maxActive = 0;
   window.Worker = class {
     postMessage(message) {
       if (message.type === 'init') {
         this.device = message.options.device;
         queueMicrotask(() => {
           this.onmessage({data: this.device === 'webgpu' && initializationFailure
             ? {id: message.id, error: 'GPU initialization failed'}
             : {id: message.id, result: {device:this.device, dtype:message.options.dtype, worker:true}}});
         });
       } else {
         if (this.device === 'webgpu') gpuAttempts++; else cpuAttempts++;
         active++;maxActive=Math.max(maxActive,active);
         setTimeout(() => {
           active--;
           this.onmessage({data:this.device==='webgpu' && inferenceFailure
             ? {id:message.id,error:'device lost'}
             : {id:message.id,result:{detections:[],timings:{modelMs:4,preprocessMs:1,tokenizationMs:0,postprocessMs:0,pipelineMs:5}}}});
         }, 5);
       }
     }
     terminate() {}
   };
   const first = await artTest.createBrowserDetector('webgpu');
   const initializationFallback = rainbowDiagnostics().runtime.device === 'wasm';
   first.dispose();
   initializationFailure = false;
   const gpu = await artTest.createBrowserDetector('webgpu');
   artTest.setDetector(gpu);
   inferenceFailure = true;
   const input = {data:new Uint8ClampedArray(16),width:2,height:2};
   await Promise.all([artTest.inferSerial(input,artTest.token),artTest.inferSerial(input,artTest.token)]);
   return {initializationFallback, inferenceFallback:rainbowDiagnostics().runtime.device==='wasm',
     gpuAttempts,cpuAttempts,maxActive,pixelsRetained:input.data.byteLength===16,
     fallbacks:rainbowDiagnostics().backendFallbacks};
 });
 assert.equal(fallback.initializationFallback,true);
 assert.equal(fallback.inferenceFallback,true);
 assert.equal(fallback.maxActive,1);
 assert.equal(fallback.gpuAttempts,1);
 assert.equal(fallback.cpuAttempts,2);
 assert.equal(fallback.pixelsRetained,true);
 assert.equal(fallback.fallbacks,2);
 console.log(JSON.stringify({fallback},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
