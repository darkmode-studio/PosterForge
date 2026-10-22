# PosterForge 2.3.0 feature suite. Usage: python3 e2e_v23.py [--csp]
import asyncio, json, sys, os, base64, io, math
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.3.0/'+('suite-csp' if CSP else 'suite')
os.makedirs(SH, exist_ok=True); os.makedirs('/tmp/pf23', exist_ok=True)
results=[]
def check(name, ok, info=''):
    results.append({'test':name,'ok':bool(ok),'info':str(info)[:600]}); print(('PASS ' if ok else 'FAIL ')+name, info if (not ok) else '', flush=True)
async def wait(pg, expr, ms=15000):
    for i in range(ms//50):
        if await pg.evaluate(expr): return True
        await pg.wait_for_timeout(50)
    return False
async def shot(pg, p):
    try: await pg.screenshot(path=p, timeout=20000)
    except Exception as e: print('WARN screenshot', p, str(e)[:100])
def photo(path, w, h, c1=(30,60,120), c2=(250,190,40)):
    im=Image.new('RGB',(w,h),c1); d=ImageDraw.Draw(im)
    for y in range(h): d.line([(0,y),(w,y)],fill=tuple(int(c1[i]*(1-y/h)+min(255,c1[i]+90)*(y/h)) for i in range(3)))
    d.ellipse([w*0.3,h*0.3,w*0.7,h*0.7],fill=c2); im.save(path,quality=90); return path

async def main():
    url=('data:image/jpeg;base64,'+base64.b64encode(open(photo('/tmp/pf23/p.jpg',1600,1200),'rb').read()).decode())
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':412,'height':915},device_scale_factor=2.625,is_mobile=True,has_touch=True,bypass_csp=not CSP)
        await ctx.add_init_script(path='mock_native.js')
        await ctx.add_init_script(script="localStorage.setItem('pf.onboarded','1')")
        external=[]; errors=[]
        async def route(r):
            u=r.request.url
            if u.startswith('http://127.0.0.1:8241/') or u.startswith('data:') or u.startswith('blob:'): await r.continue_()
            else: external.append(u); await r.abort()
        await ctx.route('**/*', route)
        pg=await ctx.new_page(); pg.set_default_timeout(30000); E=pg.evaluate
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        await pg.goto(URL)
        check('boot: 2.3 ready', await wait(pg,'!!(window.PF23&&window.PF22&&PF.ready)'))
        await pg.wait_for_timeout(900)
        # ---------- quick tour on first launch ----------
        t=await E("()=>({on:!!document.getElementById('v23Tour'), title:document.querySelector('#v23Tour h2')?.textContent})")
        check('first launch: quick tour shows', t['on'] and 'studio' in (t['title'] or ''), t)
        await shot(pg, f'{SH}/01-tour.png')
        for i in range(5):
            await pg.click('#tourNext'); await pg.wait_for_timeout(150)
        t=await E("()=>({on:!!document.getElementById('v23Tour'), flag:localStorage.getItem('pf.tour23')})")
        check('tour: Next through 5 steps closes it and remembers', not t['on'] and t['flag']=='1', t)
        await E("()=>PF23.runTour(true)"); await pg.wait_for_timeout(100)
        bk=await E("()=>({h:window.pfHandleBack(), on:!!document.getElementById('v23Tour')})")
        check('tour: Android back closes it', bk['h'] and not bk['on'], bk)
        # ---------- home ----------
        h=await E("()=>({hero:!!document.getElementById('v23Hero'), cards:document.querySelectorAll('#tplGrid .tpl-card').length, v23:document.body.classList.contains('v23')})")
        check('home: studio hero + template cards + v23 theme', h['hero'] and h['cards']>=30 and h['v23'], h)
        await wait(pg,"document.querySelectorAll('#tplGrid .tpl-card.ready').length>=4", 30000)
        await shot(pg, f'{SH}/02-home.png')
        await E("()=>import('./js/v2/home.js').then(m=>m.hideHome())"); await pg.wait_for_timeout(500)
        # ---------- dock & chrome ----------
        d=await E("""()=>{ const v=[...document.querySelectorAll('#toolbar .tool')].filter(b=>getComputedStyle(b).display!=='none');
          const top=[...document.querySelectorAll('#topbar button')].filter(b=>b.offsetParent).map(b=>b.getBoundingClientRect());
          return {labels:v.map(b=>b.textContent.trim()), minH:Math.min(...v.map(b=>b.getBoundingClientRect().height)), minW:Math.min(...v.map(b=>b.getBoundingClientRect().width)),
            topRight:Math.max(...top.map(r=>r.right)), topMin:Math.min(...top.map(r=>Math.min(r.width,r.height))), vw:innerWidth} }""")
        check('dock: exactly Text, Photos, Shapes, Layers, Tools', d['labels']==['Text','Photos','Shapes','Layers','Tools'], d)
        check('dock + top bar: touch targets >= 44px, top bar fits the screen', d['minH']>=44 and d['minW']>=44 and d['topMin']>=44 and d['topRight']<=d['vw'], d)
        # ---------- tool library ----------
        await pg.click('#v23ToolsBtn'); await pg.wait_for_timeout(500)
        lib=await E("()=>({n:document.querySelectorAll('#hubGrid .v23-hub-tile').length, groups:[...document.querySelectorAll('#hubGroups .chip')].map(c=>c.textContent)})")
        check('Tools: library lists 25+ tools in groups', lib['n']>=25 and {'Create','Edit','Canvas','Export'}<=set(lib['groups']), lib)
        await shot(pg, f'{SH}/03-tool-library.png')
        await pg.fill('#hubSearch','webp'); await pg.wait_for_timeout(150)
        s1=await E("()=>[...document.querySelectorAll('#hubGrid .v23-hub-tile')].map(b=>b.dataset.tool)")
        await pg.fill('#hubSearch','zzqx'); await pg.wait_for_timeout(150)
        s2=await E("()=>({empty:document.querySelector('#hubGrid .v23-empty')?.textContent, n:document.querySelectorAll('#hubGrid .v23-hub-tile').length})")
        check('Tools: search by keyword ("webp" finds Export) and a clear empty state', s1==['export'] and s2['n']==0 and 'zzqx' in (s2['empty'] or ''), [s1,s2])
        await pg.fill('#hubSearch',''); await E("()=>document.querySelector('#hubGroups .chip[data-group=\"Canvas\"]').click()"); await pg.wait_for_timeout(100)
        s3=await E("()=>[...document.querySelectorAll('#hubGrid .v23-hub-tile')].map(b=>b.dataset.tool)")
        check('Tools: group chip filters', 'grid' in s3 and 'text' not in s3, s3)
        await E("()=>document.querySelector('#hubGrid [data-tool=\"grid\"]').click()"); await pg.wait_for_timeout(400)
        g=await E("()=>({sheets:document.querySelectorAll('.sheet').length, title:document.querySelector('.sheet h2')?.textContent, recent:JSON.parse(localStorage.getItem('pf.recentTools')||'[]')})")
        check('Tools: tapping a tool closes the library and opens it; it becomes Recent', g['sheets']==1 and g['title']=='Snap grid' and g['recent'][0]=='grid', g)
        await E("()=>{ import('./js/ui.js').then(m=>m.closeTopSheet()) }"); await pg.wait_for_timeout(300)
        # ---------- inline text bar ----------
        await E("""()=>{ const t=PF.makeText('Hello studio',{}); PF.canvas.add(t); t.set({left:540,top:500,originX:'center',originY:'center'}); t.setCoords(); PF.canvas.setActiveObject(t); PF.canvas.requestRenderAll(); PF.canvas.fire('selection:created',{target:t}); PF.updateContext(); }""")
        await pg.wait_for_timeout(500)
        q=await E("()=>({font:document.getElementById('qbFontName')?.textContent, size:document.getElementById('qbSizeVal')?.textContent, sw:document.querySelectorAll('#qbSwatches .sw').length, vis:!document.getElementById('textQuickbar').classList.contains('hidden'), fs:PF.active().fontSize})")
        check('text bar: font name, size and colour swatches inline', q['vis'] and q['font'] and q['size']==str(round(q['fs'])) and q['sw']>=2, q)
        await shot(pg, f'{SH}/04-text-bar.png')
        await pg.dispatch_event('#qbSizeUp','pointerdown'); await pg.dispatch_event('#qbSizeUp','pointerup'); await pg.wait_for_timeout(100)
        f2=await E("()=>PF.active().fontSize")
        await E("()=>document.querySelector('#qbSwatches .sw[data-colour=\"#111111\"]').click()")
        c2=await E("()=>PF.active().fill")
        check('text bar: + makes text bigger in one tap, swatch recolours', f2==q['fs']+2 and c2=='#111111', [q['fs'],f2,c2])
        await E("()=>{PF.active().set('fill','#ffffff'); PF.canvas.requestRenderAll();}")
        # ---------- contextual pro buttons ----------
        cx=await E("()=>{ const v=(id)=>!document.getElementById(id).classList.contains('hidden'); return {inspect:v('btnInspect'), tp:v('btnTextPro'), fill:v('btnFill'), film:v('btnPhotoStudio'), minH:Math.min(...[...document.querySelectorAll('#ctxStrip .ctx')].filter(b=>b.offsetParent).map(b=>b.getBoundingClientRect().height))} }")
        check('selection bar (text): Exact, Text pro and Fill shown, Film hidden, targets >= 44px', cx['inspect'] and cx['tp'] and cx['fill'] and not cx['film'] and cx['minH']>=44, cx)
        # ---------- text pro ----------
        tp=await E("""async()=>{ const o=PF.active(); const px=()=>{ PF.canvas.renderAll(); const c=PF.canvas.lowerCanvasEl.getContext('2d'); const d=c.getImageData(0,0,PF.canvas.lowerCanvasEl.width,PF.canvas.lowerCanvasEl.height).data; let n=0; for(let i=0;i<d.length;i+=16) if(d[i]>200&&d[i+1]<80) n++; return n; };
          PF.canvas.discardActiveObject(); const before=px();
          PF23.setStrokes(o,[{w:8,c:'#ff2020'},{w:3,c:'#000000'}]); PF23.setExtrude(o,{depth:20,angle:45,color:'#ff2020'}); const after=px();
          const j=JSON.parse(PF.serialize()).canvas.objects.find(x=>x.text==='Hello studio'); PF.canvas.setActiveObject(o);
          return {before, after, strokes:j.pfStrokes, ex:j.pfExtrude} }""")
        check('text pro: extra outlines + 3D extrude render (red pixels appear) and are saved with the project', tp['before']<20 and tp['after']>200 and 'ff2020' in (tp['strokes'] or '') and '"depth":20' in (tp['ex'] or ''), tp)
        await E("()=>{ PF23.openTextPro(); }"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/05-text-pro.png')
        await E("()=>document.querySelector('#tpPresets [data-preset=\"Retro 3D\"]').click()"); await pg.wait_for_timeout(200)
        pr=await E("()=>({ex:PF.active().pfExtrude, st:PF.active().pfStrokes})")
        check('text pro: Quick looks apply a preset (Retro 3D)', '"depth":14' in (pr['ex'] or '') and pr['st'], pr)
        await E("()=>import('./js/ui.js').then(m=>m.closeTopSheet())"); await pg.wait_for_timeout(200)
        await shot(pg, f'{SH}/06-text-3d.png')
        # restore after reload
        rr=await E("""async()=>{ const s=PF.serialize(); await PF.restore(s); const o=PF.canvas.getObjects().find(x=>x.text==='Hello studio'); PF.canvas.setActiveObject(o); PF.canvas.fire('selection:created',{target:o}); PF.updateContext(); return {ex:o&&o.pfExtrude, st:o&&o.pfStrokes} }""")
        check('text pro: effects survive save + reopen', rr['ex'] and rr['st'], rr)
        af=await E("""()=>{ const t=new fabric.Textbox('Auto fit makes this quote fill the box nicely',{left:100,top:900,width:500,fontSize:30,fontFamily:'Poppins'}); PF.canvas.add(t); t.initDimensions(); const h0=t.height;
          PF23.setAutoFit(t,true); const a={fs:t.fontSize,h:t.height,H:t.pfFitH}; t.set('text','Short'); PF23.autoFit(t); const b={fs:t.fontSize,h:t.height}; t.set('text', 'A much much longer quote that now has to shrink down to stay inside the same box height'); PF23.autoFit(t); const c={fs:t.fontSize,h:t.height}; PF.canvas.remove(t); return {h0,a,b,c} }""")
        check('auto-fit: text box grows for short text, shrinks for long text, never taller than its box', af['b']['fs']>af['c']['fs'] and af['c']['h']<=af['a']['H']+0.5 and af['b']['h']<=af['a']['H']+0.5, af)
        # ---------- inspector ----------
        ins=await E("""()=>{ const o=PF.active(); PF23.pro.setGeometry(o,{x:100,y:200,angle:0}); const r=o.getBoundingRect(true,true); const a={x:r.left,y:r.top};
          PF23.pro.setGeometry(o,{w:400}); const w=o.getScaledWidth(); const r1=o.getBoundingRect(true,true); PF23.pro.nudge(o,1,0); const r2=o.getBoundingRect(true,true); PF23.pro.nudge(o,0,10); const r3=o.getBoundingRect(true,true); return {a,w,dx:r2.left-r1.left,dy:r3.top-r2.top} }""")
        check('Exact: X/Y/W inputs place and size precisely; nudge 1px and 10px', abs(ins['a']['x']-100)<0.6 and abs(ins['a']['y']-200)<0.6 and abs(ins['w']-400)<0.6 and abs(ins['dx']-1)<0.01 and abs(ins['dy']-10)<0.01, ins)
        await pg.click('#btnInspect'); await pg.wait_for_timeout(400)
        await pg.fill('#insR','15'); await pg.dispatch_event('#insR','change'); await pg.wait_for_timeout(100)
        ang=await E("()=>PF.active().angle")
        await pg.click('#nudgeRight'); x2=await E("()=>PF.active().getBoundingRect(true,true).left")
        await shot(pg, f'{SH}/07-exact-position.png')
        await E("()=>import('./js/ui.js').then(m=>m.closeTopSheet())"); await pg.wait_for_timeout(200)
        check('Exact sheet: typing rotation 15° rotates; arrow pad nudges', abs(ang-15)<0.01 and x2>0, [ang,x2])
        lk=await E("()=>{ const r=new fabric.Rect({left:10,top:10,width:50,height:50}); PF.canvas.add(r); PF.setLocked(r,true); const ok=PF23.pro.setGeometry(r,{x:500}); const n=PF23.pro.nudge(r,5,5); const left=r.left; PF.canvas.remove(r); return {ok,n,left} }")
        check('locked layers cannot be moved by Exact or nudge', not lk['ok'] and not lk['n'] and lk['left']==10, lk)
        # ---------- snap grid ----------
        gr=await E("""()=>{ PF23.pro.setGrid(true,54); const o=PF.active(); o.set({angle:0}); o.left+=7; o.top+=13; o.setCoords(); PF.canvas.fire('object:moving',{target:o}); const r=o.getBoundingRect(true,true);
          const res={x:r.left%54, y:r.top%54}; PF.canvas.renderAll(); return res }""")
        await shot(pg, f'{SH}/08-snap-grid.png')
        await E("()=>PF23.pro.setGrid(false)")
        check('snap grid: dragging snaps to the 54px grid', min(abs(gr['x']),abs(54-gr['x']))<0.6 and min(abs(gr['y']),abs(54-gr['y']))<0.6, gr)
        # ---------- fills ----------
        fl=await E("""async()=>{ const r=new fabric.Rect({left:600,top:700,width:300,height:300,fill:'#333',name:'Fill test'}); PF.canvas.add(r); PF.canvas.setActiveObject(r);
          PF23.pro.applyGradient(r,'#ff7a45','#ffc768',90); const g=r.fill&&r.fill.type; await PF23.pro.applyPattern(r,'dots','#ffffff','#111827'); const p=!!(r.fill&&r.fill.source);
          const s=PF.serialize(); await PF.restore(s); await new Promise(z=>setTimeout(z,300)); const r2=PF.canvas.getObjects().find(o=>o.name==='Fill test'); return {g,p,after:!!(r2&&r2.fill&&r2.fill.source), pf:r2&&r2.pfFill} }""")
        check('fills: gradient and pattern fills apply and survive save + reopen', fl['g']=='linear' and fl['p'] and fl['after'] and 'dots' in (fl['pf'] or ''), fl)
        await E("()=>{const r=PF.canvas.getObjects().find(o=>o.name==='Fill test'); PF.canvas.setActiveObject(r); PF.updateContext(); PF23.syncCtx(); PF23.pro.openFills();}"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/09-fills.png')
        nf=await E("()=>({g:document.querySelectorAll('#fillGradients button').length, p:document.querySelectorAll('#fillPatterns button').length})")
        await E("()=>import('./js/ui.js').then(m=>m.closeTopSheet())"); await pg.wait_for_timeout(200)
        check('fills sheet: 8 gradients and 8 patterns', nf['g']==8 and nf['p']==8, nf)
        # ---------- history ----------
        hi=await E("""async()=>{ PF.history.record(); const n0=PF.canvas.getObjects().length; const steps0=PF23.pro.historySteps().length;
          PF.canvas.add(new fabric.Circle({radius:40,left:50,top:50,name:'H1'})); PF.canvas.add(new fabric.Circle({radius:40,left:150,top:50,name:'H2'}));
          const st=PF23.pro.historySteps(); const cur=st.findIndex(s=>s.cur); await PF23.pro.jumpTo(cur-2); const back=PF.canvas.getObjects().length;
          const st2=PF23.pro.historySteps(); await PF23.pro.jumpTo(st2.length-1); const fwd=PF.canvas.getObjects().length; return {n0,back,fwd,labels:st.slice(-2).map(s=>s.label), fut:st2.filter(s=>s.future).length} }""")
        check('history: steps are labelled, jumping back 2 steps and forward again works', hi['back']==hi['n0'] and hi['fwd']==hi['n0']+2 and hi['fut']==2 and 'Added' in hi['labels'][-1], hi)
        await E("()=>{ PF23.pro.openHistory(); }"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/10-history.png')
        await E("()=>import('./js/ui.js').then(m=>m.closeTopSheet())"); await pg.wait_for_timeout(200)
        # ---------- swipe down ----------
        await E("()=>{PF.canvas.discardActiveObject(); PF.updateContext(); PF.openPane('text')}"); await pg.wait_for_timeout(500)
        hb=await E("()=>{const r=document.querySelector('#panel .panel-head').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}}")
        await pg.mouse.move(hb['x'],hb['y']); await pg.mouse.down(); await pg.mouse.move(hb['x'],hb['y']+160,steps=8); await pg.mouse.up(); await pg.wait_for_timeout(500)
        sw=await E("()=>document.getElementById('panel').classList.contains('open')")
        await E("()=>{ PF23.openToolLibrary(); }"); await pg.wait_for_timeout(500)
        sb=await E("()=>{const r=document.querySelector('.sheet').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+14}}")
        await pg.mouse.move(sb['x'],sb['y']); await pg.mouse.down(); await pg.mouse.move(sb['x'],sb['y']+200,steps=8); await pg.mouse.up(); await pg.wait_for_timeout(400)
        ss=await E("()=>document.querySelectorAll('.sheet').length")
        check('swipe down closes panels and sheets', not sw and ss==0, [sw,ss])
        # ---------- pen tool ----------
        pn=await E("""()=>{ const n0=PF.canvas.getObjects().length; PF23.startPen({color:'#ffffff',fill:'#ffb547'}); const bar=!!document.getElementById('v23DrawBar');
          PF23.penAddPoint(300,300); PF23.penAddPoint(700,320,500,150); PF23.penAddPoint(520,700); const prev=PF.canvas.getObjects().filter(o=>o.pfRole==='penPreview').length;
          PF23.penFinish(true); const objs=PF.canvas.getObjects(); const s=objs.find(o=>o.name==='Pen shape'); const j=JSON.parse(PF.serialize()).canvas.objects;
          return {bar, prev, n:objs.length-n0, closed:s&&JSON.stringify(s.path).includes('"z"')||JSON.stringify(s&&s.path).includes('Z'), fill:s&&s.fill, curve:JSON.stringify(s&&s.path).includes('Q'), leftover:objs.filter(o=>o.pfRole==='penPreview').length, saved:j.some(o=>o.name==='Pen shape'), drawing:PF23.isDrawing()} }""")
        check('pen tool: points + curve handle make a closed filled custom shape; preview never saved', pn['bar'] and pn['prev']==1 and pn['n']==1 and pn['closed'] and pn['fill']=='#ffb547' and pn['curve'] and pn['leftover']==0 and pn['saved'] and not pn['drawing'], pn)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}")
        await shot(pg, f'{SH}/11-pen-shape.png')
        # ---------- brush + eraser (real pointer drags) ----------
        await E("()=>PF23.startBrush({color:'#22d3ee',width:20})"); await pg.wait_for_timeout(200)
        box=await E("()=>{const v=PF.canvas.viewportTransform; const b=PF.canvas.upperCanvasEl.getBoundingClientRect(); return {x:b.left+v[4], y:b.top+v[5], k:v[0]}}")
        X=lambda x: box['x']+x*box['k']; Y=lambda y: box['y']+y*box['k']
        await pg.mouse.move(X(150),Y(1000)); await pg.mouse.down()
        for i in range(30): await pg.mouse.move(X(150+i*25), Y(1000+60*math.sin(i/4)))
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        br=await E("()=>PF.canvas.getObjects().filter(o=>o.pfRole==='brush').length")
        await shot(pg, f'{SH}/12-brush.png')
        await pg.click('#drawModeEraser'); await pg.wait_for_timeout(200)
        await pg.mouse.move(X(400),Y(900)); await pg.mouse.down()
        for i in range(12): await pg.mouse.move(X(400), Y(900+i*20))
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        er=await E("()=>PF.canvas.getObjects().filter(o=>o.pfRole==='brush').length")
        bk=await E("()=>({h:window.pfHandleBack(), d:PF23.isDrawing(), bar:!!document.getElementById('v23DrawBar'), sel:PF.canvas.selection})")
        check('brush draws a stroke; eraser wipes it; back leaves drawing mode', br==1 and er==0 and bk['h'] and not bk['d'] and not bk['bar'] and bk['sel'], [br,er,bk])
        # ---------- checklist ----------
        ck=await E("""()=>{ const t=PF.makeText('Edge words',{}); t.set({left:2,top:2,originX:'left',originY:'top',fill:'#12141a',name:'Edge'}); PF.canvas.add(t); t.setCoords(); return PF23.runChecklist() }""")
        get=lambda r,i: next(x for x in r if x['id']==i)
        check('checklist: flags text outside safe zone and low contrast', not get(ck,'safe')['ok'] and not get(ck,'contrast')['ok'], ck)
        await E("()=>{ PF23.openChecklist(); }"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/13-checklist.png')
        await E("()=>document.getElementById('ckFixSafe').click()"); await pg.wait_for_timeout(400)
        ck2=await E("()=>{ const r=PF23.runChecklist(); const e=PF.canvas.getObjects().find(o=>o.name==='Edge').getBoundingRect(true,true); return {safe:r.find(x=>x.id==='safe').ok, l:e.left, t:e.top} }")
        await E("()=>{document.querySelectorAll('.sheet-backdrop').forEach(b=>b.remove())}")
        check('checklist: "Fix safe zones" moves text inside the 5% margin', ck2['safe'] and ck2['l']>=54-0.5 and ck2['t']>=67.5-0.5, ck2)
        cr=await E("()=>[PF23.contrastRatio('#000000','#ffffff'), PF23.contrastRatio('#777777','#777777')]")
        check('contrast ratio maths (WCAG)', abs(cr[0]-21)<0.01 and abs(cr[1]-1)<0.01, cr)
        # ---------- photos: film looks, sharpen ----------
        await E(f"async()=>{{ const i=await PF.addImageFromURL('{url}'); PF.canvas.add(i); }}")
        await wait(pg,"PF.canvas.getObjects().some(o=>o.type==='image')",8000); await pg.wait_for_timeout(500)
        ph=await E("""async()=>{ const o=PF.canvas.getObjects().find(o=>o.type==='image'); PF.canvas.setActiveObject(o); PF.canvas.fire('selection:created',{target:o}); PF.updateContext(); await new Promise(r=>setTimeout(r,50));
          const v=(id)=>!document.getElementById(id).classList.contains('hidden'); return {film:v('btnPhotoStudio'), tp:v('btnTextPro'), presets:PF23.FILM_PRESETS.map(p=>p[0]), sharpen:!!document.getElementById('fSharpen')} }""")
        check('selection bar (photo): Film shown, Text pro hidden; 15 film looks incl. Tri-X, Velvia; Sharpen slider', ph['film'] and not ph['tp'] and len(ph['presets'])>=15 and 'Tri-X' in ph['presets'] and 'Velvia' in ph['presets'] and ph['sharpen'], ph)
        sp=await E("""async()=>{ const m=await import('./js/imaging.js'); const c=document.createElement('canvas'); c.width=c.height=40; const x=c.getContext('2d'); x.fillStyle='#808080'; x.fillRect(0,0,40,40); x.fillStyle='#a0a0a0'; x.fillRect(20,0,20,40);
          const a=m.filterCanvas(c,{}).getContext('2d').getImageData(0,0,40,40).data, b=m.filterCanvas(c,{sharpen:80}).getContext('2d').getImageData(0,0,40,40).data, b2=m.filterCanvas(c,{sharpen:80}).getContext('2d').getImageData(0,0,40,40).data;
          const at=(d,x)=>d[(10*40+x)*4]; return {edgeL:[at(a,19),at(b,19)], edgeR:[at(a,20),at(b,20)], flat:[at(a,5),at(b,5)], same:b.every((v,i)=>v===b2[i])} }""")
        check('sharpen: unsharp mask boosts edges, leaves flat areas, deterministic', sp['edgeL'][1]<sp['edgeL'][0] and sp['edgeR'][1]>sp['edgeR'][0] and sp['flat'][0]==sp['flat'][1] and sp['same'], sp)
        fa=await E("""async()=>{ const o=PF.active(); const ok=await PF.applyFilter(o,{sharpen:40,grain:10,contrast:10}); return {ok, f:o.pfFilter} }""")
        check('sharpen + grain apply to a photo through the job bridge and are saved on it', fa['ok'] and '"sharpen":40' in (fa['f'] or ''), fa)
        await E("()=>{ import('./js/v2/photo.js').then(m=>{ m.openPhotoTools(PF.active(),'film'); }); }"); await pg.wait_for_timeout(900)
        await shot(pg, f'{SH}/14-film-looks.png')
        await E("()=>{document.querySelectorAll('.sheet-backdrop').forEach(b=>b.remove())}"); await pg.wait_for_timeout(200)
        # ---------- export ----------
        await E("()=>{PF.canvas.discardActiveObject(); PF.updateContext()}")
        await E("()=>{ window.PFExport.exportSheetV2(); return 1 }"); await pg.wait_for_timeout(500)
        ex=await E("()=>({kinds:[...document.querySelectorAll('#expKind button')].map(b=>b.dataset.kind), sizes:[...document.querySelectorAll('#expSize button')].map(b=>b.dataset.preset)})")
        await E("()=>document.querySelector('#expKind [data-kind=\"webp\"]').click()"); await pg.wait_for_timeout(100)
        await E("()=>document.querySelector('#expSize [data-preset=\"4k\"]').click()"); await pg.wait_for_timeout(100)
        dims=await E("()=>document.getElementById('expDims')?.textContent")
        await shot(pg, f'{SH}/15-export-webp-4k.png')
        await E("()=>{document.querySelectorAll('.sheet-backdrop').forEach(b=>b.remove())}")
        check('export: WebP format and 4K size offered (3840 long side)', 'webp' in ex['kinds'] and 'tpng' in ex['kinds'] and '4k' in ex['sizes'] and '3840' in (dims or ''), [ex,dims])
        we=await E("""async()=>{ const n0=Object.keys(window.__pfFiles).length; const r=await window.PFExport.runExport({kind:'webp',scale:1,quality:0.9}); const f=Object.values(window.__pfFiles).slice(n0);
          const head=f[0]?atob(f[0].b64.join('')).slice(0,16):''; return {ok:r.ok, name:f[0]&&f[0].name, mime:f[0]&&f[0].mime, riff:head.startsWith('RIFF')&&head.includes('WEBP')} }""")
        check('export: a real WebP file is written', we['ok'] and we['mime']=='image/webp' and we['riff'] and we['name'].endswith('.webp'), we)
        # ---------- lettering templates ----------
        async def openT(tid):
            await E(f"()=>{{ window.__ot=null; import('./js/v2/home.js').then(m=>m.openTemplate('{tid}')).then(r=>window.__ot=r===undefined?true:r); }}")
            for i in range(60):
                await pg.wait_for_timeout(100)
                await E("()=>{ const b=[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='Replace'); b&&b.click(); }")
                if await E("()=>window.__ot!==null"): break
            await pg.wait_for_timeout(900)
        warps=[]
        for t in ['green','maroon','navy','cream','sunset','neon']:
            await openT('ml-letter-'+t)
            w=await E("""()=>{ const O=PF.canvas.getObjects(); const o=O.find(x=>x.pfRole==='lettering'); PF.canvas.discardActiveObject(); PF.canvas.renderAll();
              const c=PF.canvas.lowerCanvasEl, v=PF.canvas.viewportTransform, R=PF.canvas.getRetinaScaling(); const r=o.getBoundingRect(true,true);
              const x0=Math.round((v[4]+r.left*v[0])*R), y0=Math.round((v[5]+r.top*v[3])*R), w=Math.round(r.width*v[0]*R), h=Math.round(r.height*v[3]*R);
              const d=c.getContext('2d').getImageData(x0,y0,Math.max(1,Math.round(w/4)),h).data; let ink=0; for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-d[0])+Math.abs(d[i+1]-d[1])+Math.abs(d[i+2]-d[2])>60) ink++; }
              return {warp:o.pfWarp, tex:!!(o.fill&&o.fill.source), leftInk:ink/(d.length/4), swashes:O.filter(x=>x.type==='path').length} }""")
            w['t']=t; warps.append(w)
            if t=='cream': await shot(pg, f'{SH}/16-lettering-cream.png')
            if t=='green': await shot(pg, f'{SH}/17-lettering-green-warp.png')
        check('lettering: curve/warp on all 6 Malayalam templates', all(w['warp'] in ('arc','wave') for w in warps), warps)
        check('lettering: textured + warped words render fully (left quarter has ink, not clipped)', all(w['leftInk']>0.03 for w in warps if w['tex']), warps)
        check('lettering: cream template has its extra swash (3 swashes)', next(w for w in warps if w['t']=='cream')['swashes']>=3, warps)
        # ---------- locked click-through still works with v23 ----------
        pos=await E('''()=>{ PF.canvas.discardActiveObject(); const O=PF.canvas.getObjects(); const r=new fabric.Rect({left:540,top:540,originX:'center',originY:'center',width:500,height:500,fill:'rgba(225,29,72,.5)',name:'Lock test'}); PF.canvas.add(r); PF.setLocked(r,true); PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();
          const v=PF.canvas.viewportTransform; const b=PF.canvas.upperCanvasEl.getBoundingClientRect(); return {x:b.left+v[4]+540*v[0], y:b.top+v[5]+540*v[3]} }''')
        await E("()=>PF.closePanel()"); await pg.wait_for_timeout(300)
        await pg.mouse.click(pos['x'],pos['y']); await pg.wait_for_timeout(300)
        st=await E("()=>{const a=PF.canvas.getActiveObject(); return {name:a&&a.name}}")
        check('locked top layer stays click-through (tap selects the layer below)', st['name']!='Lock test', st)
        # ---------- 2.2 project compatibility ----------
        cp=await E("""async()=>{ const before=PF.canvas.getObjects().length; const s=PF.serialize(); const j=JSON.parse(s); j.canvas.objects.forEach(o=>{ delete o.pfStrokes; delete o.pfExtrude; delete o.pfFill; delete o.pfAutoFit; }); await PF.restore(JSON.stringify(j)); return {before, after:PF.canvas.getObjects().length} }""")
        check("projects saved by 2.2 (no 2.3 fields) open with every layer", cp["after"]==cp["before"] and cp["after"]>=3, cp)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll()}")
        await shot(pg, f'{SH}/18-editor.png')
        # ---------- hygiene ----------
        await pg.wait_for_timeout(300)
        bad=[e for e in errors if 'favicon' not in e]
        check('no page errors, no console errors', not bad, bad[:5])
        check('no network requests outside the app', not external, external[:5])
        await b.close()
    n=sum(r['ok'] for r in results); print(f'{n}/{len(results)} passed')
    json.dump(results, open(f'/workspace/posterforge/test-results-v23{"-csp" if CSP else ""}-2.3.0.json','w'), indent=1)
    sys.exit(0 if n==len(results) else 1)
asyncio.run(main())
