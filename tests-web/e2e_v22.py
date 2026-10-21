# PosterForge 2.2.0 feature suite. Usage: python3 e2e_v22.py [--csp]
import asyncio, json, sys, os, base64, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.2.0/'+('suite-csp' if CSP else 'suite')
os.makedirs(SH, exist_ok=True); os.makedirs('/tmp/pf22', exist_ok=True)
results=[]
def check(name, ok, info=''):
    results.append({'test':name,'ok':bool(ok),'info':str(info)[:600]}); print(('PASS ' if ok else 'FAIL ')+name, info if (not ok or info) else '', flush=True)
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
def dataurl(path):
    return 'data:image/jpeg;base64,'+base64.b64encode(open(path,'rb').read()).decode()
def png_info(b64):
    im=Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA'); w,h=im.size
    return {'w':w,'h':h,'corner':im.getpixel((2,2))[3],'mid':im.getpixel((w//2,h//2))[3]}

async def main():
    ps=[photo(f'/tmp/pf22/p{i}.jpg',1200,900,c,d) for i,(c,d) in enumerate([((30,60,120),(250,190,40)),((120,40,60),(90,220,200)),((40,110,60),(240,240,240)),((90,70,30),(230,90,60))])]
    urls=[dataurl(p) for p in ps]
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
        check('boot: 2.2 ready', await wait(pg,'!!(window.PF22&&window.PF21&&PF.v2Ready)'))
        await pg.wait_for_timeout(500)
        async def openT(tid):
            await E(f"()=>{{ window.__ot=null; import('./js/v2/home.js').then(m=>m.openTemplate('{tid}')).then(r=>window.__ot=r===undefined?true:r); }}")
            for i in range(60):
                await pg.wait_for_timeout(100)
                await E("()=>{ const b=[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='Replace'); b&&b.click(); }")
                if await E("()=>window.__ot!==null"): break
            await pg.wait_for_timeout(900)
            return await E("()=>window.__ot")
        def scr(js_obj):  # world -> client coords helper (JS snippet)
            return js_obj
        # ---------- home ----------
        st=await E("""()=>({row:!!document.getElementById('home22'), col:!!document.getElementById('homeCollage'), pop:!!document.getElementById('homePopout'),
          cats:[...document.querySelectorAll('#tplCats button, #tplCats .chip')].map(b=>b.textContent)})""")
        check('home: Collage + Pop-out shortcuts, Pop-out and Lettering template categories', st['row'] and st['col'] and st['pop'] and 'Pop-out' in st['cats'] and 'Lettering' in st['cats'], st)
        await wait(pg,"document.querySelectorAll('#tplGrid .tpl-card.ready').length>=4", 30000)
        await shot(pg, f'{SH}/01-home.png')
        n=await E("async()=>{const m=await import('./js/v2/templates.js'); return {n:m.TEMPLATES.length, ids:m.TEMPLATES.slice(26).map(t=>t.id)}}")
        check('templates: 10 new (2 pop-out, three-strip, text-behind, 6 Malayalam lettering) on top of the 26', n['n']==36 and len([i for i in n['ids'] if i.startswith('ml-letter')])==6, n)
        # ---------- pop-out template ----------
        await openT('popout-frame-post')
        await wait(pg,"PF.canvas.getObjects().some(o=>o.pfRole==='popSubject')",8000); await pg.wait_for_timeout(1200)
        pt=await E('''()=>{ const O=PF.canvas.getObjects(); const g=(r)=>O.filter(o=>o.pfRole===r); const ph=g('popPhoto')[0], s=g('popSubject')[0];
          const texts=O.filter(o=>o.type==='text').map(o=>({f:o.fontFamily,st:o.fontStyle,t:o.text,role:o.pfRole}));
          return {paper:g('bg').length, paperPat:!!(g('bg')[0]&&g('bg')[0].fill&&g('bg')[0].fill.source), frame:g('popFrame').length, frameShadow:!!(g('popFrame')[0]&&g('popFrame')[0].shadow), leaves:g('popLeaf').map(l=>Math.round(l.getScaledWidth())),
            shadow:g('popShadow').length, photoClip:!!(ph.clipPath&&ph.clipPath.absolutePositioned), subClip:s.clipPath&&s.clipPath.type, abs:s.clipPath&&s.clipPath.absolutePositioned, brk:s.pfBreak,
            same:[ph.left===s.left, ph.top===s.top, ph.scaleX===s.scaleX], order:[O.indexOf(ph),O.indexOf(g('popShadow')[0]),O.indexOf(s)], texts, W:PF.state.W, H:PF.state.H} }''')
        check('pop-out: ivory paper texture, white frame with soft shadow, photo clipped to the frame', pt['paper']==1 and pt['paperPat'] and pt['frame']==1 and pt['frameShadow'] and pt['photoClip'], pt)
        check('pop-out: subject exactly aligned on the photo, clipped by window ∪ below-break-line, contact shadow under it', all(pt['same']) and pt['subClip']=='group' and pt['abs'] and pt['brk']>0 and pt['shadow']==1 and pt['order'][0]<pt['order'][1]<pt['order'][2], pt)
        check('pop-out: two leaf stickers loaded', len(pt['leaves'])==2 and all(w>150 for w in pt['leaves']), pt['leaves'])
        tx=pt['texts']
        check('pop-out: small caps title (Cinzel), italic note, script note (Great Vibes), page counter', any(t['f']=='Cinzel' and t['t'].isupper() for t in tx) and any(t['st']=='italic' for t in tx) and any(t['f']=='Great Vibes' for t in tx) and any(t['role']=='pageNo' for t in tx), tx)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/02-popout-template.png')
        px_js='''async()=>{ const b=await PF.exportPNGBlob(1); const bm=await createImageBitmap(b); const c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height; const x=c.getContext('2d'); x.drawImage(bm,0,0);
          const s=PF.canvas.getObjects().find(o=>o.pfRole==='popShadow'); const d=x.getImageData(Math.round(s.left), Math.round(s.top-14), 1, 1).data; return [d[0],d[1],d[2]] }'''
        c1=await E(px_js)
        brown=lambda c: c[0]<190 and c[0]>c[2]+25 and c[1]<150
        check('pop-out: the part of the subject below the break line breaks out of the frame (basket visible on the paper)', brown(c1), c1)
        await E("()=>{const s=PF.canvas.getObjects().find(o=>o.pfRole==='popSubject'); PF.canvas.setActiveObject(s); PF.canvas.requestRenderAll(); PF.closePanel&&PF.closePanel();}"); await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/03-popout-break-line.png')
        hp=await E('''()=>{ const s=PF.canvas.getObjects().find(o=>o.pfRole==='popSubject'); const w=JSON.parse(s.pfPopWin); const v=PF.canvas.viewportTransform; const r=PF.canvas.upperCanvasEl.getBoundingClientRect();
          const k=r.width/PF.canvas.width; return {x:r.left+(v[4]+(w.x+w.w+30)*v[0])*k, y:r.top+(v[5]+s.pfBreak*v[3])*k, k:v[0]*k, b0:s.pfBreak, bottom:PF.canvas.getObjects().find(o=>o.pfRole==='popShadow').top} }''')
        await pg.mouse.move(hp['x'],hp['y']); await pg.mouse.down(); await pg.mouse.move(hp['x'],hp['y']+(hp['bottom']+40-hp['b0'])*hp['k'],steps=10); await pg.mouse.up(); await pg.wait_for_timeout(400)
        b1=await E("()=>PF.canvas.getObjects().find(o=>o.pfRole==='popSubject').pfBreak")
        c2=await E(px_js)
        check('break line is draggable: moving it below the basket tucks the subject back inside the frame', b1>hp['b0']+40 and not brown(c2), {'b0':hp['b0'],'b1':b1,'px':c2})
        await E("()=>PF.history.undo()"); await pg.wait_for_timeout(600)
        b2=await E("()=>PF.canvas.getObjects().find(o=>o.pfRole==='popSubject').pfBreak")
        check('break line move is undoable', abs(b2-hp['b0'])<1, [hp['b0'],b2])
        # ---------- Save pop-out as PNG ----------
        n0=await E("async()=>(await PF22.stickers.list()).length")
        sv=await E('''async()=>{ const before=Object.keys(window.__pfFiles).length; const id=PF.canvas.getObjects().find(o=>o.pfRole==='popSubject').pfPopout; const r=await PF22.popout.savePopoutPNG(id);
          const fs=Object.values(window.__pfFiles).slice(before); return {ok:r.ok, w:r.w, h:r.h, n:fs.length, act:fs[0]&&fs[0].action, mime:fs[0]&&fs[0].mime, b64:fs[0]&&fs[0].b64.join('')} }''')
        info=png_info(sv['b64']) if sv.get('b64') else {}
        n1=await E("async()=>(await PF22.stickers.list()).length")
        check('Save pop-out as PNG: transparent PNG (corners clear, frame opaque) saved to the gallery', sv['ok'] and sv['act']=='save' and sv['mime']=='image/png' and info.get('corner')==0 and info.get('mid')==255 and 500<info.get('w',0)<=1300, {k:v for k,v in sv.items() if k!='b64'}|info)
        check('saved pop-out is added to My stickers', n1==n0+1, [n0,n1])
        if sv.get('b64'): open('/tmp/pf22/popout.png','wb').write(base64.b64decode(sv['b64']))
        # ---------- pop-out on any photo (lift via the native bridge mock) ----------
        await E("async()=>{ await PF.setArtboard(1080,1350,false); PF.canvas.clear(); PF.canvas.setBackgroundColor('#101010'); }")
        await pg.set_input_files('#imageUploadInput', ps[0]); await pg.wait_for_timeout(1800)
        await E("()=>{ const o=PF.canvas.getObjects().find(x=>x.type==='image'); PF.canvas.setActiveObject(o); PF.canvas.fire('selection:created',{selected:[o]}); PF.canvas.requestRenderAll(); }"); await pg.wait_for_timeout(300)
        vis=await E("()=>!document.getElementById('btnPopout').classList.contains('hidden')")
        check('photo context strip has a Pop-out button', vis)
        await E("()=>document.getElementById('btnPopout').click()")
        ok=await wait(pg,"PF.canvas.getObjects().some(o=>o.pfRole==='popSubject')",10000); await pg.wait_for_timeout(1500)
        lp=await E('''()=>{ const O=PF.canvas.getObjects(); const ph=O.find(o=>o.pfRole==='popPhoto'), s=O.find(o=>o.pfRole==='popSubject'); if(!ph||!s) return {d:999};
          const a=ph.getCenterPoint(), b=s.getCenterPoint();
          return {d:Math.hypot(a.x-b.x,a.y-b.y), ratio:s.getScaledWidth()/ph.getScaledWidth(), menu:[...document.querySelectorAll('.sheet h2')].map(h=>h.textContent), roles:O.map(o=>o.pfRole).filter(Boolean), locked:!!s.locked} }''')
        check('Pop-out on any photo: lifts the subject and builds the frame around it, subject aligned (no lift menu left open)', ok and lp['d']<2 and abs(lp.get('ratio',0)-0.4)<0.02 and 'Subject lifted' not in lp.get('menu',[]) and not lp.get('locked'), lp)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/04-popout-any-photo.png')
        mv=await E('''()=>{ const O=PF.canvas.getObjects(); const ph=O.find(o=>o.pfRole==='popPhoto'), s=O.find(o=>o.pfRole==='popSubject'); const s0=[s.left,s.top], p0=[ph.left,ph.top];
          PF.canvas.fire('before:transform',{transform:{target:ph}}); ph.set({left:ph.left+40, top:ph.top-25}); ph.setCoords(); PF.canvas.fire('object:moving',{target:ph}); return [s.left-s0[0], s.top-s0[1], ph.left-p0[0], ph.top-p0[1]] }''')
        check('the subject (and its shadow) follow the photo when it is panned inside the frame', abs(mv[0]-mv[2])<0.5 and abs(mv[1]-mv[3])<0.5 and abs(mv[2])>10, mv)
        # ---------- lifted cutout: Save PNG + My stickers ----------
        sp=await E('''async()=>{ const n0=(await PF22.stickers.list()).length; const s=PF.canvas.getObjects().find(o=>o.pfRole==='popSubject'); const before=Object.keys(window.__pfFiles).length;
          const r=await PF21.saveImage(s,'save'); const f=Object.values(window.__pfFiles).slice(before)[0]; return {ok:r.ok, mime:f.mime, b64:f.b64.join(''), n:(await PF22.stickers.list()).length-n0} }''')
        si=png_info(sp['b64'])
        check('lifted cutout "Save PNG": transparent PNG saved and added to My stickers', sp['ok'] and sp['mime']=='image/png' and si['corner']==0 and si['mid']==255 and sp['n']==1, {k:v for k,v in sp.items() if k!='b64'}|si)
        await E("()=>{PF22.stickers.openStickers();}"); await pg.wait_for_timeout(700)
        st=await E("()=>({mine:document.querySelectorAll('#stMine .st-cell').length, bundled:document.querySelectorAll('#stBundled .st-cell').length})")
        check('My stickers library: saved items + bundled leaves & tape', st['mine']>=2 and st['bundled']==6, st)
        await shot(pg, f'{SH}/05-my-stickers.png')
        n0=await E("()=>PF.canvas.getObjects().length")
        await E("()=>document.querySelector('#stMine .st-img').click()"); await pg.wait_for_timeout(900)
        st=await E("()=>({n:PF.canvas.getObjects().length, sheet:!!document.getElementById('myStickers'), a:!!(PF.canvas.getActiveObject()&&PF.canvas.getActiveObject().pfSticker)})")
        check('tapping a sticker adds it as a new layer and closes the library', st['n']==n0+1 and not st['sheet'] and st['a'], st)
        await E("()=>{PF22.stickers.openStickers();}"); await pg.wait_for_timeout(600)
        k0=await E("()=>document.querySelectorAll('#stMine .st-cell').length")
        await E("()=>document.querySelector('#stMine .st-del').click()"); await pg.wait_for_timeout(500)
        k1=await E("()=>document.querySelectorAll('#stMine .st-cell').length")
        check('stickers can be deleted', k1==k0-1, [k0,k1])
        await E("()=>{ const b=[...document.querySelectorAll('.sheet .actions button')].find(x=>x.textContent==='Close'); b&&b.click(); }"); await pg.wait_for_timeout(300)
        # ---------- send text behind subject ----------
        bh=await E('''()=>{ const t=PF.makeText('BEHIND',{}); t.set({left:540,top:600}); PF.canvas.add(t); PF.canvas.setActiveObject(t); const O=()=>PF.canvas.getObjects();
          const ok=PF22.sendBehindSubject(t); const s=O().find(o=>o.pfRole==='popSubject'); return {ok, ti:O().indexOf(t), si:O().indexOf(s)} }''')
        check('Send text behind subject: the text moves directly under the subject layer', bh['ok'] and bh['ti']==bh['si']-1, bh)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(200)
        await shot(pg, f'{SH}/06-text-behind-subject-action.png')
        nb=await E('''()=>{ PF.canvas.clear(); const t=PF.makeText('X',{}); PF.canvas.add(t); document.querySelectorAll('.toast').forEach(x=>x.remove()); const r=PF22.sendBehindSubject(t); return {r, msg:[...document.querySelectorAll('.toast')].map(x=>x.textContent).join('|')} }''')
        check('Send behind subject without a lifted subject explains what to do', nb['r']==False and 'Lift a subject' in nb['msg'], nb)
        # ---------- templates: three-strip, text behind, Malayalam lettering ----------
        await openT('strip3-awaken'); await pg.wait_for_timeout(800)
        ts=await E('''()=>{ const O=PF.canvas.getObjects(); const strips=O.filter(o=>o.type==='image'&&o.clipPath); const s=O.find(o=>o.pfRole==='subject'); const t=O.find(o=>o.text==='AWAKEN'); const sub=O.find(o=>o.text==='A JOURNEY INWARD');
          const c=strips[1].clipPath; const sb=s.getBoundingRect(true,true);
          return {n:strips.length, bg:PF.canvas.backgroundColor, overTop:sb.top<c.top, overBottom:sb.top+sb.height>c.top+c.height, fill:t.fill, font:t.fontFamily, w:t.fontWeight, subCaps:sub.fontFamily, top:O.indexOf(s)===O.length-1, W:PF.state.W,H:PF.state.H} }''')
        check('three-strip story: 3 stacked photos on black, bold yellow serif title + small caps subtitle, cutout overlapping the strip edges', ts['n']==3 and ts['bg']=='#000000' and ts['overTop'] and ts['overBottom'] and ts['fill']=='#ffd21f' and ts['w']==900 and ts['subCaps']=='Cinzel' and ts['top'] and ts['H']==1920, ts)
        await shot(pg, f'{SH}/07-three-strip-story.png')
        await openT('text-behind-skyward'); await pg.wait_for_timeout(800)
        tb=await E('''()=>{ const O=PF.canvas.getObjects(); const t=O.find(o=>o.text==='SKYWARD'); const s=O.find(o=>o.pfRole==='subject'); const c=O.find(o=>o.pfRole==='pageNo'); const h=O.find(o=>o.fontFamily==='Caveat');
          return {behind:O.indexOf(t)<O.indexOf(s), thin:t.fontWeight, big:t.fontSize, counter:c&&c.text, hand:!!h, photo:O[0].getSrc().includes('muted')} }''')
        check('text behind subject template: big thin title behind the subject, handwritten line, 1/10 counter, muted film photo', tb['behind'] and tb['thin']==200 and tb['big']>200 and tb['counter']=='1/10' and tb['hand'] and tb['photo'], tb)
        await shot(pg, f'{SH}/08-text-behind-template.png')
        ml_ids=[i for i in n['ids'] if i.startswith('ml-letter')]
        mls=[]
        for i,tid in enumerate(ml_ids):
            await openT(tid); await pg.wait_for_timeout(700)
            r=await E('''async()=>{ const t=await import('./js/tools.js'); const o=PF.canvas.getObjects().find(x=>x.pfRole==='lettering'); await document.fonts.ready;
              return {font:o.fontFamily, ml:!!(t.fontEntry(o.fontFamily)||{}).ml, loaded:document.fonts.check(`${o.fontWeight} 40px "${o.fontFamily}"`,'മ'), stroke:o.stroke, sw:o.strokeWidth, sh2:!!o.pfShadow2, sh1:!!o.shadow, warp:o.pfWarp, pat:!!(o.fill&&o.fill.source)} }''')
            mls.append(r)
            await shot(pg, f'{SH}/{9+i:02d}-{tid}.png')
        check('6 Malayalam lettering templates: bundled Malayalam fonts, thick outlines, double shadows, curve/warp', len(mls)==6 and all(m['ml'] and m['loaded'] and m['stroke'] and m['sw']>=6 and m['sh1'] and m['sh2'] and m['warp'] in ('arc','wave') for m in mls), mls)
        check('lettering textures: cream / gold texture fills on 3 styles', sum(1 for m in mls if m['pat'])==3, [m['pat'] for m in mls])
        ch=await E('''async()=>{ const o=PF.canvas.getObjects().find(x=>x.pfRole==='lettering'); o.set({text:'സ്വാഗതം'}); o.initDimensions(); PF.canvas.requestRenderAll(); PF.history.record();
          const j=JSON.parse(PF.serialize()).canvas.objects.find(x=>x.pfRole==='lettering'); return {t:j.text, sh2:!!j.pfShadow2, warp:j.pfWarp, stroke:j.stroke} }''')
        check('only the words change: new Malayalam words keep every lettering effect (saved in the project)', ch['t']=='സ്വാഗതം' and ch['sh2'] and ch['warp'] and ch['stroke'], ch)
        await pg.wait_for_timeout(400); await shot(pg, f'{SH}/15-lettering-new-words.png')
        # ---------- collages ----------
        exp={'grid2':2,'grid3':3,'grid4':4,'grid6':6,'grid9':9,'strip2':2,'strip3':3,'magazine':4,'polaroid':4,'film':4,'circle':None,'heart':None,'letters':4,'panorama':4}
        counts={}
        for i,lid in enumerate(exp):
            cid=await E(f"async(u)=>await PF22.collage.buildCollage('{lid}', u)", urls[:3] if lid not in ('heart','circle','letters') else urls)
            await pg.wait_for_timeout(700)
            counts[lid]=await E(f"()=>({{cells:PF22.collage.cellObjects('{cid}').length, photos:PF22.collage.cellObjects('{cid}').filter(o=>o.type==='image').length, W:PF.state.W, H:PF.state.H}})")
            await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}")
            await shot(pg, f'{SH}/{16+i:02d}-collage-{lid}.png')
        good=all((exp[k] is None or v['cells']==exp[k]) for k,v in counts.items())
        check('collage presets: grids 2/3/4/6/9, story strips 2/3, magazine, polaroid, film, heart, circle, letters, panorama', good and counts['heart']['cells']>=15 and counts['circle']['cells']>=15, counts)
        check('collage fills: first photos go into the first cells; shape mosaics cycle the photos through every cell', counts['grid4']['photos']==3 and counts['heart']['photos']==counts['heart']['cells'] and counts['letters']['photos']==4, {k:counts[k] for k in ('grid4','heart','letters')})
        check('carousel panorama collage is a 3-slide 3240×1350 artboard', counts['panorama']['W']==3240 and counts['panorama']['H']==1350, counts['panorama'])
        check('story strips use the 9:16 story artboard', counts['strip3']['H']==1920, counts['strip3'])
        cid=await E("async(u)=>await PF22.collage.buildCollage('grid4', u)", urls[:3]); await pg.wait_for_timeout(600)
        cell=await E(f'''()=>{{ const o=PF22.collage.cellObjects('{cid}').find(x=>x.type!=='image'); const c=o.getCenterPoint(); const v=PF.canvas.viewportTransform; const r=PF.canvas.upperCanvasEl.getBoundingClientRect(); const k=r.width/PF.canvas.width;
          return {{x:r.left+(v[4]+c.x*v[0])*k, y:r.top+(v[5]+c.y*v[3])*k}} }}''')
        await E("()=>PF.closePanel&&PF.closePanel()"); await pg.wait_for_timeout(200)
        try:
            async with pg.expect_file_chooser(timeout=5000) as fc:
                await pg.mouse.click(cell['x'],cell['y'])
            chooser=await fc.value; await chooser.set_files(ps[3]); picked=True
        except Exception as e: picked=str(e)[:120]
        await pg.wait_for_timeout(2000)
        f4=await E(f"()=>PF22.collage.cellObjects('{cid}').filter(o=>o.type==='image').length")
        check('tap an empty cell: photo picker opens and the photo fills that cell', picked is True and f4==4, [picked,f4])
        g=await E(f'''()=>{{ const id='{cid}'; const a=PF22.collage.cellObjects(id)[0].clipPath; const l0=a.left; PF22.collage.relayout(id,{{gap:40, radius:60}}); return new Promise(r=>setTimeout(()=>{{ const c=PF22.collage.cellObjects(id)[0].clipPath; r({{l0, l1:c.left, rx:c.rx}}); }},300)); }}''')
        check('gap and corner sliders re-lay out every cell (clip moves with the gap, rounded corners)', g['l1']==40 and g['l0']!=40 and g['rx']==60, g)
        await E("()=>{PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(200)
        await shot(pg, f'{SH}/30-collage-gap-corners.png')
        dv=await E(f'''()=>{{ const m=JSON.parse(PF22.collage.cellObjects('{cid}')[0].pfCollage); const d=PF22.collage.cellsOf(m,PF.state.W,PF.state.H).divs.find(x=>x.horiz); const v=PF.canvas.viewportTransform; const r=PF.canvas.upperCanvasEl.getBoundingClientRect(); const k=r.width/PF.canvas.width;
          return {{x:r.left+(v[4]+d.x*v[0])*k, y:r.top+(v[5]+d.y*v[3])*k, s:v[0]*k, w0:PF22.collage.cellObjects('{cid}')[0].clipPath.width}} }}''')
        await pg.mouse.move(dv['x'],dv['y']); await pg.mouse.down(); await pg.mouse.move(dv['x']+150*dv['s'],dv['y'],steps=10); await pg.mouse.up(); await pg.wait_for_timeout(500)
        w1=await E(f"()=>PF22.collage.cellObjects('{cid}')[0].clipPath.width")
        check('drag a divider to resize neighbouring cells', w1>dv['w0']+100, [dv['w0'],w1])
        await shot(pg, f'{SH}/31-collage-divider-dragged.png')
        pz=await E(f'''()=>{{ const o=PF22.collage.cellObjects('{cid}')[0]; PF.canvas.setActiveObject(o); o.set({{left:o.left+5000}}); PF.canvas.fire('object:moving',{{target:o}}); const b=o.getBoundingRect(true,true); const c=o.clipPath;
          const covered=b.left<=c.left+0.5 && b.left+b.width>=c.left+c.width-0.5; PF22.collage.zoomCell(o,0.1); const s1=o.getScaledWidth()>=c.width-0.5 && o.getScaledHeight()>=c.height-0.5; const z0=o.scaleX; PF22.collage.zoomCell(o,1.5); return {{covered, s1, grew:o.scaleX/z0}} }}''')
        check('cell photos pan inside the cell (clamped so the cell stays covered) and zoom never shows gaps', pz['covered'] and pz['s1'] and abs(pz['grew']-1.5)<0.01, pz)
        pin=await E(f'''()=>{{ const o=PF22.collage.cellObjects('{cid}')[1]; PF.canvas.setActiveObject(o); const s0=o.scaleX; const el=PF.canvas.upperCanvasEl; const mk=(id,x,y)=>new Touch({{identifier:id,target:el,clientX:x,clientY:y}});
          const fire=(t,ts)=>el.dispatchEvent(new TouchEvent(t,{{touches:ts,targetTouches:ts,changedTouches:ts,bubbles:true,cancelable:true}}));
          fire('touchstart',[mk(1,150,300),mk(2,250,300)]); fire('touchmove',[mk(1,100,300),mk(2,300,300)]); fire('touchend',[]); return {{r:o.scaleX/s0, zoom:PF.state.zoom}} }}''')
        check('two-finger pinch on a selected cell photo zooms the photo inside its cell (not the poster)', abs(pin['r']-2)<0.05 and pin['zoom']==1, pin)
        sw=await E(f'''async(u)=>{{ const id='{cid}'; const o=PF22.collage.cellObjects(id)[2]; const src0=o.getSrc(); await PF22.collage.fillCells(id,[u],2,{{replace:true}}); const n=PF22.collage.cellObjects(id)[2]; return {{changed:n.getSrc()!==src0, clip:!!n.clipPath, i:n.pfCell}} }}''', urls[3])
        check('swap photo replaces the photo in the same cell (keeps the cell clip)', sw['changed'] and sw['clip'] and sw['i']==2, sw)
        await E(f"()=>{{ const o=PF22.collage.cellObjects('{cid}')[0]; PF.canvas.setActiveObject(o); PF.canvas.fire('selection:created',{{selected:[o]}}); }}"); await pg.wait_for_timeout(300)
        vis=await E("()=>['btnSwapPhoto','btnCollageCtl','btnPopout'].map(i=>!document.getElementById(i).classList.contains('hidden'))")
        check('cell photo context strip: Swap photo + Gap & corners (no Pop-out)', vis==[True,True,False], vis)
        rl=await E(f'''async()=>{{ const id='{cid}'; const st=JSON.parse(JSON.stringify(PF.projectState())); await PF.restoreProject(st); const c=PF22.collage.cellObjects(id); return {{n:c.length, abs:c.every(o=>o.type!=='image'||(o.clipPath&&o.clipPath.absolutePositioned)), pp:c.every(o=>o.type!=='image'||o.perPixelTargetFind)}} }}''')
        check('collage survives save / reload (cells, absolute clips, per-pixel hit testing)', rl['n']==4 and rl['abs'] and rl['pp'], rl)
        await E("()=>{PF.canvas.discardActiveObject(); PF22.collage.openCollages();}"); await pg.wait_for_timeout(700)
        st=await E("()=>document.querySelectorAll('#collagePicker .cl-card').length")
        check('collage picker lists all 14 presets with shape previews', st==14, st)
        await shot(pg, f'{SH}/32-collage-picker.png')
        await E("()=>{ const b=[...document.querySelectorAll('.sheet .actions button')].find(x=>x.textContent==='Close'); b&&b.click(); }"); await pg.wait_for_timeout(300)
        # ---------- ratio bar ----------
        await E("async()=>{ await PF.setArtboard(1080,1350,false); PF.canvas.clear(); }")
        await pg.set_input_files('#imageUploadInput', ps[0]); await pg.wait_for_timeout(1500)
        await E("()=>{PF.canvas.discardActiveObject(); PF.openPane('size');}"); await pg.wait_for_timeout(500)
        rb=await E("()=>({chips:[...document.querySelectorAll('#ratioBar .ratio-chip')].map(b=>b.dataset.ratio), icons:document.querySelectorAll('#ratioBar .ratio-icons svg').length, shapes:document.querySelectorAll('#ratioBar .ratio-shape').length, scroll:document.getElementById('ratioBar')&&getComputedStyle(document.getElementById('ratioBar')).overflowX})")
        need=['original','9:16','9:19.5','16:9','1:1','4:3','3:4','2:1','1.85:1','2.35:1','128:27']
        check('ratio bar: scrolling row with shape previews + platform icons, incl. Original, 5.8" phone, 128:27, 2:1, 2.35:1, 1.85:1', all(r in rb['chips'] for r in need) and rb['shapes']==11 and rb['icons']>=11 and rb['scroll']=='auto', rb)
        await shot(pg, f'{SH}/33-ratio-bar.png')
        sizes={}
        for rid in ['9:19.5','128:27','2.35:1','1.85:1','2:1','original','9:16']:
            if not await E("()=>!!document.getElementById('ratioBar')"): await E("()=>PF.openPane('size')"); await pg.wait_for_timeout(300)
            await E(f"()=>document.querySelector('#ratioBar [data-ratio=\"{rid}\"]').click()"); await pg.wait_for_timeout(500)
            sizes[rid]=await E("()=>[PF.state.W,PF.state.H]")
        check('ratios apply the right artboards (Original = the photo\'s 4:3 shape)', sizes=={'9:19.5':[1080,2340],'128:27':[3840,810],'2.35:1':[2538,1080],'1.85:1':[1998,1080],'2:1':[2160,1080],'original':[1440,1080],'9:16':[1080,1920]}, sizes)
        on=await E("()=>document.querySelector('#ratioBar .ratio-chip.on')?.dataset.ratio")
        check('the current ratio is highlighted', on=='9:16', on)
        await shot(pg, f'{SH}/34-ratio-9-16.png')
        st=await E("()=>({handle:document.documentElement.outerHTML.includes('sandeep_njr')})")
        check('no private handle anywhere in the UI', not st['handle'], st)
        check('fully offline: no outside requests', not external, external[:5])
        check('no page errors', not errors, errors[:5])
        await b.close()
    json.dump(results, open(f'/workspace/posterforge/test-results-v22{"-csp" if CSP else ""}-2.2.0.json','w'), indent=1)
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed")
asyncio.run(main())
