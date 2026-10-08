const puppeteer = require(process.env.RAINBOW_PUPPETEER || 'puppeteer-core');
const fs = require('fs');
const assert = require('assert/strict');
const http = require('http');

(async () => {
  const source = fs.readFileSync('index.html', 'utf8');
  const fixture = source.replace('let pipeline, RawImage, env;', `const env = {};
    const RawImage = {fromCanvas: c => ({width:c.width,height:c.height,data:c.getContext('2d').getImageData(0,0,c.width,c.height).data})};`)
    .replace('  loadDetector();', `window.artTest = {inspectItem,acceptFragment,get state(){return state},get token(){return runToken},setDetector(d){detector=d}};`);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url.includes('.js') ? 'text/javascript' : 'text/html');
    res.end(req.url.includes('detector-worker.js') ? fs.readFileSync('detector-worker.js') : req.url.includes('fixture') ? fixture : source);
  });
  await new Promise(r => server.listen(5197, '127.0.0.1', r));
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const results = [];
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const sizes = [[320,568],[375,667],[390,844],[430,932],[768,1024],[1024,768],[1440,900],[568,320],[667,375],[844,390],[932,430],[320,240]];
    async function bounds(label, pixels = false, controls = false) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const result = await page.evaluate(() => {
        const rect = id => {const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const c = document.getElementById('circleCanvas');
        const data = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let painted=0;for(let i=3;i<data.length;i+=4)if(data[i])painted++;
        return {viewport:{width:innerWidth,height:visualViewport.height},canvas:rect('circleCanvas'),ui:rect('minimalUi'),status:rect('status'),text:document.getElementById('status').textContent,
          buttons:[...document.querySelectorAll('button')].map(b=>({visible:getComputedStyle(b).display!=='none',height:b.getBoundingClientRect().height,rect:rect(b.id)})),painted,fragments:window.artTest?.state.fragments.length};
      });
      for (const key of ['canvas','ui','status']) {
        const r = result[key];
        assert(r.x >= 0 && r.y >= 0 && r.right <= result.viewport.width+.5 && r.bottom <= result.viewport.height+.5, label+' '+key+' outside viewport: '+JSON.stringify(result));
        assert(r.width > 0 && r.height > 0, label+' '+key+' collapsed');
      }
      assert.equal(result.canvas.width,result.canvas.height,label+' square');
      assert(result.canvas.bottom <= result.ui.y+.5,label+' canvas overlaps UI');
      if (pixels) assert(result.painted > 0,label+' no fragment pixels');
      if (controls) for(const b of result.buttons){assert(b.visible);assert(b.height>=44);assert(b.rect.bottom<=result.viewport.height);assert(b.rect.right<=result.viewport.width);}
      results.push({label,...result});
    }
    for (const [width,height] of sizes) {
      await page.setViewport({width,height,isMobile:width<1100,hasTouch:true,deviceScaleFactor:3});
      await page.goto('http://127.0.0.1:5197/fixture');
      await page.waitForFunction('window.artTest');
      assert.equal(await page.$eval('#status',e=>e.textContent),'loading rainbow detector…');
      await bounds(`${width}x${height} initial`);
      await page.evaluate(async () => {
        artTest.setDetector(async input=>[{score:.2,label:'rainbow',box:{xmin:input.width*.1,ymin:input.height*.2,xmax:input.width*.9,ymax:input.height*.6}}]);
        const c=document.createElement('canvas');c.width=900;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,400);
        await artTest.inspectItem({title:'fixture',thumburl:c.toDataURL()},artTest.token);
      });
      await bounds(`${width}x${height} first accepted fragment`,true);
      await page.setViewport({width:height,height:width,isMobile:width<1100,hasTouch:true,deviceScaleFactor:3});
      await bounds(`${width}x${height} rotated`,true);
      await page.setViewport({width,height,isMobile:width<1100,hasTouch:true,deviceScaleFactor:3});
      await page.evaluate(() => {
        const c=document.createElement('canvas');c.width=900;c.height=400;c.getContext('2d').fillRect(0,0,900,400);
        for(let i=0;i<300&&!artTest.state.complete;i++)artTest.acceptFragment(c,{score:.2,label:'rainbow'},{title:'completion-'+i});
      });
      assert.equal(await page.$eval('#status',e=>e.textContent),'complete');
      await bounds(`${width}x${height} completion`,true,true);
    }
    // Simulate notches/home indicators and an address bar shrinking the visible viewport.
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await page.goto('http://127.0.0.1:5197/fixture');
    await page.waitForFunction('window.artTest');
    await page.evaluate(() => {document.getElementById('app').style.padding='47px 12px 34px';});
    await bounds('simulated safe areas');
    await page.evaluate(() => {
      window.testViewportHeight=600;
      Object.defineProperty(visualViewport,'height',{get:()=>window.testViewportHeight});
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await bounds('simulated address bar shrink');
    await page.evaluate(() => {window.testViewportHeight=744;visualViewport.dispatchEvent(new Event('resize'));});
    await bounds('simulated address bar expansion');
    await page.evaluate(() => {document.getElementById('status').textContent='detector unavailable: '+ 'download failed '.repeat(12);});
    await bounds('wrapped error with safe areas');
    // The actual, unmodified page must paint status before the external module resolves.
    const startup = await browser.newPage();
    await startup.setViewport({width:320,height:568,isMobile:true,hasTouch:true});
    await startup.setRequestInterception(true);
    let blocked;
    startup.on('request',req=>req.url().includes('cdn.jsdelivr.net') ? blocked=req : req.continue());
    await startup.goto('http://127.0.0.1:5197/',{waitUntil:'domcontentloaded'});
    await startup.waitForFunction("document.getElementById('status').textContent==='loading…'");
    const initial = await startup.$eval('#status',el=>({text:el.textContent,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
    assert(initial.top>=0&&initial.bottom<=568);
    await startup.screenshot({path:'/private/tmp/rainbow-mobile-loading.png'});
    await blocked.abort();
    await startup.waitForFunction("document.getElementById('status').textContent.startsWith('detector unavailable:')");
    results.push({label:'actual page blocked CDN',initial,error:await startup.$eval('#status',el=>el.textContent)});
    // Worker restrictions followed by a CPU initialization failure must show an error.
    const failure = await browser.newPage();
    await failure.setViewport({width:320,height:240,isMobile:true,hasTouch:true});
    await failure.evaluateOnNewDocument(() => {
      window.Worker = class {constructor(){throw new Error('Module workers unavailable (fixture)');}};
    });
    await failure.setRequestInterception(true);
    failure.on('request',req=>req.url().includes('cdn.jsdelivr.net')
      ? req.respond({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`export const env={backends:{onnx:{wasm:{}}}};
          export const RawImage={};
          export async function pipeline(){throw new Error('CPU model could not allocate memory (fixture)');}`})
      : req.continue());
    await failure.goto('http://127.0.0.1:5197/?rainbowBackend=wasm',{waitUntil:'domcontentloaded'});
    await failure.waitForFunction("document.getElementById('status').textContent.includes('CPU model could not allocate memory')");
    const failureStatus = await failure.$eval('#status',el=>({text:el.textContent,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
    assert(failureStatus.top>=0&&failureStatus.bottom<=240);
    results.push({label:'simulated worker restriction and CPU model failure',...failureStatus});
    assert.deepEqual(errors,[]);
    fs.writeFileSync('/private/tmp/rainbow-mobile-results.json',JSON.stringify(results,null,2));
    console.log(`PASS: ${sizes.length} viewports; initial text, rendered fixture pixels, rotation, completion/touch controls, safe areas, viewport changes, wrapped errors and actual CDN failure (${results.length} checks).`);
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
