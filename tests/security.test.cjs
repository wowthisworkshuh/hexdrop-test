const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(process.env.HEXDROP_HTML||path.join(__dirname,'../index.html'),'utf8');
const between=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start,a);return html.slice(start,end);};
const tick=()=>new Promise(r=>setImmediate(r));
function app(initial={}){
 const db=new Map(Object.entries(initial).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)])),listeners={};
 const c={console,Promise,Uint8Array,Date,Math,JSON,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
  WEB:{feedback:'https://first.example/exec',version:'version.json'},RELAY_OK:/^https:\/\//,SHARE_OK:/^https:\/\//,
  window:{fetch:true,addEventListener:(k,fn)=>listeners[k]=fn,crypto:require('node:crypto').webcrypto},
  navigator:{onLine:true},LS:(k,d)=>db.has(k)?db.get(k):d,SS:(k,v)=>db.set(k,String(v)),DEL:k=>db.delete(k),
  fetch:()=>Promise.reject(new Error('unexpected fetch')),toast:()=>{},$:()=>null,tidyName:x=>x,colorFor:()=> '#FD9CBA',
  document:{hidden:false,addEventListener:()=>{}},MODE_ORDER:['zen','hard','time'],MODES:{},powerUnlocked:()=>false,
  debugOn:false,devRun:false,score:123,mode:'zen',BUILD:'b30',webPlatform:()=>({}),isStandalone:()=>false,
  paintWebRow:()=>{},flushFeedback:()=>{},screen:'game',gameOver:false};
 vm.createContext(c);
 vm.runInContext(between('var RELAY_OK=','function paintWebRow()'),c);
 vm.runInContext(between('function newFeedbackId(){','function fbBindOwners(){'),c);
 vm.runInContext(between('var LB_TZ=','/* ============================ player numbers'),c);
 vm.runInContext(between('function countOn(){','/* ============================ boot'),c);
 c.db=db;c.read=k=>db.has(k)?JSON.parse(db.get(k)):null;feedback(c);
 c.lbPut('hexdrop.lb.caps',{boards:true,count:true,countEventIds:true,url:c.serviceUrl(),protocol:2,at:Date.now()});
 return c;
}
function deferredPosts(c){const requests=[];c.lbPost=(body,endpoint)=>new Promise((resolve,reject)=>requests.push({body,endpoint:endpoint||c.serviceUrl(),resolve,reject}));return requests;}
function identity(extra={}){return {id:'test-player-123',name:'Player',color:'#FD9CBA',revision:1,service:'https://first.example/exec',...extra};}
function feedback(c){vm.runInContext('var FBQ="hexdrop.fbq",fbFlushing=false;'+between('function fbBindOwners(){','function sendFeedback(){')+between('function flushFeedback(){','function startWeb(){'),c);}

test('b30 blocks join and score upload even with old advertised boards, preserving local best',()=>{
 const c=app({'hexdrop.lb.me':identity(),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);
 assert.equal(c.boardsReady(),false);assert.equal(c.lbJoin('Player'),false);c.lbAfterRun();c.lbSync();
 assert.equal(r.length,0);assert.equal(c.read('hexdrop.lb.local').zen.all.s,123);
});
test('period tabs show distinct personal scores offline while public ranking is paused',()=>{
 const c=app(),r=deferredPosts(c),now=Date.now();
 c.MODES={zen:{name:'Zen'},hard:{name:'Hard'},time:{name:'Time Attack'}};c.bestOf=()=>44;
 c.lbPut('hexdrop.lb.local',{zen:{d:{k:c.lbDayKey(now),s:11},m:{k:c.lbMonthKey(now),s:22},all:{s:33}}});
 const buttons=['day','month','all'].map(period=>({period,attributes:{},selected:false,
  getAttribute:()=>period,setAttribute(k,v){this.attributes[k]=v;},classList:{toggle(){}}}));
 const pane={innerHTML:''},tabs={querySelectorAll:()=>buttons};
 const sheet={querySelector:s=>s==='#lbTabs'?tabs:s==='#lbPane'?pane:null,querySelectorAll:()=>[]};
 const body=c.leaderboardBody();for(const period of ['day','month','all'])assert.match(body,new RegExp('data-per="'+period+'"'));
 c.wireBoard(sheet);
 for(const [index,score] of [[0,11],[1,22],[2,44]]){
  buttons[index].onclick();assert.match(pane.innerHTML,new RegExp('<span>'+score+'</span>'));
  assert.equal(buttons[index].attributes['aria-selected'],'true');
  assert.equal(buttons[(index+1)%3].attributes['aria-selected'],'false');
 }
 assert.equal(r.length,0,'personal-score tabs must not submit live requests');
});
test('online period tabs request the selected period even when a previous load is pending',()=>{
 const c=app(),loads=[];c.PUBLIC_BOARDS=true;
 const buttons=['day','month','all'].map(period=>({getAttribute:()=>period,setAttribute(){},classList:{toggle(){}}}));
 const tabs={querySelectorAll:()=>buttons},sheet={querySelector:s=>s==='#lbTabs'?tabs:null};
 c.lbLoad=()=>loads.push(c.lbPeriod);c.lbRefresh=()=>{};c.wireBoardPane=()=>{};
 c.wireBoard(sheet);buttons[1].onclick();buttons[2].onclick();buttons[0].onclick();
 assert.deepEqual(loads,['day','month','all','day']);
});
test('Zen Hard and Time Attack selectors switch personal scores without network requests',()=>{
 const c=app(),r=deferredPosts(c),now=Date.now();c.MODES={zen:{name:'Zen'},hard:{name:'Hard'},time:{name:'Time Attack'}};c.bestOf=()=>0;
 const scores={};for(const [mode,value] of [['zen',111],['hard',222],['time',333]])scores[mode]={d:{k:c.lbDayKey(now),s:value}};
 c.lbPut('hexdrop.lb.local',scores);c.lbMode='zen';
 const buttons=['zen','hard','time'].map(mode=>({getAttribute:()=>mode})),pane={innerHTML:''};
 const sheet={scrollTop:0,querySelector:s=>s==='#lbPane'?pane:null,querySelectorAll:s=>s==='[data-lbmode]'?buttons:[]};
 c.wireBoardPane(sheet);
 for(const [index,value] of [[0,111],[1,222],[2,333]]){
  buttons[index].onclick();assert.equal(c.lbMode,['zen','hard','time'][index]);
  assert.match(pane.innerHTML,new RegExp('<span>'+value+'</span>'));
  assert.match(pane.innerHTML,new RegExp('aria-pressed="true" data-lbmode="'+c.lbMode+'"'));
 }
 assert.equal(r.length,0);assert.doesNotThrow(()=>c.leaderboardBody());
});
test('a health response returned in place of a board cannot poison future opens',async()=>{
 const c=app();c.PUBLIC_BOARDS=true;c.MODES={zen:{name:'Zen'},hard:{name:'Hard'},time:{name:'Time Attack'}};c.lbMode='zen';
 c.lbPost=async()=>({ok:true,features:['feedback','boards','count']});
 assert.equal(await c.lbFetch('zen','day'),null);
 assert.equal(c.read('hexdrop.lb.cache.zen|day'),null);assert.equal(c.lbData['zen|day'],undefined);
 assert.equal(c.lbLoading['zen|day'],false);assert.doesNotThrow(()=>c.leaderboardBody());
});
test('invalid persisted board rows are ignored when reopening the leaderboard',()=>{
 const c=app();c.PUBLIC_BOARDS=true;c.MODES={zen:{name:'Zen'},hard:{name:'Hard'},time:{name:'Time Attack'}};c.lbMode='zen';
 for(const d of [{ok:true},{ok:true,top:null,total:0},{ok:true,top:[null],total:1},{ok:true,top:[],total:0,me:{}}]){
  c.lbPut('hexdrop.lb.cache.zen|day',{d});assert.equal(c.lbCached('zen','day'),null);
  assert.doesNotThrow(()=>c.leaderboardBody());
 }
 const valid={ok:true,top:[{r:1,n:'Player',c:'#FD9CBA',s:123}],total:1,me:null};
 assert.equal(c.lbValidBoard(valid),true);
});
test('late board responses never render into a closed sheet',()=>{
 const c=app();assert.doesNotThrow(()=>c.lbRefresh({isConnected:false,querySelector(){throw new Error('closed sheet touched');}}));
});
test('leave survives a delayed successful join and works without boards capability',async()=>{
 const c=app({'hexdrop.lb.me':identity({pending:true}),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);c.PUBLIC_BOARDS=true;
 c.lbSync();c.lbLeave();c.PUBLIC_BOARDS=false;r[0].resolve({ok:true,name:'Player',color:'#FD9CBA'});await tick();
 assert.equal(r.length,2);assert.equal(r[1].body.action,'leave');assert.equal(c.read('hexdrop.lb.me').leaving,true);
 r[1].resolve({ok:true});await tick();assert.equal(c.read('hexdrop.lb.me'),null);assert.equal(c.LS('hexdrop.lb.choice'),'out');
});
test('leave is drained after an old join fails',async()=>{
 const c=app({'hexdrop.lb.me':identity({pending:true}),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);c.PUBLIC_BOARDS=true;
 c.lbSync();c.lbLeave();r[0].reject(new Error('timeout'));await tick();assert.equal(r[1].body.action,'leave');r[1].resolve({ok:true});await tick();
 assert.equal(c.read('hexdrop.lb.me'),null);
});
test('leave survives a delayed score acknowledgement without reviving the cleared queue',async()=>{
 const c=app({'hexdrop.lb.me':identity(),'hexdrop.lb.choice':'in','hexdrop.lb.q':[{mode:'zen',score:10,at:Date.now()}]}),r=deferredPosts(c);c.PUBLIC_BOARDS=true;
 c.lbSync();assert.equal(r[0].body.action,'scores');c.lbLeave();r[0].resolve({ok:true});await tick();
 assert.equal(r[1].body.action,'leave');assert.equal(c.read('hexdrop.lb.q'),null);r[1].resolve({ok:true});await tick();assert.equal(c.read('hexdrop.lb.me'),null);
});
test('new rename wins over an older join response',async()=>{
 const c=app({'hexdrop.lb.me':identity({pending:true}),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);c.PUBLIC_BOARDS=true;
 c.lbSync();c.lbJoin('NewName');r[0].resolve({ok:true,name:'OldName',color:'#FD9CBA'});await tick();
 assert.equal(c.read('hexdrop.lb.me').name,'NewName');assert.equal(r[1].body.name,'NewName');
 r[1].resolve({ok:true,name:'NewName',color:'#FD9CBA'});await tick();assert.equal(c.read('hexdrop.lb.me').pending,false);
});
test('leave then rejoin cannot be erased by the pending deletion response',async()=>{
 const c=app({'hexdrop.lb.me':identity(),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);c.PUBLIC_BOARDS=true;
 c.lbLeave();c.lbJoin('Rejoined');r[0].resolve({ok:true});await tick();
 assert.equal(c.read('hexdrop.lb.me').name,'Rejoined');assert.equal(r[1].body.action,'join');
 r[1].resolve({ok:true,name:'Rejoined',color:'#FD9CBA'});await tick();assert.equal(c.lbMe().name,'Rejoined');
});
test('configured endpoint moves, disables, and rejects lower configuration revisions',()=>{
 const c=app();assert.equal(c.applyServiceConfig({feedback:'https://second.example/exec',serviceRevision:2}),true);
 assert.equal(c.relayUrl(),'https://second.example/exec');assert.equal(c.serviceUrl(),c.relayUrl());
 assert.equal(c.applyServiceConfig({feedback:'https://old.example/exec',serviceRevision:1}),false);
 c.applyServiceConfig({feedback:false,serviceRevision:3});assert.equal(c.serviceUrl(),'');assert.equal(c.feedbackReady(),false);
});
test('Android service enables feedback without WEB configuration',()=>{
 const c=app();c.WEB=null;c.window.HEXDROP_SERVICE='https://android.example/exec';assert.equal(c.feedbackReady(),true);assert.equal(c.relayUrl(),c.window.HEXDROP_SERVICE);
});
test('stale configuration fetch cannot revert a newer response',async()=>{
 const c=app(),requests=[];vm.runInContext(between('var updateInfo=null','function maybeOfferUpdate(){'),c);
 c.fetch=()=>new Promise(resolve=>requests.push(resolve));c.maybeOfferUpdate=()=>{};
 c.checkForUpdate();c.checkForUpdate();requests[1]({ok:true,json:async()=>({feedback:'https://new.example/exec',serviceRevision:3})});await tick();
 requests[0]({ok:true,json:async()=>({feedback:'https://old.example/exec',serviceRevision:2})});await tick();assert.equal(c.serviceUrl(),'https://new.example/exec');
});
test('legacy player endpoint is pinned before rotation; deletion never leaks ID to new service',async()=>{
 const c=app({'hexdrop.lb.me':{id:'legacy-player',name:'Player'},'hexdrop.lb.choice':'in'}),r=deferredPosts(c);
 c.applyServiceConfig({feedback:'https://second.example/exec',serviceRevision:1});assert.equal(c.read('hexdrop.lb.me').service,'https://first.example/exec');
 c.lbLeave();assert.equal(r.length,1);assert.equal(r[0].endpoint,'https://first.example/exec');r[0].resolve({ok:true});await tick();assert.equal(c.read('hexdrop.lb.me'),null);
});
test('disabled service holds owner-bound deletion until service is reenabled',async()=>{
 const c=app({'hexdrop.lb.me':identity(),'hexdrop.lb.choice':'in'}),r=deferredPosts(c);
 c.applyServiceConfig({feedback:false,serviceRevision:1});c.lbLeave();assert.equal(r.length,0);assert.equal(c.read('hexdrop.lb.me').leaving,true);
 c.applyServiceConfig({feedback:'https://second.example/exec',serviceRevision:2});c.lbSync();assert.equal(r[0].endpoint,'https://first.example/exec');r[0].resolve({ok:true});await tick();
});
test('activity retries keep one event ID and clear only after acknowledgement',async()=>{
 const c=app(),r=deferredPosts(c);c.countActive();const first=r[0].body;
 assert(first.eventId);r[0].reject(new Error('network'));await tick();c.countActive();assert.equal(r[1].body.eventId,first.eventId);
 r[1].resolve({ok:true,duplicate:true});await tick();assert.equal(c.read('hexdrop.count.pending'),null);c.countActive();assert.equal(r.length,2);
});
test('old cached count capability cannot bypass the event-ID protocol handshake',()=>{
 const c=app(),r=deferredPosts(c);c.lbPut('hexdrop.lb.caps',{count:true,boards:true,at:Date.now()});c.countActive();assert.equal(r.length,0);
});
test('activity reports respect opt-out and Global Privacy Control',()=>{
 const c=app({'hexdrop.count':'0'}),r=deferredPosts(c);c.countActive();c.SS('hexdrop.count','1');c.navigator.globalPrivacyControl=true;c.countActive();assert.equal(r.length,0);
});
test('no insecure random fallback is used when browser crypto is unavailable',()=>{
 const c=app();c.window.crypto={};assert.equal(c.newFeedbackId(),'');const r=deferredPosts(c);c.countActive();assert.equal(r.length,0);
 c.window.crypto={getRandomValues:a=>a.fill(255)};assert.match(c.newFeedbackId(),/^[a-f0-9]{32}$/);
});
test('an ambiguous feedback delivery does not block a different queued message',async()=>{
 const c=app();feedback(c);c.setTimeout=fn=>{queueMicrotask(fn);return 0;};
 c.SS('hexdrop.fbq',JSON.stringify([{id:'pending-message',service:c.serviceUrl()},{id:'valid-message',service:c.serviceUrl()}]));
 const sent=[];c.postFeedback=m=>{sent.push(m.id);if(m.id==='pending-message'){const e=new Error('pending');e.code='pending';return Promise.reject(e);}return Promise.resolve({ok:true});};
 c.flushFeedback();await tick();assert.deepEqual(sent,['pending-message','valid-message']);assert.equal(c.fbQueue().length,1);assert.equal(c.fbQueue()[0].id,'pending-message');assert(c.fbQueue()[0].retryAt>Date.now());
});
test('a conflicting feedback ID does not block a different queued message',async()=>{
 const c=app();c.setTimeout=fn=>{queueMicrotask(fn);return 0;};
 c.SS('hexdrop.fbq',JSON.stringify([{id:'conflicting-message',service:c.serviceUrl()},{id:'valid-message',service:c.serviceUrl()}]));
 const sent=[];c.postFeedback=m=>{sent.push(m.id);if(m.id==='conflicting-message'){const e=new Error('id conflict');e.code='id conflict';return Promise.reject(e);}return Promise.resolve({ok:true});};
 c.flushFeedback();await tick();assert.deepEqual(sent,['conflicting-message','valid-message']);assert.equal(c.fbQueue().length,1);
});
test('feedback queued to prior endpoint is held locally after rotation',async()=>{
 const c=app();feedback(c);c.SS('hexdrop.fbq',JSON.stringify([{id:'old-message'}]));c.applyServiceConfig({feedback:'https://second.example/exec',serviceRevision:1});
 const sent=[];c.fetch=url=>{sent.push(url);return Promise.resolve({json:async()=>({ok:true})});};c.flushFeedback();await tick();
 assert.equal(sent.length,0);assert.equal(c.fbQueue()[0].service,'https://first.example/exec');
 await assert.rejects(c.postFeedback(c.fbQueue()[0]),/destination changed/);
});
test('native privacy bridge status refresh and unavailable bridge are handled safely',()=>{
 const c=app();vm.runInContext(between('var nativePrivacyStatus=null;','var settingsTab='),c);
 assert.equal(c.nativePrivacyRequired(),false);c.window.AndroidAds={showPrivacyOptions:()=>{},privacyOptionsRequired:()=>true};assert.equal(c.nativePrivacyRequired(),true);
 c.window.__privacyOptionsChanged(false,null);assert.equal(c.nativePrivacyRequired(),false);
});
function worker(network){
 const listeners={},db=new Map([['./index.html',new Response('<html>game</html>',{headers:{'content-type':'text/html'}})]]),writes=[];
 const key=r=>typeof r==='string'?r:r.url;
 const cache={put:async(k,r)=>{db.set(key(k),r.clone());writes.push(key(k));},addAll:async()=>{}};
 const c={URL,Set,Promise,Response,AbortController,setTimeout,clearTimeout,fetch:network,
  self:{registration:{scope:'https://game.example/hexdrop-test/'},location:{origin:'https://game.example'},addEventListener:(n,f)=>listeners[n]=f},
  caches:{match:async r=>db.get(key(r))?.clone(),open:async()=>cache}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),c);
 return {db,writes,async navigate(file){let response;const waiting=[];listeners.fetch({request:{url:'https://game.example/hexdrop-test/'+file,mode:'navigate',method:'GET'},respondWith:p=>response=p,waitUntil:p=>waiting.push(p)});const r=await response;await Promise.all(waiting);return r;}};
}
test('README navigation does not overwrite the offline game',async()=>{
 let online=true;const w=worker(async()=>{if(!online)throw new Error('offline');return new Response('# README',{headers:{'content-type':'text/markdown'}});});
 assert.equal(await(await w.navigate('README.md')).text(),'# README');assert.equal(w.writes.length,0);online=false;
 assert.equal(await(await w.navigate('')).text(),'<html>game</html>');
});
test('HTTP 503 uses the cached game without caching the error',async()=>{
 const w=worker(async()=>new Response('unavailable',{status:503}));assert.equal(await(await w.navigate('')).text(),'<html>game</html>');assert.equal(w.writes.length,0);
});
test('successful non-HTML game response cannot replace canonical cache',async()=>{
 const w=worker(async()=>new Response('unexpected',{headers:{'content-type':'text/plain'}}));await w.navigate('');assert.equal(w.writes.length,0);assert.equal(await w.db.get('./index.html').text(),'<html>game</html>');
});
test('valid game navigation refreshes the canonical offline document',async()=>{
 const w=worker(async()=>new Response('<html>new game</html>',{headers:{'content-type':'text/html; charset=utf-8'}}));await w.navigate('index.html?v=b30');assert.deepEqual(w.writes,['./index.html']);assert.equal(await w.db.get('./index.html').text(),'<html>new game</html>');
});
