# PosterForge 2.3.1: separate glow + drop shadow. Usage: python3 e2e_v231.py [--csp]
import asyncio, json, sys, os
from playwright.async_api import async_playwright
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.3.1/'+('suite-csp' if CSP else 'suite'); os.makedirs(SH, exist_ok=True)
results=[]
def check(name, ok, info=''):
    results.append({'test':name,'ok':bool(ok),'info':str(info)[:600]}); print(('PASS ' if ok else 'FAIL ')+name, info if (not ok) else '', flush=True)
async def wait(pg, expr, ms=15000):
    for i in range(ms//50):
        if await pg.evaluate(expr): return True
        await pg.wait_for_timeout(50)
    return False
# helpers injected into the page
HELP = r"""
window.T = {
  scene(){ const c=PF.canvas; c.discardActiveObject(); c.getObjects().slice().forEach(o=>c.remove(o)); c.setBackgroundColor('#000000'); c.backgroundImage=null;
    const r=new fabric.Rect({left:540,top:540,originX:'center',originY:'center',width:200,height:200,fill:'#ffffff',strokeWidth:0,name:'FxRect'}); c.add(r);
    const t=PF.makeText('GLOW',{}); t.set({left:540,top:1050,originX:'center',originY:'center',fill:'#ffffff',fontSize:120,name:'FxText'}); c.add(t); t.setCoords(); c.requestRenderAll(); return {r,t} },
  both(o){ PosterForgeEffects.applyGlow(o,{on:true,color:'#00ff00',blur:40,opacity:1}); PosterForgeEffects.applyShadow(o,{color:'#ff0000',blur:0,offsetX:80,offsetY:80}); },
  async px(blob, pts){ const b=await createImageBitmap(blob); const cv=document.createElement('canvas'); cv.width=b.width; cv.height=b.height; const x=cv.getContext('2d'); x.drawImage(b,0,0);
    return {w:b.width,h:b.height,p:pts.map(([u,v])=>Array.from(x.getImageData(Math.round(u*b.width/PF.state.W),Math.round(v*b.height/PF.state.H),1,1).data))} },
  live(pts){ const c=PF.canvas; c.renderAll(); const el=c.lowerCanvasEl, x=el.getContext('2d'), v=c.viewportTransform, k=el.width/c.width;
    return pts.map(([u,v2])=>Array.from(x.getImageData(Math.round((v[4]+u*v[0])*k),Math.round((v[5]+v2*v[3])*k),1,1).data)) },
  greenAround(blob){ return createImageBitmap(blob).then(b=>{ const cv=document.createElement('canvas'); cv.width=b.width; cv.height=b.height; const x=cv.getContext('2d'); x.drawImage(b,0,0);
    const s=b.width/PF.state.W; const d=x.getImageData(Math.round(300*s),Math.round(930*s),Math.round(480*s),Math.round(80*s)).data; let n=0; for(let i=0;i<d.length;i+=4) if(d[i+1]>60&&d[i+1]>d[i]+30&&d[i+3]>0) n++; return n; }) },
};
"""
# sample points: centre of rect (white), above rect in glow halo (green), lower-right shadow (red), far corner (background)
PTS=[[540,540],[540,428],[700,700],[60,60]]
G=lambda p: p[1]>40 and p[1]>p[0]+30
R=lambda p: p[0]>150 and p[1]<80
W=lambda p: p[0]>240 and p[1]>240 and p[2]>240

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':412,'height':915},device_scale_factor=2.625,is_mobile=True,has_touch=True,bypass_csp=not CSP)
        await ctx.add_init_script(path='mock_native.js')
        await ctx.add_init_script(script="localStorage.setItem('pf.onboarded','1');localStorage.setItem('pf.tour23','1')")
        external=[]; errors=[]
        async def route(r):
            u=r.request.url
            if u.startswith('http://127.0.0.1:8241/') or u.startswith('data:') or u.startswith('blob:'): await r.continue_()
            else: external.append(u); await r.abort()
        await ctx.route('**/*', route)
        pg=await ctx.new_page(); pg.set_default_timeout(60000); E=pg.evaluate
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        await pg.goto(URL)
        check('boot: 2.3.1 ready, effects API present', await wait(pg,'!!(window.PF23&&PF.ready&&window.PosterForgeEffects)'))
        await E("()=>import('./js/v2/home.js').then(m=>m.hideHome())"); await pg.wait_for_timeout(500)
        await E(HELP)
        await E("()=>{ const {r,t}=T.scene(); T.both(r); T.both(t); }")
        lv=await E(f"()=>T.live({PTS})")
        check('canvas: glow AND drop shadow render together (cached rect)', W(lv[0]) and G(lv[1]) and R(lv[2]) and lv[3][:3]==[0,0,0], lv)
        st=await E("()=>{ const o=PF.canvas.getObjects().find(o=>o.name==='FxRect'); return {g:o.pfGlow, s:o.shadow&&{c:o.shadow.color,x:o.shadow.offsetX,y:o.shadow.offsetY}, cache:o.shouldCache()} }")
        check('data: glow in pfGlow, drop shadow stays in shadow (separate)', st['g']=={'on':True,'color':'#00ff00','blur':40,'opacity':1} and st['s']['x']==80 and st['s']['c']=='#ff0000', st)
        # glow off keeps shadow, shadow off keeps glow
        r1=await E(f"""()=>{{ const o=PF.canvas.getObjects().find(o=>o.name==='FxRect'); PosterForgeEffects.applyGlow(o,{{on:false}}); const a=T.live({PTS});
          PosterForgeEffects.applyGlow(o,{{on:true}}); PosterForgeEffects.applyShadow(o,{{on:false}}); const b=T.live({PTS}); T.both(o); return {{a,b}} }}""")
        check('toggling: glow off keeps drop shadow; shadow off keeps glow', (not G(r1['a'][1])) and R(r1['a'][2]) and G(r1['b'][1]) and not R(r1['b'][2]), r1)
        # text glow is visible (not clipped by the text cache)
        tg=await E("""async()=>{ const t=PF.canvas.getObjects().find(o=>o.name==='FxText'); const on=await T.greenAround(await PF.exportPNGBlob(1));
          PosterForgeEffects.applyGlow(t,{on:false}); const off=await T.greenAround(await PF.exportPNGBlob(1)); T.both(t); return {on,off} }""")
        check('text: glow halo around letters (not clipped by object cache)', tg['on']>500 and tg['off']<50, tg)
        await pg.screenshot(path=f'{SH}/01-glow-and-shadow.png')
        # exports
        for name,js in [('PNG','PF.exportPNGBlob(1)'),('JPG',"PF.exportPNGBlob(1,'image/jpeg',0.95)"),('WebP',"PF.exportPNGBlob(1,'image/webp',0.95)"),('4K PNG','PF.exportPNGBlob(3840/Math.max(PF.state.W,PF.state.H))')]:
            ex=await E(f"async()=>T.px(await {js},{PTS})")
            check(f'export {name}: pixels show glow and drop shadow', W(ex['p'][0]) and G(ex['p'][1]) and R(ex['p'][2]) and ex['p'][3][0]<30, ex)
        tr=await E(f"async()=>T.px(await PF.exportPNGBlob(1,'image/png',0.95,{{transparent:true}}),{PTS})")
        check('export transparent PNG: glow + shadow on transparent background', G(tr['p'][1]) and tr['p'][1][3]>40 and R(tr['p'][2]) and tr['p'][3][3]==0, tr)
        ws=await E("""async()=>{ const n0=Object.keys(window.__pfFiles).length; const r=await window.PFExport.runExport({kind:'webp',scale:1,quality:0.9}); const f=Object.values(window.__pfFiles).slice(n0)[0];
          if(!f) return {ok:false}; const bin=atob(f.b64.join('')); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return {ok:r.ok, px:await T.px(new Blob([u],{type:f.mime}),"""+json.dumps(PTS)+""")} }""")
        check('export sheet WebP file (full export path): glow + shadow pixels', ws.get('ok') and G(ws['px']['p'][1]) and R(ws['px']['p'][2]), ws)
        # save / load round trip
        rt=await E(f"""async()=>{{ const s=PF.serialize(); const j=JSON.parse(s).canvas.objects.find(o=>o.name==='FxRect'); await PF.restore(s); await new Promise(z=>setTimeout(z,200));
          const o=PF.canvas.getObjects().find(o=>o.name==='FxRect'); return {{json:{{g:j.pfGlow,s:j.shadow&&j.shadow.offsetX}}, g:o.pfGlow, s:o.shadow&&o.shadow.offsetX, px:T.live({PTS})}} }}""")
        check('toJSON/loadFromJSON round-trip keeps both effects', rt['json']['g']['color']=='#00ff00' and rt['json']['s']==80 and rt['g']['blur']==40 and rt['s']==80 and G(rt['px'][1]) and R(rt['px'][2]), rt)
        # clones get their own copy
        cl=await E("""async()=>{ const o=PF.canvas.getObjects().find(o=>o.name==='FxRect'); const c=await new Promise(r=>o.clone(r,PF.PROPS)); PosterForgeEffects.applyGlow(c,{color:'#0000ff'}); return {a:o.pfGlow.color,b:c.pfGlow.color} }""")
        check('duplicate: changing the copy’s glow leaves the original alone', cl['a']=='#00ff00' and cl['b']=='#0000ff', cl)
        # old 2.2 project: glow in the single shadow slot (pfGlow colour string + offset-0 shadow), plus a real drop shadow
        mg=await E(f"""async()=>{{ const j=JSON.parse(PF.serialize()); j.v=1; j.canvas.objects.forEach(o=>{{ delete o.pfGlow; delete o.shadow; }});
          const r=j.canvas.objects.find(o=>o.name==='FxRect'); r.pfGlow='#00ff00'; r.shadow={{color:'#00ff00',blur:36,offsetX:0,offsetY:0}};
          const t=j.canvas.objects.find(o=>o.name==='FxText'); t.shadow={{color:'rgba(255,0,0,1)',blur:4,offsetX:6,offsetY:9}};
          await PF.restore(JSON.stringify(j)); await new Promise(z=>setTimeout(z,200));
          const R=PF.canvas.getObjects().find(o=>o.name==='FxRect'), Tx=PF.canvas.getObjects().find(o=>o.name==='FxText');
          const out=JSON.parse(PF.serialize()).canvas.objects; return {{rg:R.pfGlow, rs:R.shadow, tg:Tx.pfGlow||null, ts:Tx.shadow&&[Tx.shadow.offsetX,Tx.shadow.offsetY,Tx.shadow.color], px:T.live({PTS}), saved:out.find(o=>o.name==='FxRect').pfGlow}} }}""")
        check('old 2.2 project: single-slot glow migrates to the new glow, shadow slot freed', mg['rg']=={'on':True,'color':'#00ff00','blur':36,'opacity':1} and mg['rs'] is None and G(mg['px'][1]) and not R(mg['px'][2]) and mg['saved']['on']==True, mg)
        check('old 2.2 project: an existing drop shadow migrates to the drop-shadow setting unchanged', mg['tg'] is None and mg['ts']==[6,9,'rgba(255,0,0,1)'], mg)
        # UI: Text effects Glow button + Shadow pane button, both on together
        ui=await E("""async()=>{ const t=PF.canvas.getObjects().find(o=>o.name==='FxText'); PosterForgeEffects.clearEffects(t); PF.canvas.setActiveObject(t); PF.canvas.fire('selection:created',{target:t}); PF.updateContext();
          PF.openPane('typo'); await new Promise(z=>setTimeout(z,300)); document.getElementById('tyGlowOp').value=70; document.getElementById('tyGlowBtn').click();
          PF.openPane('shadow'); await new Promise(z=>setTimeout(z,300)); document.getElementById('btnShadow').click();
          PF.openPane('typo'); await new Promise(z=>setTimeout(z,300));
          return {g:t.pfGlow, s:!!t.shadow, btn:document.getElementById('tyGlowBtn').textContent, op:document.getElementById('tyGlowOpVal').textContent} }""")
        await pg.screenshot(path=f'{SH}/02-text-effects-glow.png')
        check('UI: Glow (Text effects) and Shadow (Shadow tool) switch on independently', ui['g'] and ui['g']['on'] and abs(ui['g']['opacity']-0.7)<1e-6 and ui['s'] and ui['btn']=='Glow on' and ui['op']=='70%', ui)
        un=await E("""async()=>{ const t=PF.active(); PF.history.undo ? await PF.history.undo() : null; await new Promise(z=>setTimeout(z,400)); const o=PF.canvas.getObjects().find(o=>o.name==='FxText'); return {g:o.pfGlow&&o.pfGlow.on, s:!!o.shadow} }""")
        check('undo: removing the shadow step keeps the glow', un['g'] and not un['s'], un)
        bad=[e for e in errors if 'favicon' not in e]
        check('no page errors, no console errors', not bad, bad[:5])
        check('no network requests outside the app', not external, external[:5])
        await b.close()
    n=sum(r['ok'] for r in results); print(f'{n}/{len(results)} passed')
    json.dump(results, open(f'/workspace/posterforge/test-results-v231{"-csp" if CSP else ""}-2.3.1.json','w'), indent=1)
    sys.exit(0 if n==len(results) else 1)
asyncio.run(main())
