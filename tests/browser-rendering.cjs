// Optional retina visual check. Source is instrumented only in this local server.
// No debug hook is added to the shipped page, and external requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(root, 'index.html'), 'utf8');
const end = html.lastIndexOf('})();');
assert(end >= 0, 'private game scope must exist');
const hook = `
window.__tileVisual = function(config, pictures) {
  var original={ctx:ctx,R:R,tileStyle:tileStyle,tileShape:tileShape,showNums:showNums,showDots:showDots};
  var dpr=Math.min(window.devicePixelRatio||1,2.5), side=128;
  var x=config.position[0],y=config.position[1],direct=document.createElement('canvas'),cached=document.createElement('canvas');
  function background(canvas) {
    canvas.width=canvas.height=Math.round(side*dpr);
    ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#0C1119';ctx.fillRect(0,0,side,side);
    hexPath(x,y,R*.92);ctx.globalAlpha=.42;ctx.fillStyle=INK3;ctx.fill();ctx.globalAlpha=1;
    ctx.lineWidth=1;ctx.strokeStyle=LINE;ctx.stroke();
  }
  try {
    R=36;tileStyle=config.style;tileShape=config.shape;
    showNums=config.labels!=='dots';showDots=config.labels!=='numbers';
    background(direct);drawTile(x,y,config.tier,R*.9,config.focused,null);
    background(cached);drawBoardTile(x,y,config.tier,R*.9,config.focused,null);
    var left=Math.floor((x-R-5)*dpr),top=Math.floor((y-R-5)*dpr),width=Math.ceil((R+5)*2*dpr);
    var a=direct.getContext('2d').getImageData(left,top,width,width).data;
    var b=cached.getContext('2d').getImageData(left,top,width,width).data;
    var total=0,max=0,changed=0,hist=new Uint32Array(256),pixels=a.length/4;
    for(var i=0;i<a.length;i+=4){
      var largest=0;
      for(var ch=0;ch<3;ch++) {var delta=Math.abs(a[i+ch]-b[i+ch]);total+=delta;if(delta>largest)largest=delta;}
      if(largest>2)changed++;if(largest>max)max=largest;hist[largest]++;
      if(a[i+3]!==255||b[i+3]!==255)throw new Error('comparison background must remain opaque');
    }
    var cumulative=0,p99=0;
    for(var h=0;h<256;h++){cumulative+=hist[h];if(cumulative>=pixels*.99){p99=h;break;}}
    var result={config:config,dpr:dpr,mae:total/(pixels*3),changedPercent:changed/pixels*100,maxChannelError:max,p99PixelError:p99};
    if(pictures){result.direct=direct.toDataURL('image/png');result.cached=cached.toDataURL('image/png');}
    direct.width=direct.height=0;cached.width=cached.height=0;
    return result;
  } finally {
    ctx=original.ctx;R=original.R;tileStyle=original.tileStyle;tileShape=original.tileShape;
    showNums=original.showNums;showDots=original.showDots;
  }
};
`;
const served = html.slice(0, end) + hook + html.slice(end);

(async () => {
  const engine = process.env.BROWSER_ENGINE || 'chromium';
  let server, browser;
  try {
    server = http.createServer((req, res) => {
      if (new URL(req.url, 'http://localhost').pathname !== '/') {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(served);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const options = { headless: true };
    if (process.env.BROWSER_EXECUTABLE_PATH) options.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    if (engine === 'chromium' && process.env.CHROMIUM_MODULE) {
      const packed = require(process.env.CHROMIUM_MODULE);
      options.executablePath = await packed.executablePath(); options.args = packed.args;
    }
    assert(playwright[engine], 'known Playwright engine required');
    browser = await playwright[engine].launch(options);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    await context.route('**/*', route => route.request().url() === base ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (window.__tileVisual == null) throw new Error('local-only comparison hook missing');
    });
    const configs = [];
    for (const shape of ['hex', 'round', 'circle', 'square', 'diamond', 'octagon'])
      for (const style of ['classic', 'outline', 'glass', 'ink'])
        for (const labels of ['both', 'numbers', 'dots'])
          for (const position of [[64, 64], [64.2, 65.4], [64.137, 63.843]])
            for (const focused of [false, true])
              for (const tier of [0, 2, 5]) configs.push({ shape, style, labels, position, focused, tier });
    const results = [];
    for (let offset = 0; offset < configs.length; offset += 36) {
      results.push(...await page.evaluate(batch => batch.map(config => window.__tileVisual(config, false)), configs.slice(offset, offset + 36)));
    }
    assert.equal(results.length, 1296);
    assert(results.every(x => x.dpr === 2.5), 'DPR 3 device must preserve the game resolution cap of 2.5');
    assert.deepEqual(errors, []);
    const ordered = [...results].sort((a, b) => b.mae - a.mae);
    const summary = {
      engine, cases: results.length, deviceDpr: 3, canvasDpr: 2.5,
      meanAbsoluteError: results.reduce((sum, x) => sum + x.mae, 0) / results.length,
      worstMeanAbsoluteError: ordered[0].mae,
      maximumChannelError: Math.max(...results.map(x => x.maxChannelError)),
      worstCases: ordered.slice(0, 5)
    };
    if (process.env.RENDER_OUTPUT_DIR) {
      const output = path.resolve(process.env.RENDER_OUTPUT_DIR);
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, engine + '-comparison.json'), JSON.stringify({ summary, results }, null, 2));
      for (const [index, config] of [ordered[0].config,
        { shape: 'hex', style: 'classic', labels: 'both', position: [64, 64], focused: false, tier: 2 },
        { shape: 'diamond', style: 'glass', labels: 'numbers', position: [64.137, 63.843], focused: true, tier: 5 }
      ].entries()) {
        const pair = await page.evaluate(c => window.__tileVisual(c, true), config);
        for (const type of ['direct', 'cached']) {
          fs.writeFileSync(path.join(output, `${engine}-${index}-${type}.png`), Buffer.from(pair[type].split(',')[1], 'base64'));
        }
      }
    }
    console.log(JSON.stringify(summary, null, 2));
    // This guards gross missing/clipped content rather than requiring identical antialiasing.
    assert(summary.worstMeanAbsoluteError < 12, 'large cached/direct visual discrepancy; inspect artifact pairs');
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
