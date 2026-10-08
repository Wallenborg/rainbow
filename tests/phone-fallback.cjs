const puppeteer = require(process.env.RAINBOW_PUPPETEER || 'puppeteer-core');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
  const source = fs.readFileSync('index.html', 'utf8');
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const results = [];
  try {
    for (const ua of [iphone,android]) {
      const page = await browser.newPage();const external=[],errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.setUserAgent(ua);
      await page.evaluateOnNewDocument(()=>{
        window.workerCalls=0;
        window.Worker=class {constructor(){window.workerCalls++;throw Error('Phone must not create a worker');}};
      });
      await page.setRequestInterception(true);
      page.on('request',req=>{
        if(req.url().startsWith('https://rainbow.test/'))req.respond({status:200,contentType:'text/html',body:source});
        else {external.push(req.url());req.abort();}
      });
      for (const [width,height] of [[320,568],[375,667],[390,844],[430,932],[768,1024],[1024,768],[568,320],[667,375],[844,390],[932,430],[320,240]]) {
        await page.setViewport({width,height,isMobile:true,hasTouch:true,deviceScaleFactor:3});
        await page.goto('https://rainbow.test/',{waitUntil:'load'});
        const check = async () => {
          await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
          return page.evaluate(()=>{
          const fallback=document.getElementById('phoneFallback');
          const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          return {phone:window.rainbowPhone,workers:window.workerCalls,diagnostics:typeof window.rainbowDiagnostics,
            artwork:getComputedStyle(document.getElementById('app')).display,
            background:getComputedStyle(fallback).backgroundColor,color:getComputedStyle(fallback).color,
            text:fallback.innerText,title:document.getElementById('phoneTitle').textContent,
            rects:[...fallback.querySelectorAll('h1,p')].map(rect),box:rect(fallback),
            width:innerWidth,height:visualViewport.height};
        });
        };
        function verify(r) {
          assert.equal(r.phone,true);assert.equal(r.workers,0);assert.equal(r.diagnostics,'undefined');assert.equal(r.artwork,'none');
          assert.equal(r.background,'rgb(0, 0, 0)');assert.equal(r.color,'rgb(255, 255, 255)');
          assert.equal(r.title,'Trying to Complete the Rainbow');
          assert(r.text.includes('This artwork requires a desktop browser.'));
          assert(r.text.includes('Please visit this page on a computer to experience the work.'));
          for(const b of r.rects)assert(b.x>=0&&b.y>=0&&b.right<=r.width+.5&&b.bottom<=r.height+.5,JSON.stringify(r));
          assert.equal(r.box.height,r.height);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
        }
        let r=await check();verify(r);results.push({ua:ua===iphone?'iPhone':'Android',width,height,...r});
        await page.setViewport({width:height,height:width,isMobile:true,hasTouch:true,deviceScaleFactor:3});
        r=await check();verify(r);
      }
      if(ua===iphone)await page.screenshot({path:'/private/tmp/rainbow-phone-fallback.png'});
      // Also exercise visual viewport changes without an orientation change.
      await page.evaluate(()=>{
        Object.defineProperty(visualViewport,'height',{get:()=>200});
        visualViewport.dispatchEvent(new Event('resize'));
      });
      assert.equal(await page.$eval('#phoneFallback',el=>el.getBoundingClientRect().height),200);
      assert.deepEqual(external,[]);await page.close();
    }
    // Narrow desktop windows and tablets retain the original AI startup path.
    for(const ua of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
    ]) {
      const page=await browser.newPage();const requests=[];
      await page.setViewport({width:375,height:667});await page.setUserAgent(ua);
      await page.setRequestInterception(true);
      page.on('request',req=>{
        if(req.url().startsWith('https://rainbow.test/'))req.respond({status:200,contentType:'text/html',body:source});
        else {requests.push(req.url());req.abort();}
      });
      await page.goto('https://rainbow.test/',{waitUntil:'load'});
      await page.waitForFunction("document.getElementById('status').textContent.startsWith('detector unavailable:')");
      assert.equal(await page.evaluate(()=>window.rainbowPhone),false);
      assert.equal(await page.$eval('#phoneFallback',el=>getComputedStyle(el).display),'none');
      assert(requests.some(u=>u.includes('@huggingface/transformers@3.8.1')));
      await page.close();
    }
    fs.writeFileSync('/private/tmp/rainbow-phone-fallback-results.json',JSON.stringify(results,null,2));
    console.log('PASS: iPhone/Android phone message at 11 sizes and rotations, no external requests or workers, viewport changes; desktop/tablet startup preserved.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
