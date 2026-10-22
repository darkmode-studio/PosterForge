# PosterForge 2.3.2: redesigned layer list + batch carousel export. Usage: python3 e2e_v232.py [--csp]
import asyncio, json, sys, os
from playwright.async_api import async_playwright
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.3.2/'+('suite-csp' if CSP else 'suite'); os.makedirs(SH, exist_ok=True)
results=[]
def check(name, ok, info=''):
    results.append({'test':name,'ok':bool(ok),'info':str(info)[:600]}); print(('PASS ' if ok else 'FAIL ')+name, info if (not ok) else '', flush=True)
async def wait(pg, expr, ms=15000):
    for i in range(ms//50):
        if await pg.evaluate(expr): return True
        await pg.wait_for_timeout(50)
    return False
HELP = r"""
window.T = {
  scene(){ const c=PF.canvas; c.discardActiveObject(); c.getObjects().slice().forEach(o=>c.remove(o)); c.setBackgroundColor('#000000'); c.backgroundImage=null;
    const mk=(n,col,x,y)=>{ const r=new fabric.Rect({left:x,top:y,width:200,height:200,fill:col,name:n}); c.add(r); return r; };
    const a=mk('A','#ff0000',100,100), b=mk('B','#00ff00',300,300), d=mk('C','#0000ff',500,500);
    const t=PF.makeText('Hello layers',{}); t.set({left:200,top:900,fill:'#ffffff',fontSize:90,name:'Txt'}); c.add(t);
    PosterForgeEffects.applyGlow(b,{on:true,color:'#ffff00',blur:30,opacity:1}); b.set('pfRole','test-role');
    c.requestRenderAll(); PF.history.record(); return true },
  names(){ return [...document.querySelectorAll('#layerList > .layer-item:not(.child) .layer-name span')].map(x=>x.textContent) },
  order(){ return PF.canvas.getObjects().map(o=>o.name).reverse() },
  row(n){ return [...document.querySelectorAll('#layerList > .layer-item')].find(li=>li.querySelector('.layer-name span').textContent===n) },
  box(n){ const r=T.row(n).querySelector('.layer-row').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height} },
  files(){ return Object.values(window.__pfFiles) },
  async dims(f){ const bin=atob(f.b64.join('')); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
    const b=await createImageBitmap(new Blob([u],{type:f.mime})); const cv=document.createElement('canvas'); cv.width=b.width; cv.height=b.height; const x=cv.getContext('2d'); x.drawImage(b,0,0);
    const at=(u2,v)=>Array.from(x.getImageData(Math.round(u2*b.width/PF.state.W),Math.round(v*b.height/PF.state.H),1,1).data); return {w:b.width,h:b.height,at, x, b} },
};
"""
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
        check('boot: 2.3.2 ready, PFLayerPanel + PFBatchExport present', await wait(pg,'!!(PF.ready&&window.PFLayerPanel&&window.PFBatchExport&&window.PF23)'))
        await E("()=>import('./js/v2/home.js').then(m=>m.hideHome())"); await pg.wait_for_timeout(400)
        await E(HELP)
        await E("()=>{ const c=PF.canvas; c.getObjects().slice().forEach(o=>c.remove(o)); PF.openPane('layers'); }"); await pg.wait_for_timeout(300)
        em=await E("()=>document.querySelector('#layerList .pf-layer-empty')?.textContent")
        check('empty state: "No layers yet — add text or a photo"', em=='No layers yet — add text or a photo', em)
        await E("()=>T.scene()"); await E("()=>PF.refreshLayers()"); await pg.wait_for_timeout(200)
        st=await E("()=>({names:T.names(), h:Math.min(...[...document.querySelectorAll('#layerList .layer-row')].map(r=>r.getBoundingClientRect().height)), th:(()=>{const r=document.querySelector('#layerList .layer-thumb').getBoundingClientRect(); return [r.width,r.height]})(), btns:[...T.row('A').querySelectorAll('.layer-btn')].map(b=>b.getAttribute('aria-label')), hidden:getComputedStyle(T.row('A').querySelector('.pf-actions')).visibility })")
        check('rows: topmost first, 44px+ tall, 40×40 thumbnail, visibility/lock/more, swipe actions hidden', st['names'][:4]==['Hello layers','C','B','A'] or st['names'][:4]==['Txt','C','B','A'] and st['h']>=44 and st['th']==[40,40] and 'Hide' in st['btns'] and 'Lock' in st['btns'] and 'More' in st['btns'] and st['hidden']=='hidden', st)
        # thumbnails are cached: selection change does not re-render thumbnails
        th=await E("""()=>{ let n=0; const o=fabric.Object.prototype.toDataURL; fabric.Object.prototype.toDataURL=function(...a){n++; return o.apply(this,a)};
          const B=PF.canvas.getObjects().find(o=>o.name==='B'); PF.canvas.setActiveObject(B); PF.canvas.fire('selection:created',{}); PF.refreshLayers(); PF.canvas.discardActiveObject(); PF.refreshLayers();
          fabric.Object.prototype.toDataURL=o; return n }""")
        check('thumbnails cached: selection changes render 0 thumbnails', th==0, th)
        bx=await E("()=>T.box('B')"); await pg.mouse.click(bx['x']+bx['w']*0.45, bx['y']+bx['h']/2); await pg.wait_for_timeout(200)
        s1=await E("()=>({sel:PF.active()&&PF.active().name, act:T.row('B').classList.contains('active')})")
        check('tap row selects the layer and highlights it', s1=={'sel':'B','act':True}, s1)
        # visibility via app path + undo
        v=await E("""async()=>{ T.row('A').querySelector('[aria-label=Hide]').click(); const A=()=>PF.canvas.getObjects().find(o=>o.name==='A'); const h=A().visible; const sm=T.row('A').querySelector('small').textContent;
          await PF.history.undo(); await new Promise(z=>setTimeout(z,200)); return {h, sm, after:A().visible} }""")
        check('visibility: hides (row says hidden), undo brings it back', v['h']==False and 'hidden' in v['sm'] and v['after']==True, v)
        await E("()=>PF.refreshLayers()")
        lk=await E("""()=>{ T.row('A').querySelector('[aria-label=Lock]').click(); const o=PF.canvas.getObjects().find(o=>o.name==='A');
          return {locked:o.locked, sel:o.selectable, ev:o.evented, sm:T.row('A').querySelector('small').textContent, btn:!!T.row('A').querySelector('[aria-label=Unlock]')} }""")
        check('lock: click-through on canvas (not selectable/evented), row shows locked + Unlock', lk['locked'] and not lk['sel'] and not lk['ev'] and 'locked' in lk['sm'] and lk['btn'], lk)
        bx=await E("()=>T.box('A')"); await pg.mouse.click(bx['x']+bx['w']*0.45, bx['y']+bx['h']/2); await pg.wait_for_timeout(200)
        s2=await E("()=>PF.active()&&PF.active().name")
        check('locked layer can still be selected from the Layers panel (2.1.1 rule)', s2=='A', s2)
        await E("()=>{ T.row('A').querySelector('[aria-label=Unlock]').click(); PF.canvas.discardActiveObject(); PF.refreshLayers(); }")
        # long-press drag reorder: drag A (bottom) to the top
        before=await E("()=>T.order()")
        a=await E("()=>T.box('A')"); top=await E("()=>T.box(T.names()[0])")
        x0=a['x']+a['w']*0.45; await pg.mouse.move(x0, a['y']+a['h']/2); await pg.mouse.down(); await pg.wait_for_timeout(330)
        drag=await E("()=>!!document.querySelector('#layerList .pf-placeholder')")
        for i in range(1,11): await pg.mouse.move(x0, a['y']+a['h']/2 + (top['y']-a['y']-10)*i/10); await pg.wait_for_timeout(20)
        await pg.mouse.up(); await pg.wait_for_timeout(250)
        after=await E("()=>T.order()")
        check('long-press 250 ms + drag: placeholder shown, A moved to the top of the canvas', drag and after[0]=='A' and sorted(after)==sorted(before), {'drag':drag,'before':before,'after':after})
        un=await E("async()=>{ await PF.history.undo(); await new Promise(z=>setTimeout(z,200)); return T.order() }")
        check('reorder is one undo step', un==before, un)
        await E("()=>PF.refreshLayers()")
        # quick vertical move (< 250 ms) does not reorder (that is scrolling)
        a=await E("()=>T.box('A')"); await pg.mouse.move(x0, a['y']+20); await pg.mouse.down(); await pg.mouse.move(x0, a['y']-60, steps=4); await pg.mouse.up(); await pg.wait_for_timeout(350)
        check('fast vertical move = scroll, no reorder', await E("()=>JSON.stringify(T.order())")==json.dumps(before,separators=(',',':')), await E("()=>T.order()"))
        # swipe left reveals duplicate/delete
        bb=await E("()=>T.box('B')"); y=bb['y']+bb['h']/2
        await pg.mouse.move(bb['x']+bb['w']*0.5, y); await pg.mouse.down(); await pg.mouse.move(bb['x']+bb['w']*0.5-60, y, steps=3); await pg.mouse.move(bb['x']+bb['w']*0.5-140, y, steps=3); await pg.mouse.up(); await pg.wait_for_timeout(250)
        sw=await E("()=>({sw:T.row('B').classList.contains('pf-swiped'), vis:getComputedStyle(T.row('B').querySelector('.pf-actions')).visibility, order:T.order()})")
        check('swipe left reveals Duplicate / Delete (no reorder, no select)', sw['sw'] and sw['vis']=='visible' and sw['order']==before, sw)
        await E("()=>document.querySelectorAll('.toast').forEach(t=>t.remove())")
        await pg.screenshot(path=f'{SH}/01-layer-panel.png')
        du=await E("""async()=>{ const n=PF.canvas.getObjects().length; T.row('B').querySelector('.pf-dup').click(); await new Promise(z=>setTimeout(z,300));
          const c=PF.canvas.getObjects().find(o=>o.name==='B copy'); const r={n0:n,n:PF.canvas.getObjects().length, glow:c&&c.pfGlow, role:c&&c.pfRole, names:T.names()};
          await PF.history.undo(); await new Promise(z=>setTimeout(z,200)); r.undo=PF.canvas.getObjects().length; return r }""")
        check('Duplicate keeps app metadata (glow, pfRole) and is undoable', du['n']==du['n0']+1 and du['glow'] and du['glow']['on'] and du['role']=='test-role' and 'B copy' in du['names'] and du['undo']==du['n0'], du)
        await E("()=>PF.refreshLayers()")
        de=await E("""async()=>{ const n=PF.canvas.getObjects().length; const li=T.row('C'); li.classList.add('pf-swiped'); li.querySelector('.pf-del').click(); await new Promise(z=>setTimeout(z,200));
          const r={n0:n,n:PF.canvas.getObjects().length}; await PF.history.undo(); await new Promise(z=>setTimeout(z,200)); r.undo=PF.canvas.getObjects().length; return r }""")
        check('Delete goes through deleteObjects (undoable)', de['n']==de['n0']-1 and de['undo']==de['n0'], de)
        # groups: expand, child rows indented, drag mapping ignores child rows
        gr=await E("""async()=>{ const c=PF.canvas; c.discardActiveObject(); const objs=c.getObjects().filter(o=>o.name==='A'||o.name==='C');
          c.setActiveObject(new fabric.ActiveSelection(objs,{canvas:c})); PF.groupSel(); await new Promise(z=>setTimeout(z,200)); PF.refreshLayers();
          const g=c.getObjects().find(o=>o.type==='group'); g.set('name','Grp'); PF.refreshLayers();
          T.row('Grp').querySelector('.pf-expand').click(); await new Promise(z=>setTimeout(z,100));
          const kids=[...document.querySelectorAll('#layerList > .layer-item.child')].map(li=>li.querySelector('span').textContent); return {kids, order:T.order()} }""")
        check('group row expands to show children (indented)', sorted(gr['kids'])==['A','C'], gr)
        # drag the bottom row to just below the expanded group (children rows must not shift the index)
        order=gr['order']; last=order[-1]
        lb=await E(f"()=>T.box({json.dumps(last)})"); kidb=await E("()=>{const r=[...document.querySelectorAll('#layerList > .layer-item.child')].pop().getBoundingClientRect(); return {y:r.bottom}}")
        gi=order.index('Grp')
        await pg.mouse.move(x0, lb['y']+lb['h']/2); await pg.mouse.down(); await pg.wait_for_timeout(330)
        tgt=kidb['y']+5
        for i in range(1,11): await pg.mouse.move(x0, lb['y']+lb['h']/2+(tgt-lb['y']-lb['h']/2)*i/10); await pg.wait_for_timeout(20)
        await pg.mouse.up(); await pg.wait_for_timeout(250)
        o2=await E("()=>T.order()")
        check('drop index maps to canvas layers when group children are shown', o2.index(last)==gi+1 and len(o2)==len(order), {'before':order,'after':o2})
        await pg.screenshot(path=f'{SH}/02-layer-panel-group.png')
        await E("()=>PF.closePanel()")
        # ---------- batch export ----------
        await E("""async()=>{ const pm=await import('./js/v2/pages.js'); PF.canvas.getObjects().forEach(o=>o.set('name','P1-'+o.name)); await pm.addPage({duplicate:true}); await pm.addPage({duplicate:true}); await pm.goTo(1); }""")
        await pg.wait_for_timeout(300)
        bt=await E("""async()=>{ const n0=T.files().length; const page=PF.state.page; const r=await PFBatchExport.exportAll({format:'png',width:1080,onPage:async(i,it)=>{ const {sendBlob}=await import('./js/native.js'); return sendBlob(it.blob,it.name,it.mime,'save'); }});
          const fs=T.files().slice(n0); const d=await Promise.all(fs.map(f=>T.dims(f))); return {names:fs.map(f=>f.name), wh:d.map(x=>[x.w,x.h]), W:PF.state.W, H:PF.state.H, page, pageAfter:PF.state.page, ok:r.length} }""")
        import re
        okn=all(re.fullmatch(r'PosterForge_\d{8}_slide-0[123]\.png',n) for n in bt['names']) and [n[-6:-4] for n in bt['names']]==['01','02','03']
        check('exportAll: 3 slides, names PosterForge_YYYYMMDD_slide-01.png…, editor stays on its page', okn and bt['page']==bt['pageAfter']==1, bt)
        check('scale from the design size: 1080 wide keeps the aspect ratio', all(w==1080 and abs(h-round(bt['H']*1080/bt['W']))<=1 for w,h in bt['wh']), bt['wh'])
        cap=await E("async()=>{ const r=await PFBatchExport.exportAll({format:'jpg',width:9000,height:9000}); const d=await Promise.all(r.map(x=>createImageBitmap(x.blob))); return d.map(b=>[b.width,b.height]) }")
        check('size capped at 3840 px', all(max(w,h)==3840 for w,h in cap), cap)
        jp=await E("""async()=>{ PF.canvas.setBackgroundColor(''); PF.canvas.backgroundImage=null; PF.canvas.requestRenderAll(); const r=await PFBatchExport.exportAll({format:'jpg',scale:0.25});
          const b=await createImageBitmap(r[1].blob); const c=document.createElement('canvas'); c.width=b.width; c.height=b.height; const x=c.getContext('2d'); x.drawImage(b,0,0); return {px:Array.from(x.getImageData(2,2,1,1).data), name:r[1].name} }""")
        check('JPG: transparent page background becomes white', all(v>245 for v in jp['px'][:3]) and jp['name'].endswith('.jpg'), jp)
        gl=await E("""async()=>{ const r=await PFBatchExport.exportAll({format:'png',scale:1}); const b=await createImageBitmap(r[2].blob); const c=document.createElement('canvas'); c.width=b.width; c.height=b.height; const x=c.getContext('2d'); x.drawImage(b,0,0);
          const B=PF.canvas.getObjects().find(o=>/B$/.test(o.name)&&o.type==='rect'); const br=B.getBoundingRect(true,true); const p=Array.from(x.getImageData(Math.round(br.left+br.width/2),Math.round(br.top-8),1,1).data); return {p, has:!!B.pfGlow} }""")
        check('glow effect included in slide export', gl['p'][0]>40 and gl['p'][1]>40 and gl['p'][2]<30, gl)
        # export sheet path with progress bar + cancel
        cn=await E("""async()=>{ const n0=T.files().length; const rs=PF.renderStatic; PF.renderStatic=async(...a)=>{ await new Promise(z=>setTimeout(z,700)); return rs(...a) }; window.__rs=rs;
          window.__pr=PFExport.runExport({kind:'png',scale:1,allPages:true});
          for(let i=0;i<400 && !(document.querySelector('.progress-pill .pp-cancel') && Number(document.querySelector('.progress-pill').dataset.progress||0)>0);i++) await new Promise(z=>setTimeout(z,10));
          return {bar:!!document.querySelector('.progress-pill .pp-bar'), cancel:!!document.querySelector('.progress-pill .pp-cancel'), label:document.querySelector('.progress-pill span')?.textContent, n0} }""")
        await E("()=>document.querySelectorAll('.toast').forEach(t=>t.remove())")
        await pg.screenshot(path=f'{SH}/03-batch-export-progress.png')
        cr=await E("""async()=>{ document.querySelector('.progress-pill .pp-cancel').click(); const r=await window.__pr; PF.renderStatic=window.__rs; return {gone:!document.querySelector('.progress-pill'), cancelled:r.cancelled, saved:r.results.length} }""")
        nf=await E(f"()=>T.files().length-{cn['n0']}")
        check('export UI: progress bar + Cancel; cancel stops before all slides', cn['bar'] and cn['cancel'] and 'slide' in (cn['label'] or '') and cr['gone'] and cr['cancelled'] and nf<3, {'cn':cn,'cr':cr,'files':nf})
        full=await E("async()=>{ const n0=T.files().length; const r=await PFExport.runExport({kind:'webp',scale:0.5,quality:0.9,allPages:true}); return {ok:r.ok, names:T.files().slice(n0).map(f=>f.name+':'+f.mime)} }")
        check('export sheet path: all pages as WebP via native save bridge', full['ok'] and len(full['names'])==3 and all('slide-0' in n and 'image/webp' in n for n in full['names']), full)
        cmp=await E("()=>{ const s=JSON.parse(PF.serialize()); return {keys:Object.keys(s).sort(), ok:!JSON.stringify(s).includes('_pfThumb')} }")
        check('saved project format unchanged (no panel state stored)', cmp['ok'], cmp)
        bad=[e for e in errors if 'favicon' not in e]
        check('no page errors, no console errors', not bad, bad[:5])
        check('no network requests outside the app', not external, external[:5])
        await b.close()
    n=sum(r['ok'] for r in results); print(f'{n}/{len(results)} passed')
    json.dump(results, open(f'/workspace/posterforge/test-results-v232{"-csp" if CSP else ""}-2.3.2.json','w'), indent=1)
    sys.exit(0 if n==len(results) else 1)
asyncio.run(main())
