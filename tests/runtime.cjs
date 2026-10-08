// Real network/model smoke test. Chromium mobile emulation is not a phone runtime.
const puppeteer = require(process.env.RAINBOW_PUPPETEER || 'puppeteer-core');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
(async()=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type',req.url.includes('detector-worker.js')?'text/javascript':'text/html');
    res.end(fs.readFileSync(req.url.includes('detector-worker.js')?'detector-worker.js':'index.html'));
  });
  await new Promise(r=>server.listen(5198,'127.0.0.1',r));
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,userDataDir:process.env.RAINBOW_BENCH_PROFILE||'/private/tmp/rainbow-chrome-bench',args:['--no-sandbox'],protocolTimeout:600000});
  const results=[];
  try {
    for(const mode of ['wasm','auto']){
      const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(/warn|error/.test(m.type()))console.log(mode,m.text().slice(0,250));});
      await page.setViewport(mode==='wasm'?{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3}:{width:1440,height:900});
      await page.goto('http://127.0.0.1:5198/'+(mode==='wasm'?'?rainbowBackend=wasm':''),{waitUntil:'domcontentloaded'});
      console.log(mode,'page loaded; waiting for real Commons detection');
      await page.waitForFunction("rainbowDiagnostics().accepted>0 || document.getElementById('status').textContent.startsWith('detector unavailable:')",{timeout:360000});
      const result=await page.evaluate(()=>{
        const c=document.getElementById('circleCanvas');const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let painted=0;for(let i=3;i<data.length;i+=4)if(data[i])painted++;
        return {diagnostics:rainbowDiagnostics(),status:document.getElementById('status').textContent,painted};
      });
      console.log(mode,JSON.stringify({runtime:result.diagnostics.runtime,status:result.status,accepted:result.diagnostics.accepted,painted:result.painted}));
      assert(result.diagnostics.accepted>0,'real model did not accept a fragment: '+result.status);
      assert(result.painted>0,'accepted photograph has no rendered pixels');
      await page.screenshot({path:'/private/tmp/rainbow-mobile-real-'+mode+'.png'});
      const before=result.diagnostics.currentFragments;
      await page.setViewport(mode==='wasm'?{width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:3}:{width:1024,height:768});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const resized=await page.evaluate(()=>{const c=document.getElementById('circleCanvas'),r=c.getBoundingClientRect(),u=document.getElementById('minimalUi').getBoundingClientRect();return {fragments:rainbowDiagnostics().currentFragments,canvas:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},uiBottom:u.bottom,width:innerWidth,height:innerHeight,painted:c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)};});
      assert(resized.fragments>=before&&resized.painted);assert(resized.canvas.right<=resized.width&&resized.canvas.bottom<=resized.height&&resized.uiBottom<=resized.height);
      assert.deepEqual(errors,[]);results.push({mode,...result,resized,errors});await page.close();
    }
    fs.writeFileSync('/private/tmp/rainbow-mobile-runtime-results.json',JSON.stringify(results,null,2));
    console.log('PASS: real Commons images, model initialization/inference and rendered fragments; mobile-sized WASM and desktop automatic backend; rotation/resize.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
