// Optional engine integration check: real input, merge, save and Continue.
// Uses only a test-local saved run. No game debug hooks or live service requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.HEXDROP_HTML||path.join(root,'index.html'));
const build=source.toString().match(/var BUILD\s*=\s*"([^"]+)"/)[1];
(async()=>{
 const engine=process.env.BROWSER_ENGINE||'webkit';let server,browser;
 try{
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname!=='/'&&pathname!=='/index.html'){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':'text/html'});res.end(source);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/`;
  browser=await playwright[engine].launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const external=[];
  await context.route('**/*',route=>{
   if(route.request().url().startsWith(base))return route.continue();
   external.push(route.request().url());return route.abort();
  });
  await context.addInitScript(build=>{
   if(sessionStorage.getItem('hexdrop.merge-test-seeded'))return;
   localStorage.setItem('hexdrop.run.v2',JSON.stringify({v:3,mode:'zen',score:0,drops:0,chain:0,combo:0,nextRiseAt:10,
    cols:[[0,0],[],[],[],[],[]],bag:[0,1,2,0],held:null,focus:[-1,-1],mergeAgo:10000,pc:null,pq:[]}));
   localStorage.setItem('hexdrop.seen','1');localStorage.setItem('hexdrop.seen.zen','1');
   localStorage.setItem('hexdrop.patchNotesSeen',build);
   localStorage.setItem('hexdrop.installSeen',String(Date.now()));
   localStorage.setItem('hexdrop.muted','1');
   localStorage.setItem('hexdrop.service',JSON.stringify({url:'',revision:999}));
   sessionStorage.setItem('hexdrop.merge-test-seeded','1');
  },build);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-act="continue"]').tap();
  await page.waitForFunction(()=>!document.getElementById('holdBtn').disabled,{},{timeout:10000});
  assert.equal(await page.locator('#modePill').innerText(),'ZEN');
  const board=await page.locator('#cv').boundingBox();assert(board);
  // Six hex columns span 9.5 tile radii; the first centre is one radius in.
  await page.touchscreen.tap(board.x+board.width/9.5,board.y+board.height/2);
  await page.waitForFunction(()=>{
   const run=JSON.parse(localStorage.getItem('hexdrop.run.v2')||'null');
   return run&&run.drops===1&&run.score>0&&run.cols[0].length===1&&run.cols[0][0]===1&&
    run.cols.slice(1).every(column=>column.length===0)&&!document.getElementById('holdBtn').disabled;
  },{},{polling:100,timeout:10000});
  const merged=await page.evaluate(()=>JSON.parse(localStorage.getItem('hexdrop.run.v2')));
  await page.locator('#backBtn').tap();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('hexdrop.run.v2')));
  assert.equal(saved.score,merged.score);assert.deepEqual(saved.cols,merged.cols);assert.equal(saved.drops,1);
  await page.reload();await page.locator('[data-act="continue"]').tap();
  await page.waitForFunction(()=>!document.getElementById('holdBtn').disabled,{},{timeout:10000});
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('hexdrop.run.v2')));
  assert.equal(restored.score,merged.score);assert.deepEqual(restored.cols,merged.cols);assert.equal(restored.drops,1);
  assert.equal((await page.locator('#score').innerText()).replace(/\D/g,''),String(merged.score));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`PASS ${engine}: touch drop merged three tier-0 tiles into tier 1; score ${merged.score}; board and score preserved through menu, reload and Continue`);
 }finally{
  if(browser)await browser.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
