# PosterForge 2.0.0 feature suite. Usage: python3 e2e_v2.py [--csp]
import asyncio, json, sys, os, io, base64, re
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.3.0/regression-v2-'+('suite-csp' if CSP else 'suite')
os.makedirs(SH, exist_ok=True)
results=[]
def check(name, ok, info=''):
    results.append({'test':name,'ok':bool(ok),'info':str(info)[:500]}); print(('PASS ' if ok else 'FAIL ')+name, info if (not ok or info) else '', flush=True)

def photo(path, w, h, col):
    if not os.path.exists(path):
        im=Image.new('RGB',(w,h),col); d=ImageDraw.Draw(im)
        for k in range(0,w,max(4,w//60)): d.line([(k,0),(k,h)],fill=(255,255,255) if (k//8)%2 else (20,20,20),width=2)
        d.ellipse([w*0.3,h*0.3,w*0.7,h*0.7],fill=(250,200,40)); im.save(path,quality=92)
    return path

async def wait(pg, expr, ms=15000):
    for i in range(ms//50):
        if await pg.evaluate(expr): return True
        await pg.wait_for_timeout(50)
    return False

async def shot(pg, p, **kw):
    try: await pg.screenshot(path=p, timeout=20000, **kw)
    except Exception as e: print('WARN screenshot', p, str(e)[:120], flush=True)
async def main():
    small=photo('/tmp/pf2/small.jpg',400,300,(40,90,160)); big=photo('/tmp/pf2/big.jpg',3000,2000,(160,60,60))
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':412,'height':915},device_scale_factor=2.625,is_mobile=True,has_touch=True,bypass_csp=not CSP)
        await ctx.add_init_script(path='mock_native.js')
        await ctx.add_init_script(script="localStorage.setItem('pf.tour23','1')")
        external=[]; errors=[]
        async def route(r):
            u=r.request.url
            if u.startswith('http://127.0.0.1:8241/') or u.startswith('data:') or u.startswith('blob:'): await r.continue_()
            else: external.append(u); await r.abort()
        await ctx.route('**/*', route)
        pg=await ctx.new_page(); pg.set_default_timeout(20000); E=pg.evaluate
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        await pg.goto(URL)
        ok=await wait(pg,'!!(window.PF&&PF.v2Ready)')
        check('boot: v2 ready', ok)
        await pg.wait_for_timeout(600)
        # ---- onboarding + home ----
        st=await E('''()=>({ob:!!document.getElementById('onboard'), home:!document.getElementById('home').classList.contains('hidden')})''')
        check('first run: guide shown over home', st['ob'] and st['home'], st)
        await shot(pg, f'{SH}/01-onboarding.png')
        for i in range(3): await pg.click('#obNext'); await pg.wait_for_timeout(250)
        await shot(pg, f'{SH}/02-onboarding-last.png')
        await pg.click('#obNext'); await pg.wait_for_timeout(400)
        check('guide finishes and is remembered', await E("()=>!document.getElementById('onboard') && localStorage.getItem('pf.onboarded')==='1'"))
        n=await E("()=>document.querySelectorAll('#tplGrid .tpl-card').length")
        check('home: template gallery lists all templates', n>=20 and n<=40, n)
        await wait(pg,"document.querySelectorAll('#tplGrid .tpl-card.ready').length>=4", 30000)
        await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/03-home.png')
        await E("()=>document.getElementById('homeScroll').scrollTop=520"); await pg.wait_for_timeout(1500)
        await wait(pg,"document.querySelectorAll('#tplGrid .tpl-card.ready').length>=8", 30000)
        await shot(pg, f'{SH}/04-home-templates.png')
        tc=await E('''async()=>{ const m=await import('./js/v2/templates.js'); const t=m.TEMPLATES; const by={};
          for(const x of t){ by[x.size]=(by[x.size]||0)+1; } return {n:t.length, by, ml:t.filter(x=>x.lang==='ml').length, cats:[...new Set(t.map(x=>x.cat))]} }''')
        check('templates: 20-40 (36 since 2.2), all three sizes, Malayalam + English', 20<=tc['n']<=40 and len(tc['by'])==3 and tc['ml']>=6, tc)
        await E("()=>{document.querySelector('[data-cat=\"Malayalam\"]').click()}"); await pg.wait_for_timeout(300)
        nm=await E("()=>document.querySelectorAll('#tplGrid .tpl-card').length")
        check('home: category filter (Malayalam category; the 6 ml lettering templates sit in Lettering)', nm==tc['ml']-6, nm)
        await E("()=>{document.querySelector('[data-cat=\"All\"]').click()}")
        # ---- fonts: catalogue + files + licences ----
        fc=await E('''async()=>{ const t=await import('./js/tools.js'); const C=t.FONT_CATALOG.filter(f=>f.bundled);
          const en=C.filter(f=>!f.ml), ml=C.filter(f=>f.ml); const cats={}; en.forEach(f=>cats[f.group]=(cats[f.group]||0)+1);
          const urls=[...new Set(C.flatMap(f=>f.faces.map(x=>x.url)))]; const lic=[...new Set(C.map(f=>f.licenseFile))];
          const bad=[]; for(const u of urls.concat(lic)){ const r=await fetch(u); if(!r.ok) bad.push(u); }
          const licTypes=[...new Set(C.map(f=>f.license))];
          return {en:en.length, ml:ml.length, cats, faces:urls.length, bad, licTypes} }''')
        check('fonts: ~100 English families across 7 styles', 95<=fc['en']<=110 and len(fc['cats'])==7, fc['cats'])
        check('fonts: 30-40 Malayalam families', 30<=fc['ml']<=40, fc['ml'])
        check('fonts: every face file and licence file is bundled', not fc['bad'], fc['bad'][:5])
        check('fonts: only OFL / Apache / GPL+FE licences', all(re.match(r'^(OFL-1.1|Apache-2.0|GPL-3.0-or-later WITH Font-exception)$',x) for x in fc['licTypes']), fc['licTypes'])
        mlr=await E('''async()=>{ const t=await import('./js/tools.js'); const out=[]; const c=document.createElement('canvas').getContext('2d');
          c.font='40px monospace'; const fb=c.measureText('സ്നേഹം കേരളം').width;
          for(const f of t.FONT_CATALOG.filter(f=>f.ml)){ const face=f.faces.find(x=>!x.italic)||f.faces[0]; const w=face.variable?400:face.w;
            await document.fonts.load(`${w} 40px "${f.family}"`,'സ്നേഹം'); const ok=document.fonts.check(`${w} 40px "${f.family}"`,'സ്നേഹം');
            c.font=`${w} 40px "${f.family}", monospace`; const mw=c.measureText('സ്നേഹം കേരളം').width; if(!ok || Math.abs(mw-fb)<0.5) out.push(f.family); }
          return out }''')
        check('fonts: every Malayalam family loads and renders Malayalam', not mlr, mlr)
        # ---- open a template ----
        await E("()=>document.querySelector('[data-template=\"hook-sea-post\"]').click()"); await pg.wait_for_timeout(1500)
        st=await E('''()=>({home:!document.getElementById('home').classList.contains('hidden'), n:PF.canvas.getObjects().length, W:PF.state.W, H:PF.state.H, txt:PF.canvas.getObjects().filter(o=>o.type==='text').map(o=>o.fontFamily)})''')
        check('template opens editable in the editor', not st['home'] and st['n']>=3 and st['W']==1080 and st['H']==1350 and 'DM Serif Display' in st['txt'], st)
        await shot(pg, f'{SH}/05-editor-hook-template.png')
        # selection -> context strip slides up
        await E("()=>{const t=PF.canvas.getObjects().find(o=>o.type==='text'); PF.canvas.setActiveObject(t); PF.canvas.fire('selection:created',{selected:[t]}); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(400)
        st=await E("()=>({strip:!document.getElementById('ctxStrip').classList.contains('hidden'), fx:!document.getElementById('btnTypo').classList.contains('hidden'), photo:document.getElementById('btnPhotoTools').classList.contains('hidden')})")
        check('selecting text shows context tools (Effects visible, Edit photo hidden)', st['strip'] and st['fx'] and st['photo'], st)
        await shot(pg, f'{SH}/06-text-selected-strip.png')
        # quick slider
        await pg.click('#btnQuickSize'); await pg.wait_for_timeout(250)
        fs0=await E("()=>PF.active().fontSize")
        await E("()=>{const r=document.getElementById('quickRange'); r.value=String(Math.round(PF.active().fontSize*0.8)); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change'));}")
        fs1=await E("()=>PF.active().fontSize")
        check('on-canvas quick size slider changes the text', abs(fs1-fs0*0.8)<2 and await E("()=>!document.getElementById('quickSlider').classList.contains('hidden')"), (fs0,fs1))
        await shot(pg, f'{SH}/07-quick-slider.png')
        await E("()=>document.getElementById('quickClose').click()")
        # ---- font picker ----
        await E("()=>{PFFonts.openFontPicker()}"); await pg.wait_for_timeout(700)
        rows=await E("()=>document.querySelectorAll('.fp-row').length")
        allc=await E("async()=>{const t=await import('./js/tools.js'); return t.FONT_CATALOG.length}")
        check('picker: lists every font', rows==allc, (rows,allc))
        styled=await E("()=>[...document.querySelectorAll('.fp-row')].slice(0,6).every(r=>r.querySelector('.fp-name').style.fontFamily.includes(r.dataset.font))")
        check('picker: each name is rendered in its own font (lazy)', styled)
        prev=await E("()=>document.querySelector('.fp-row .fp-prev').textContent")
        check('picker: live preview uses the selected text', prev.startswith('If you love'), prev)
        await shot(pg, f'{SH}/08-font-picker.png')
        await E("()=>document.querySelector('.fp-row[data-font=\"Bebas Neue\"]').click()"); await pg.wait_for_timeout(500)
        live=await E("()=>PF.active().fontFamily")
        check('picker: tapping a font applies it to the poster immediately', live=='Bebas Neue', live)
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Cancel').click()"); await pg.wait_for_timeout(300)
        check('picker: Cancel restores the original font', await E("()=>PF.active().fontFamily")=='DM Serif Display')
        await E("()=>{PFFonts.openFontPicker()}"); await pg.wait_for_timeout(500)
        await pg.fill('.fp-search','playfair'); await pg.wait_for_timeout(200)
        check('picker: search', await E("()=>document.querySelectorAll('.fp-row').length")==1)
        await E("()=>document.querySelector('.fp-row[data-font=\"Playfair Display\"] .fp-exp').click()"); await pg.wait_for_timeout(500)
        faces=await E("()=>[...document.querySelectorAll('.fp-face .fp-face-l')].map(x=>x.textContent)")
        check('picker: family expansion shows weights/italics side by side', len(faces)>=2 and any('Italic' in f for f in faces), faces)
        await shot(pg, f'{SH}/09-font-family-expanded.png')
        await E("()=>document.querySelector('.fp-row[data-font=\"Playfair Display\"]').click()"); await pg.wait_for_timeout(300)
        await E("()=>document.querySelector('.fp-row[data-font=\"Playfair Display\"] .fp-star').click()")
        await pg.fill('.fp-search',''); await E("()=>document.querySelector('[data-filter=\"Favourites\"]').click()"); await pg.wait_for_timeout(200)
        check('picker: favourites filter', await E("()=>[...document.querySelectorAll('.fp-row')].map(r=>r.dataset.font)")==['Playfair Display'])
        await E("()=>document.querySelector('[data-filter=\"Malayalam\"]').click()"); await pg.wait_for_timeout(600)
        mlp=await E("()=>({n:document.querySelectorAll('.fp-row').length, s:document.querySelector('.fp-row .fp-prev').textContent})")
        check('picker: Malayalam filter with സ്നേഹം samples', mlp['n']==fc['ml'] and 'സ്നേഹം' in mlp['s'], mlp)
        await shot(pg, f'{SH}/10-font-picker-malayalam.png')
        await E("()=>document.querySelector('[data-filter=\"Condensed\"]').click()"); await pg.wait_for_timeout(200)
        h0=await E("()=>PF.history.undoStack.length")
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Done').click()"); await pg.wait_for_timeout(300)
        h1=await E("()=>PF.history.undoStack.length")
        check('picker: Done keeps the font as one undo step', await E("()=>PF.active().fontFamily")=='Playfair Display' and h1==h0+1, (h0,h1))
        # bold / italic real faces
        bi=await E('''async()=>{ const o=PF.active(); PF.openPane('font'); document.getElementById('btnBold').click(); await new Promise(r=>setTimeout(r,400));
          const t=await import('./js/tools.js'); const r1={w:o.fontWeight, real:t.hasFace(o.fontFamily,o.fontWeight,false)};
          document.getElementById('btnItalic').click(); await new Promise(r=>setTimeout(r,400)); r1.it=o.fontStyle; r1.realIt=t.hasFace(o.fontFamily,o.fontWeight,true);
          document.getElementById('btnItalic').click(); document.getElementById('btnBold').click(); await new Promise(r=>setTimeout(r,300));
          r1.bebasBoldReal=t.hasFace('Bebas Neue',700,false); r1.poppinsBold=t.hasFace('Poppins',700,false); r1.poppinsIt=t.hasFace('Poppins',400,true); PF.closePanel(); return r1 }''')
        check('B / I use real bold & italic faces when the font has them (synthetic otherwise)', bi['w']>=700 and bi['real'] and bi['it']=='italic' and bi['realIt'] and not bi['bebasBoldReal'] and bi['poppinsBold'] and bi['poppinsIt'], bi)
        # ---- typography ----
        ty=await E('''async()=>{ const o=PF.active(); PF.openPane('typo'); await new Promise(r=>setTimeout(r,300));
          const set=(id,v)=>{const e=document.getElementById(id); e.value=String(v); e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change'));};
          set('tyLetter',200); set('tyLine',150); const r={cs:o.charSpacing, lh:o.lineHeight, h0:o.height, w0:o.width};
          document.querySelector('#tyWarp [data-warp="arc"]').click(); set('tyBend',60); r.warp=o.pfWarp; r.amt=o.pfWarpAmt; r.h1=o.height; r.w1=o.width;
          document.querySelector('#tyFill [data-fill="gradient"]').click(); r.grad=!!(o.fill&&o.fill.colorStops);
          document.getElementById('tyGlowBtn').click(); r.glow=o.pfGlow && o.shadow && o.shadow.offsetX===0 && o.shadow.blur>0; return r }''')
        check('letter & line spacing sliders', ty['cs']==200 and abs(ty['lh']-1.5)<1e-6, ty)
        check('curved text (arc) reshapes the bounding box', ty['warp']=='arc' and ty['amt']==60 and (abs(ty['h1']-ty['h0'])>5 or abs(ty['w1']-ty['w0'])>5), ty)
        check('gradient text fill + glow', ty['grad'] and ty['glow'], ty)
        await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/11-text-effects-curved-gradient.png')
        rt=await E('''async()=>{ const s=PF.serialize(); await PF.restore(s); const o=PF.canvas.getObjects().find(x=>x.pfWarp); return {warp:o&&o.pfWarp, grad:!!(o&&o.fill&&o.fill.colorStops), glow:o&&o.pfGlow} }''')
        check('effects survive save/restore', rt['warp']=='arc' and rt['grad'] and rt['glow'], rt)
        # Malayalam shaping kept through the warp: tiny bend ~= flat rendering
        iou=await E('''async()=>{ const t=new fabric.Text('സ്നേഹം ക്ഷേത്രം',{fontFamily:'Manjari',fontSize:120,fill:'#000',left:0,top:0}); await document.fonts.load('400 120px Manjari','സ്നേഹം');
          const mk=(o)=>{const c=document.createElement('canvas'); c.width=Math.ceil(o.width)+40; c.height=Math.ceil(o.height)+40; const x=c.getContext('2d'); x.translate(c.width/2,c.height/2); o._render(x); return x.getImageData(0,0,c.width,c.height)};
          t.initDimensions(); const a=mk(t); t.set({pfWarp:'arc',pfWarpAmt:0.3}); t.initDimensions(); const bb=mk(t);
          let i=0,u=0; const W=Math.min(a.width,bb.width), H=Math.min(a.height,bb.height);
          for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const p=a.data[(y*a.width+x)*4+3]>80, q=bb.data[(y*bb.width+x)*4+3]>80; if(p&&q)i++; if(p||q)u++; } return i/u }''')
        check('curved Malayalam keeps the browser (HarfBuzz) shaping: warped ≈ flat glyphs', iou>0.8, round(iou,3))
        mlc=await E('''async()=>{ const t=PF.makeText('സ്നേഹം എന്നും',{fontFamily:'Baloo Chettan 2',fontSize:110}); t.set({top:1050}); PF.canvas.add(t); PF.canvas.setActiveObject(t);
          const fx=await import('./js/v2/textfx.js'); fx.setWarp(t,'arc',-55); t.set('fill', fx.gradientFill(t,'#fde68a','#f97316',0)); PF.canvas.requestRenderAll(); PF.history.record();
          const sc=await PF.renderStatic(0.5); const d=sc.lowerCanvasEl.getContext('2d').getImageData(0,0,540,675).data; let n=0; for(let i=3;i<d.length;i+=4) n++; sc.dispose(); return t.pfWarp }''')
        await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/12-curved-malayalam.png')
        wav=await E('''async()=>{ const o=PF.active(); const fx=await import('./js/v2/textfx.js'); fx.setWarp(o,'wave',50); const h=o.height; fx.setWarp(o,'circle',100); const r={wave:h, circle:o.height, cw:o.width}; fx.setWarp(o,'arc',-55); return r }''')
        check('text on a path: wave and circle presets', wav['wave']>0 and wav['circle']>0, wav)
        # photo texture + saved styles
        tx=await E('''async()=>{ const o=PF.active(); const typo=await import('./js/v2/typo.js'); await typo.setTexture('templates/sea-aerial.webp', o); const pat=o.fill && o.fill.source ? 'pattern':'none';
          typo.saveStyle(typo.captureStyle(o,'My curved')); const t2=PF.makeText('Second',{}); PF.canvas.add(t2); await typo.applyStyle(t2, typo.savedStyles()[0]);
          const r={pat, styled: t2.pfWarp==='arc' && t2.fontFamily===o.fontFamily, nStyles:typo.savedStyles().length}; PF.canvas.remove(t2); return r }''')
        check('photo-textured text fill', tx['pat']=='pattern', tx)
        check('saved text styles: save and apply to another text', tx['styled'] and tx['nStyles']==1, tx)
        st=await E("()=>{const o=PF.active(); o.set('fill','#ffffff'); PF.openPane('typo'); return document.querySelectorAll('#tyStyles .style-chip').length}")
        await pg.wait_for_timeout(300); await shot(pg, f'{SH}/13-text-effects-pane.png'); await E("()=>PF.closePanel()")
        check('text styles grid shows saved + built-in styles', st>=7, st)
        # ---- carousel ----
        await E("()=>PFv2.showHome()"); await pg.wait_for_timeout(400)
        await E("()=>document.querySelector('[data-template=\"film-dusk-10\"]').click()"); await pg.wait_for_timeout(600)
        if await E("()=>!!document.querySelector('.sheet [data-value=\"replace\"]')"): await E("()=>document.querySelector('.sheet [data-value=\"replace\"]').click()")
        await wait(pg,"document.getElementById('home').classList.contains('hidden')")
        await pg.wait_for_timeout(800)
        cr=await E("()=>({n:PFPages.pageCount(), c:PF.canvas.getObjects().find(o=>o.pfRole==='counter').text, pill:document.getElementById('pageLabel').textContent})")
        check('film carousel template: 10 pages with 1/10 counter', cr['n']==10 and cr['c']=='1/10' and cr['pill']=='1/10', cr)
        await shot(pg, f'{SH}/14-film-quote-1of10.png')
        await E("()=>PFPages.goTo(3)"); await pg.wait_for_timeout(500)
        check('page switching updates the counter automatically', await E("()=>PF.canvas.getObjects().find(o=>o.pfRole==='counter').text")=='4/10')
        await E("()=>PFPages.addPage({duplicate:true})"); await pg.wait_for_timeout(400)
        cr=await E("()=>({n:PFPages.pageCount(), page:PF.state.page, c:PF.canvas.getObjects().find(o=>o.pfRole==='counter').text})")
        check('add/duplicate page renumbers every counter', cr['n']==11 and cr['c']=='5/11', cr)
        await E("()=>PFPages.deletePage(PF.state.page)"); await pg.wait_for_timeout(300)
        check('delete page', await E("()=>PFPages.pageCount()")==10)
        await E("()=>{PFPages.openPagesSheet()}"); await pg.wait_for_timeout(1500)
        check('pages sheet shows a thumbnail per page', await E("()=>document.querySelectorAll('.page-card img[src^=\"data:\"]').length")==10)
        await shot(pg, f'{SH}/15-pages-sheet.png')
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Done').click()"); await pg.wait_for_timeout(300)
        ex=await E('''async()=>{ const before=Object.keys(window.__pfFiles).length; const p0=PF.state.page; const r=await PFExport.runExport({kind:'png',scale:1,allPages:true}); await new Promise(r=>setTimeout(r,300));
          return {ok:r.ok, n:r.results.length, files:Object.keys(window.__pfFiles).length-before, page:PF.state.page, p0} }''')
        check('export all carousel pages at once', ex['ok'] and ex['n']==10 and ex['files']==10 and ex['page']==ex['p0'], ex)
        sv=await E('''async()=>{ PF.state.projectName='Carousel test'; PF.state.projectId=null; await PF.saveProject(false); return 1 }''')
        await pg.wait_for_timeout(300)
        if await E("()=>!!document.querySelector('.sheet input')"):
            await pg.fill('.sheet input','Carousel test'); await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Save').click()")
        await pg.wait_for_timeout(1200)
        pr=await E('''async()=>{ const db=await import('./js/db.js'); const p=(await db.getAllPosterProjects()).find(x=>x.name==='Carousel test'); return p? {pages:p.state.pages.length, fonts:p.fonts.map(f=>f.family), npages:p.pages}:null }''')
        check('projects save every page and remember their fonts', pr and pr['pages']==10 and 'Cormorant Garamond' in pr['fonts'], pr)
        # ---- missing font warning ----
        mf=await E('''()=>PFFonts.checkMissing({canvas:{objects:[{type:'text',fontFamily:'Nonexistent Font',text:'x'},{type:'text',fontFamily:'Poppins',text:'y'}]}})''')
        check('missing-font warning names the missing font', mf==['Nonexistent Font'], mf)
        # ---- font import ----
        await E("()=>PFv2.showHome()"); await pg.wait_for_timeout(300)
        await E("()=>document.getElementById('homeNew').click()"); await pg.wait_for_timeout(300)
        await E("()=>document.querySelector('.sheet .menu-list button, .sheet button[data-value]')&&[...document.querySelectorAll('.sheet button')].find(b=>/Portrait/.test(b.textContent)).click()"); await pg.wait_for_timeout(500)
        if await E("()=>!!document.querySelector('.sheet [data-value=\"replace\"]')"): await E("()=>document.querySelector('.sheet [data-value=\"replace\"]').click()")
        await wait(pg,"document.getElementById('home').classList.contains('hidden')"); await pg.wait_for_timeout(400)
        check('New poster from home opens a blank canvas', await E("()=>PF.canvas.getObjects().length===0 && PF.state.H===1350 && PFPages.pageCount()===1"))
        await E("()=>PF.closePanel()")
        await E("()=>{const t=PF.makeText('Imported font test',{}); PF.canvas.add(t); PF.canvas.setActiveObject(t); PF.canvas.requestRenderAll();}")
        await E("()=>{PFFonts.openFontPicker({filter:'My Fonts'})}"); await pg.wait_for_timeout(400)
        await pg.set_input_files('#fontImportInput',['/tmp/pf2/TestSans-Regular.ttf','/tmp/pf2/TestSans-Bold.ttf','/tmp/pf2/TestSans-Italic.ttf','/tmp/pf2/TestMal.zip','/tmp/pf2/TestPlain.ttf','/tmp/pf2/notafont.ttf'])
        await wait(pg,"!!document.querySelector('.imp-row')", 15000); await pg.wait_for_timeout(300)
        await shot(pg, f'{SH}/16-font-import-summary.png')
        imp=await E('''()=>({title:[...document.querySelectorAll('.sheet h2')].pop().textContent, rows:[...document.querySelectorAll('.imp-row')].map(r=>r.textContent), skipped:[...document.querySelectorAll('.sheet .note')].map(n=>n.textContent).join(' ')})''')
        check('import: several TTFs + a ZIP at once, bad file skipped', 'Imported 6 font files' in imp['title'] and 'notafont' in imp['skipped'], imp)
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='OK').click()"); await pg.wait_for_timeout(400)
        cat=await E('''async()=>{ const t=await import('./js/tools.js'); const g=(f)=>{const e=t.fontEntry(f); return e?{group:e.group, ml:e.ml, faces:e.faces.map(x=>x.w+(x.italic?'i':''))}:null}; return {sans:g('Test Sans'), mal:g('Test Mal'), plain:g('Test Plain')} }''')
        check('import: family grouping + weight + italic from name/OS2', cat['sans'] and sorted(cat['sans']['faces'])==['400','400i','700'], cat)
        check('import: style class from the font file (PANOSE → Sans), Malayalam detected from cmap, unknown → Other', cat['sans']['group']=='Sans' and cat['mal']['group']=='Malayalam' and cat['mal']['ml'] and cat['plain']['group']=='Other', cat)
        await shot(pg, f'{SH}/17-my-fonts.png')
        await E("()=>document.querySelector('.fp-row[data-font=\"Test Sans\"]').click()"); await pg.wait_for_timeout(400)
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Done').click()"); await pg.wait_for_timeout(300)
        rb=await E('''async()=>{ const o=PF.active(); o.set('fontWeight',400); PF.openPane('font'); document.getElementById('btnBold').click(); await new Promise(r=>setTimeout(r,400)); const t=await import('./js/tools.js');
          const r={fam:o.fontFamily, w:o.fontWeight, real:t.hasFace('Test Sans',o.fontWeight,false)}; await document.fonts.ready; r.loaded=document.fonts.check('700 40px "Test Sans"'); PF.closePanel(); return r }''')
        check('imported font applies, B uses its real Bold file', rb['fam']=='Test Sans' and rb['w']==700 and rb['real'] and rb['loaded'], rb)
        mv=await E('''async()=>{ await PFFonts.moveUserFont('Test Plain','Display'); await PFFonts.renameUserFont('Test Sans','My Brand Sans'); PFFonts.toggleFav('Test Sans');
          const t=await import('./js/tools.js'); return {g:t.fontEntry('Test Plain').group, label:t.fontEntry('Test Sans').label} }''')
        check('My Fonts: move category, rename, favourite', mv['g']=='Display' and mv['label']=='My Brand Sans', mv)
        await E("()=>PF.scheduleAutosave()"); await pg.wait_for_timeout(2200)
        # reload: imported fonts persist offline
        await pg.reload(); await wait(pg,'!!(window.PF&&PF.v2Ready)'); await pg.wait_for_timeout(600)
        per=await E('''async()=>{ const t=await import('./js/tools.js'); const e=t.fontEntry('Test Sans'); await document.fonts.load('700 40px "Test Sans"'); return {e:!!e, label:e&&e.label, ok:document.fonts.check('700 40px "Test Sans"'), fav:PFFonts.favs().has('Test Sans'), plain:t.fontEntry('Test Plain').group} }''')
        check('imported fonts persist after restart (stored in the app, offline)', per['e'] and per['ok'] and per['label']=='My Brand Sans' and per['fav'] and per['plain']=='Display', per)
        await E("()=>{const c=document.querySelector('#homeContinue'); c&&c.click()}"); await pg.wait_for_timeout(500)
        dl=await E('''async()=>{ await PFFonts.deleteUserFontFamily('Test Plain'); const t=await import('./js/tools.js'); const db=await import('./js/db.js'); return {gone:!t.fontEntry('Test Plain'), recs:(await db.getAllUserFonts()).filter(r=>r.family==='Test Plain').length} }''')
        check('My Fonts: delete', dl['gone'] and dl['recs']==0, dl)
        # ---- photo tools ----
        await E("()=>PF.closePanel()")
        await pg.set_input_files('#imageUploadInput', big); await wait(pg,"PF.canvas.getObjects().some(o=>o.type==='image')", 20000); await pg.wait_for_timeout(800)
        await E("()=>{const o=PF.canvas.getObjects().find(o=>o.type==='image'); PF.canvas.setActiveObject(o); PF.canvas.fire('selection:created',{selected:[o]});}"); await pg.wait_for_timeout(300)
        check('selecting a photo shows Edit photo', await E("()=>!document.getElementById('btnPhotoTools').classList.contains('hidden')"))
        await pg.click('#btnPhotoTools'); await pg.wait_for_timeout(1200)
        await E("()=>document.querySelector('[data-aspect=\"1:1\"]').click()"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/18-photo-crop.png')
        await E("()=>document.querySelector('[data-tab=\"curves\"]').click()"); await pg.wait_for_timeout(500)
        await shot(pg, f'{SH}/19-photo-curves.png')
        await E("()=>document.querySelector('[data-tab=\"film\"]').click()"); await pg.wait_for_timeout(300)
        await E("()=>document.querySelector('[data-film=\"Teal & orange\"]').click()"); await pg.wait_for_timeout(500)
        await shot(pg, f'{SH}/20-photo-presets.png')
        w0=await E("()=>{const o=PF.active(); return [o.width,o.height]}")
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Apply').click()")
        await wait(pg,"!!PF.active() && !!PF.active().pfGeo && !!PF.active().pfFilter", 30000); await pg.wait_for_timeout(500)
        ph=await E("()=>{const o=PF.active(); return {w:o.width,h:o.height, geo:JSON.parse(o.pfGeo), f:JSON.parse(o.pfFilter)}}")
        check('crop 1:1 applied (square image) and preset filter stored', abs(ph['w']-ph['h'])<=2 and ph['w']<w0[0] and 'curve' in ph['f'] and 'hsl' in ph['f'], {'w0':w0,'ph':{k:ph[k] for k in ('w','h')}, 'f':list(ph['f'])})
        pe=await E('''async()=>{ const o=PF.active(); const ph=await import('./js/v2/photo.js'); const g=JSON.parse(o.pfGeo); g.pv=40; g.rot=6;
          const before=o.getSrc(); await ph.applyEdits(o,g,{...JSON.parse(o.pfFilter), grain:40}, o.pfGeoBase); return {changed:o.getSrc()!==before, geo:JSON.parse(o.pfGeo), grain:JSON.parse(o.pfFilter).grain, n:PF.history.undoStack.length} }''')
        check('straighten + perspective + grain re-applied from the original', pe['changed'] and pe['geo']['pv']==40 and pe['geo']['rot']==6 and pe['grain']==40, pe)
        par=await E('''async()=>{ const im=await import('./js/imaging.js'); const lut=im.curveLUT([[0,0],[64,48],[128,128],[192,208],[255,255]]); const h=im.hslAdjust(220,120,40,[[30,20,30,10]]);
          return {l32:lut[32], l100:lut[100], l200:lut[200], h:h.map(v=>Math.round(v*100)/100), g:[im.grainNoise(3,7), im.grainNoise(1000,2000)]} }''')
        open('/tmp/pf2/parity.json','w').write(json.dumps(par))
        check('colour maths vectors exported for Kotlin parity test', 'l32' in par, par)
        # export at full resolution uses the original with geometry
        ex2=await E('''async()=>{ const sc=await PF.renderStatic(2); const o=sc.getObjects().find(x=>x.type==='image'); const r={swapped:!!(o&&o.width>=1000), ratio:o? o.width/o.height:0, w:o&&o.width}; sc.dispose(); return r }''')
        check('high-res export re-applies crop to the full-resolution original', ex2['swapped'] and abs(ex2['ratio']-1)<0.02, ex2)
        # ---- export options ----
        lr=await E('''async()=>{ await new Promise(r=>{ fabric.Image.fromURL('data:image/png;base64,'+btoa(String.fromCharCode(...new Uint8Array(0))),()=>r()) }); return 1 }''')
        await pg.set_input_files('#imageUploadInput', small); await wait(pg,"PF.canvas.getObjects().filter(o=>o.type==='image').length>=2", 20000); await pg.wait_for_timeout(600)
        await E("()=>{const o=PF.canvas.getObjects().filter(o=>o.type==='image').pop(); o.scaleToWidth(900); PF.canvas.requestRenderAll();}")
        low=await E("()=>PFExport.lowResImages(3).length")
        check('low-resolution warning detects an upscaled photo', low>=1, low)
        await E("()=>{PF.canvas.discardActiveObject(); localStorage.setItem('pf.exp.preset','x3'); PFExport.exportSheetV2()}"); await pg.wait_for_timeout(500)
        check('export sheet shows the warning', await E("()=>!!document.getElementById('expLowRes')"))
        await E("()=>document.querySelector('#expKind [data-kind=\"pdf\"]').click()"); await pg.wait_for_timeout(200)
        await shot(pg, f'{SH}/21-export-sheet-pdf.png')
        await E("()=>document.querySelector('#expKind [data-kind=\"jpg\"]').click()"); await pg.wait_for_timeout(200)
        await shot(pg, f'{SH}/22-export-sheet-jpg.png')
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Share').parentNode.parentNode.parentNode.click()"); await E("()=>{ const s=document.querySelector('.sheet-backdrop'); s&&s.click(); }"); await pg.wait_for_timeout(300)
        q=await E('''async()=>{ const a=await PF.exportPNGBlob(1,'image/jpeg',0.5), b=await PF.exportPNGBlob(1,'image/jpeg',0.95); return [a.size,b.size] }''')
        check('JPEG quality setting changes the file', q[0]<q[1]*0.8, q)
        tp=await E('''async()=>{ PF.canvas.setBackgroundColor('#ff0000'); const hid=PF.canvas.getObjects().filter(o=>o.visible!==false&&o.pfRole!=='bg'); hid.forEach(o=>o.visible=false); const bl=await PF.exportPNGBlob(1,'image/png',1,{transparent:true}); const bmp=await createImageBitmap(bl); const c=document.createElement('canvas'); c.width=bmp.width; c.height=bmp.height; const x=c.getContext('2d'); x.drawImage(bmp,0,0); hid.forEach(o=>o.visible=true); return x.getImageData(2,2,1,1).data[3] }''')
        check('transparent PNG has a transparent background', tp==0, tp)
        sz=await E('''async()=>{ const m=await import('./js/v2/export.js'); return m.SIZE_PRESETS.map(p=>[p.id, Math.round(PF.state.W*m.presetScale(p,PF.state.W,PF.state.H))]) }''')
        check('size presets (1-4×, Instagram, HD, print A4 300 dpi)', dict(sz)['ig']==1080 and dict(sz)['x4']==4320 and dict(sz)['print']==round(3508*1080/1350), sz)
        pdf=await E('''async()=>{ const bl=await PFExport.exportPDF({scale:1,bleedMm:3,marks:true,allPages:false}); const u=new Uint8Array(await bl.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s) }''')
        open('/tmp/pf2/test.pdf','wb').write(base64.b64decode(pdf))
        import subprocess
        info=subprocess.run(['pdfinfo','-box','/tmp/pf2/test.pdf'],capture_output=True,text=True).stdout
        trim=re.search(r'TrimBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)',info); bleed=re.search(r'BleedBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)',info)
        ok=trim and bleed and abs((float(trim.group(1))-float(bleed.group(1)))-8.5)<0.2 and re.search(r'Pages:\s+1\n',info)
        check('PDF with 3 mm bleed + crop marks is valid (pdfinfo: TrimBox inset 8.5 pt from BleedBox)', ok, info.replace('\n',' | ')[:400])
        subprocess.run(['pdftoppm','-png','-r','40','-singlefile','/tmp/pf2/test.pdf',f'{SH}/23-pdf-bleed-preview'])
        # ---- backup & restore ----
        bk=await E('''async()=>{ const B=PFBackup; const db=await import('./js/db.js'); const n0=(await db.getAllPosterProjects()).length; const f0=(await db.getAllUserFonts()).length;
          const {blob,counts}=await B.buildBackup({originals:true}); const text=await blob.text();
          for(const s of ['projects','userfonts','vectors','originals']) await db.clearStore(s); localStorage.removeItem('pf.textStyles');
          const mid=(await db.getAllPosterProjects()).length; const r=await B.restoreBackup(text); await PFFonts.loadUserFonts();
          return {n0, f0, mid, n1:(await db.getAllPosterProjects()).length, f1:(await db.getAllUserFonts()).length, styles:JSON.parse(localStorage.getItem('pf.textStyles')||'[]').length, size:blob.size, counts} }''')
        check('backup → wipe → restore brings back projects, fonts and styles', bk['n0']>=1 and bk['mid']==0 and bk['n1']==bk['n0'] and bk['f1']==bk['f0'] and bk['styles']==1, bk)
        bf=await E('''async()=>{ const before=Object.keys(window.__pfFiles).length; const p0=PF.state.page; await PFBackup.backupSheet; const r=await (async()=>{ const {blob}=await PFBackup.buildBackup({originals:false}); return (await import('./js/native.js')).sendBlob(blob,'PosterForge-backup-test.pfbackup','application/octet-stream','save') })(); return {ok:r.ok, file:Object.values(window.__pfFiles).pop().name} }''')
        check('backup file saved through the Android bridge', bf['ok'] and bf['file'].endswith('.pfbackup'), bf)
        await E("()=>{PFBackup.backupSheet()}"); await pg.wait_for_timeout(400); await shot(pg, f'{SH}/24-backup-sheet.png'); await E("()=>window.pfHandleBack()")
        # restore through the file picker input
        open('/tmp/pf2/b.pfbackup','w').write(await E("async()=>{const {blob}=await PFBackup.buildBackup({originals:false}); return blob.text()}"))
        await E("()=>{PFBackup.backupSheet()}"); await pg.wait_for_timeout(300)
        await pg.set_input_files('#restoreInput','/tmp/pf2/b.pfbackup'); await pg.wait_for_timeout(300)
        await E("()=>[...document.querySelectorAll('.sheet .actions button')].find(b=>b.textContent==='Restore').click()"); await pg.wait_for_timeout(1500)
        check('restore through the file picker', await E("()=>[...document.querySelectorAll('.toast')].some(t=>/Restored/.test(t.textContent))"))
        await E("()=>{while(window.pfHandleBack() && document.querySelector('.sheet-backdrop')){} }")
        # ---- about & licences ----
        await E("()=>{ if(!document.getElementById('home').classList.contains('hidden')) document.getElementById('homeContinue')?.click(); }"); await pg.wait_for_timeout(300)
        await E("async()=>{ (await import('./js/v2/home.js')).aboutSheet() }"); await pg.wait_for_timeout(500)
        ab=await E("()=>document.querySelectorAll('#licList .lic-row').length")
        check('About lists every bundled font with its licence', ab==fc['en']+fc['ml'], ab)
        await shot(pg, f'{SH}/25-about-licences.png')
        await E("()=>document.querySelector('#licList .lic-row').click()"); await pg.wait_for_timeout(500)
        check('licence text opens', await E("()=>/Font|License|LICENSE/.test(document.querySelector('.lic-text')?.textContent||'')"))
        await E("()=>{window.pfHandleBack(); window.pfHandleBack();}")
        # ---- back button & menu ----
        await E("()=>{PF.canvas.discardActiveObject(); PF.closePanel();}")
        r=await E("()=>{ const a=window.pfHandleBack(); return {a, home:PFv2.isHomeOpen()} }")
        check('Android back from the editor goes to Home', r['a'] and r['home'], r)
        r=await E("()=>window.pfHandleBack()")
        check('back on Home lets Android handle exit', r is False, r)
        await E("()=>document.getElementById('homeContinue')?.click()"); await pg.wait_for_timeout(400)
        await pg.click('#btnMenu'); await pg.wait_for_timeout(300); await shot(pg, f'{SH}/26-menu.png'); await E("()=>window.pfHandleBack()")
        # ---- layout across phone widths ----
        for w,h in [(360,780),(412,915),(480,1040)]:
            await pg.set_viewport_size({'width':w,'height':h}); await pg.wait_for_timeout(300)
            u=await E('''()=>{ const t=[...document.querySelectorAll('#toolbar .tool span')].filter(s=>s.offsetParent && s.scrollWidth>s.clientWidth+1).map(s=>s.textContent);
              const tb=document.getElementById('toolbar').getBoundingClientRect(); return {clipped:t, inside: tb.left>=0 && tb.right<=innerWidth} }''')
            check(f'[{w}px] floating toolbar fits, labels not clipped', not u['clipped'] and u['inside'], u)
        check('no network requests leave the app', not external, external[:5])
        errs=[e for e in errors if 'alphabetical' not in e and 'favicon' not in e]
        check('no JavaScript errors', not errs, errs[:6])
        await b.close()
    json.dump(results, open(f'/workspace/posterforge/test-results-v2{"-csp" if CSP else ""}-regression-2.3.0.json','w'), indent=1)
    print(f'\n{sum(r["ok"] for r in results)}/{len(results)} passed')
asyncio.run(main())
