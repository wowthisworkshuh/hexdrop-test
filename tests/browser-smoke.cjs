// Optional integration check. Requires externally installed Playwright + Chromium.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const engine=require(process.env.PLAYWRIGHT_MODULE||'playwright')[process.env.BROWSER_ENGINE||'chromium'];
const packed=process.env.CHROMIUM_MODULE?require(process.env.CHROMIUM_MODULE):null;
const root=path.resolve(__dirname,'..');
(async()=>{
 let unavailable=false,browser,server;
 try{
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost'),relative=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(root,relative);
   if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   if(unavailable&&relative==='index.html'){res.writeHead(503);res.end('unavailable');return;}
   const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.md':'text/markdown','.png':'image/png','.webmanifest':'application/manifest+json'};
   fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
  browser=await engine.launch(packed?{executablePath:await packed.executablePath(),args:packed.args,headless:true}:{headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
  if(await page.locator('#sheet .close').count()) await page.locator('#sheet .close').evaluate(b=>b.click());
  await page.locator('#modes button[data-mode="zen"]').evaluate(b=>b.click());
  if(await page.locator('#sheetGo').count()) await page.locator('#sheetGo').evaluate(b=>b.click());
  await page.waitForTimeout(1500);
  const board=await page.locator('#cv').boundingBox();assert(board);
  await page.locator('#cv').dispatchEvent('pointerdown',{clientX:board.x+board.width/2,clientY:board.y+board.height/2});
  await page.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('hexdrop.run.v2')||'null');return saved&&saved.drops===1;},{},{polling:100,timeout:10000});
  assert.equal(await page.locator('#cv').isVisible(),true);assert.equal(await page.locator('#modePill').innerText(),'ZEN');
  assert.deepEqual(errors,[],'full game startup and canvas input must have no JavaScript errors');
  await page.locator('#backBtn').click();
  await page.evaluate(()=>{
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
    const day=p.year+'-'+p.month+'-'+p.day,month=p.year+'-'+p.month;
    localStorage.setItem('hexdrop.lb.local',JSON.stringify({zen:{d:{k:day,s:111},m:{k:month,s:222},all:{s:333}},hard:{d:{k:day,s:555}},time:{d:{k:day,s:666}}}));
    localStorage.setItem('hexdrop.best.zen','444');
  });
  await page.locator('#mBoard').click();
  assert.equal(await page.locator('#sheet .sheethead #lbTabs').count(),1);
  for(const [period,score] of [['day',111],['month',222],['all',444]]){
    const tab=page.locator('[data-per="'+period+'"]');await tab.tap();
    assert.equal(await tab.getAttribute('aria-selected'),'true');
    assert.match(await page.locator('#lbPane').innerText(),new RegExp('\\b'+score+'\\b'));
  }
  await page.locator('[data-per="day"]').tap();
  for(let reopen=0;reopen<3;reopen++){
    for(const [mode,score] of [['hard',555],['time',666],['zen',111]]){
      const button=page.locator('[data-lbmode="'+mode+'"]');await button.tap();
      assert.equal(await page.locator('[data-lbmode="'+mode+'"]').getAttribute('aria-pressed'),'true');
      assert.match(await page.locator('#lbPane').innerText(),new RegExp('\\b'+score+'\\b'));
    }
    await page.locator('#sheet .close').tap();await page.locator('#mBoard').tap();
    assert.equal(await page.locator('#lbTabs').count(),1);
    assert.equal(await page.locator('[data-lbmode]').count(),3);
  }
  unavailable=true;let response=await page.goto(base);assert(response.fromServiceWorker());assert.equal(response.status(),200);assert.match(await response.text(),/<html/i);unavailable=false;
  response=await page.goto(base+'README.md');assert.match(await response.text(),/^# Hex Drop:/);
  server.closeAllConnections();await new Promise(r=>server.close(r));server=null;
  response=await page.goto(base);assert(response.fromServiceWorker());assert.match(response.headers()['content-type'],/^text\/html/);assert.match(await response.text(),/<html/i);
  assert.deepEqual(errors,[]);console.log('PASS: saved tile drop, touch period/mode switches, repeated leaderboard reopen, HTTP 503 fallback, README navigation, offline HTML game');
 }finally{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
})().catch(e=>{console.error(e);process.exitCode=1;});
