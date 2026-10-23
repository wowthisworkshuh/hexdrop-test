const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(process.env.HEXDROP_HTML||path.join(__dirname,'../index.html'),'utf8');
function section(a,b){const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start,a);return html.slice(start,end);}
function fixture(options={}){
 const measures=[],draws=[],events={},loads=[];let clears=0;
 const fontSet=options.fontSet||{ready:new Promise(()=>{}),addEventListener:(name,fn)=>events[name]=fn,load:font=>{loads.push(font);return Promise.resolve([]);}};
 const ctx={font:'700 10.0px Lexend',textBaseline:'top',textAlign:'center',
  measureText(text){measures.push({text,font:this.font,baseline:this.textBaseline});return options.measure?options.measure(text,this.font):{
   width:11,actualBoundingBoxLeft:4,actualBoundingBoxRight:6,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2};},
  fillText(...args){draws.push({args,baseline:this.textBaseline,font:this.font});}};
 const c={Map,ctx,document:{fonts:fontSet},SHAPES:{hex:{font:'Lexend, sans-serif'},circle:{font:'Nunito, sans-serif'}},
  clearBoardTileCache:()=>clears++};vm.createContext(c);
 vm.runInContext(section('var GLYPH_CACHE_MAX=','function drawDotRing(')+section('function digitWidth(','/* half the width and half the height')+section('function warmFonts(){','function start(snap){'),c);
 return {c,ctx,measures,draws,events,loads,get clears(){return clears;}};
}

test('width, height and drawing share one measurement for one effective font and digit',()=>{
 const f=fixture();assert.equal(f.c.digitWidth(3,10,'Lexend'),10);assert.equal(f.c.digitHeight(3,10,'Lexend'),10);
 assert.equal(f.c.drawDigit(3,20,5,10,'Lexend','#fff'),10);assert.equal(f.measures.length,1);
 assert.deepEqual(f.draws[0].args,['3',20,13]);assert.equal(f.draws[0].baseline,'alphabetic');
});
test('font family, existing tenth-pixel size and digit text stay distinct',()=>{
 const f=fixture();f.c.digitWidth(1,10,'Lexend');f.c.digitWidth(1,10,'Nunito');f.c.digitWidth(2,10,'Lexend');f.c.digitWidth(1,10.1,'Lexend');
 assert.equal(f.measures.length,4);f.c.digitHeight(1,10,'Lexend');assert.equal(f.measures.length,4);
});
test('memoization uses the effective font already assigned to the context',()=>{
 const f=fixture();let effective='700 10px Lexend';Object.defineProperty(f.ctx,'font',{get:()=>effective,set:value=>{effective=value.replace('10.0px','10px');}});
 f.c.digitWidth(1,10,'Lexend');f.ctx.font='700 10px Lexend';f.c.glyphBox('1');assert.equal(f.measures.length,1);
});
test('memoization does not quantize beyond the existing one-decimal font assignment',()=>{
 const f=fixture();f.c.digitWidth(1,10.04,'Lexend');f.c.digitWidth(1,10.049,'Lexend');assert.equal(f.measures.length,1);
 f.c.digitWidth(1,10.06,'Lexend');assert.equal(f.measures.length,2);assert.equal(f.measures[1].font,'700 10.1px Lexend');
});
test('alphabetic baseline is restored even on a cache hit',()=>{
 const f=fixture();f.c.glyphBox('1');f.ctx.textBaseline='middle';f.c.glyphBox('1');assert.equal(f.ctx.textBaseline,'alphabetic');
 f.ctx.textBaseline='top';f.c.digitWidth(1,10,'Lexend');assert.equal(f.ctx.textBaseline,'alphabetic');assert.equal(f.measures.length,1);
 assert.equal(f.measures[0].baseline,'alphabetic');
});
test('animated font sizes cannot grow the cache beyond its declared bound',()=>{
 const f=fixture(),max=f.c.GLYPH_CACHE_MAX;for(let i=0;i<max+40;i++)f.c.digitWidth(1,10+i/10,'Lexend');
 assert.equal(f.c.glyphMetricsCache.size,max);const measured=f.measures.length;
 f.c.digitWidth(1,10+(max+39)/10,'Lexend');assert.equal(f.measures.length,measured);
 f.c.digitWidth(1,10,'Lexend');assert.equal(f.measures.length,measured+1);assert.equal(f.c.glyphMetricsCache.size,max);
});
test('explicit reset clears glyph metrics and the optional board-tile cache hook',()=>{
 const f=fixture();f.c.digitWidth(1,10,'Lexend');f.c.resetRenderCaches();assert.equal(f.c.glyphMetricsCache.size,0);assert.equal(f.clears,1);
 f.c.digitWidth(1,10,'Lexend');assert.equal(f.measures.length,2);delete f.c.clearBoardTileCache;assert.doesNotThrow(()=>f.c.resetRenderCaches());
});
test('font readiness invalidates early fallback-font measurements',async()=>{
 let ready;const events={},fontSet={ready:new Promise(resolve=>ready=resolve),addEventListener:(name,fn)=>events[name]=fn};
 const f=fixture({fontSet});f.c.watchRenderFonts();f.c.digitWidth(1,10,'Lexend');ready();await Promise.resolve();
 assert.equal(f.c.glyphMetricsCache.size,0);assert.equal(f.clears,1);f.c.digitWidth(1,10,'Lexend');assert.equal(f.measures.length,2);
});
test('late font success and error each invalidate metrics, with listeners installed once',()=>{
 const f=fixture();let installed=0;const add=f.c.document.fonts.addEventListener;f.c.document.fonts.addEventListener=(...args)=>{installed++;add(...args);};
 f.c.watchRenderFonts();f.c.watchRenderFonts();assert.equal(installed,2);
 f.c.digitWidth(1,10,'Lexend');f.events.loadingdone();assert.equal(f.c.glyphMetricsCache.size,0);
 f.c.digitWidth(1,10,'Lexend');f.events.loadingerror();assert.equal(f.c.glyphMetricsCache.size,0);assert.equal(f.clears,2);
});
test('warmFonts installs invalidation before requesting the existing font families',()=>{
 const f=fixture();f.c.warmFonts();assert.equal(typeof f.events.loadingdone,'function');assert.equal(typeof f.events.loadingerror,'function');
 assert.deepEqual(f.loads,['700 24px Lexend','700 24px Nunito','700 24px Lexend']);
});
test('missing actual bounds retain width, height and draw fallbacks without extra measurements',()=>{
 const f=fixture({measure:()=>({width:9})});assert.equal(f.c.digitWidth(4,10,'Lexend'),9);assert.equal(f.c.digitHeight(4,10,'Lexend'),7.199999999999999);
 assert.equal(f.c.drawDigit(4,5,6,10,'Lexend','#fff'),7.199999999999999);assert.equal(f.measures.length,1);
 assert.equal(f.draws[0].baseline,'middle');assert.deepEqual(f.draws[0].args,['4',5,9.6]);
});
test('zero ascent keeps height fallback while positive ascent with missing descent uses zero',()=>{
 const zero=fixture({measure:()=>({width:8,actualBoundingBoxAscent:0})});assert.equal(zero.c.glyphBox('1'),null);
 const valid=fixture({measure:()=>({width:8,actualBoundingBoxAscent:7})});assert.equal(valid.c.glyphBox('1').asc,7);assert.equal(valid.c.glyphBox('1').desc,0);
});
test('ink width is preferred only when actual horizontal bounds have positive extent',()=>{
 const ink=fixture({measure:()=>({width:20,actualBoundingBoxLeft:-2,actualBoundingBoxRight:9})});assert.equal(ink.c.digitWidth(1,10,'Lexend'),7);
 const zero=fixture({measure:()=>({width:5.5,actualBoundingBoxLeft:0,actualBoundingBoxRight:0})});assert.equal(zero.c.digitWidth(1,10,'Lexend'),5.5);
 const missing=fixture({measure:()=>({actualBoundingBoxAscent:7})});assert.equal(missing.c.digitWidth(1,10,'Lexend'),undefined);
});
test('failed or null measurements retain fallbacks and can recover on the next call',()=>{
 let failing=true;const f=fixture({measure:()=>{if(failing)throw new Error('temporary failure');return {width:8};}});
 assert.equal(f.c.glyphBox('1'),null);assert.equal(f.c.digitWidth(1,10,'Lexend'),6.2);assert.equal(f.c.glyphMetricsCache.size,0);
 failing=false;assert.equal(f.c.digitWidth(1,10,'Lexend'),8);assert.equal(f.measures.length,3);
 const nil=fixture({measure:()=>null});assert.equal(nil.c.glyphBox('1'),null);assert.equal(nil.c.digitWidth(1,10,'Lexend'),6.2);assert.equal(nil.c.glyphMetricsCache.size,0);
});
