# PosterForge 2.1.0 feature suite. Usage: python3 e2e_v21.py [--csp]
import asyncio, json, sys, os, base64, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
CSP='--csp' in sys.argv
URL='http://127.0.0.1:8241/index.html'
SH='/workspace/posterforge/screenshots-2.1.0/'+('suite-csp' if CSP else 'suite')
os.makedirs(SH, exist_ok=True); os.makedirs('/tmp/pf21', exist_ok=True)
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
def photo(path, w, h):
    im=Image.new('RGB',(w,h),(30,60,120)); d=ImageDraw.Draw(im)
    d.rectangle([0,0,w,h//3],fill=(245,240,230)); d.ellipse([w*0.3,h*0.3,w*0.7,h*0.7],fill=(250,190,40)); im.save(path,quality=92); return path
def stripes(path,w,h):
    im=Image.new('RGB',(w,h),(0,0,0)); d=ImageDraw.Draw(im)
    for x in range(0,w,24): d.rectangle([x,0,x+11,h],fill=(255,255,255))
    im.save(path); return path

async def main():
    p1=photo('/tmp/pf21/photo.jpg',1200,900); p2=stripes('/tmp/pf21/stripes.png',600,600)
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
        check('boot: 2.1 ready', await wait(pg,'!!(window.PF21&&PF.v2Ready)'))
        await pg.wait_for_timeout(500)
        # ---------- home ----------
        st=await E("()=>({qs:!!document.getElementById('homeQuick'), bk:!!document.getElementById('brandToggle'), more:!!document.getElementById('homeMoreSizes')})")
        check('home: quote quick-start, brand kit toggle and All sizes are present', all(st.values()), st)
        await wait(pg,"document.querySelectorAll('#tplGrid .tpl-card.ready').length>=4", 30000)
        await shot(pg, f'{SH}/01-home.png')
        # ---------- fonts ----------
        fc=await E('''async()=>{ const t=await import('./js/tools.js'); const C=t.FONT_CATALOG.filter(f=>f.bundled);
          const need=['Roboto','Roboto Condensed','Fredoka','Comic Neue','Space Mono']; const miss=need.filter(n=>!t.fontEntry(n));
          const urls=[...new Set(C.flatMap(f=>f.faces.map(x=>x.url)))].concat([...new Set(C.map(f=>f.licenseFile))]); const bad=[];
          for(const u of urls){ const r=await fetch(u,{method:'HEAD'}); if(!r.ok) bad.push(u); }
          return {en:C.filter(f=>!f.ml).length, ml:C.filter(f=>f.ml).length, miss, bad, m900i:t.hasFace('Montserrat',900,true), lic:[...new Set(C.map(f=>f.license))]} }''')
        check('fonts: 107 English + 36 Malayalam families bundled', fc['en']==107 and fc['ml']==36, fc)
        check('fonts: new story fonts (Roboto, Roboto Condensed, Fredoka, Comic Neue, Space Mono) + Montserrat Black Italic', not fc['miss'] and fc['m900i'], fc)
        check('fonts: every face + licence file is in the APK assets', not fc['bad'], fc['bad'][:4])
        check('fonts: only OFL / Apache / GPL+font-exception licences', set(fc['lic'])<={'OFL-1.1','Apache-2.0','GPL-3.0-or-later WITH Font-exception'}, fc['lic'])
        ss=await E('''async()=>{ const t=await import('./js/tools.js'); return PF21.STORY_STYLES.map(s=>({n:s.name,f:s.fontFamily,ok:!!t.fontEntry(s.fontFamily) && t.hasFace(s.fontFamily,s.fontWeight,s.fontStyle==='italic')})) }''')
        names=[s['n'] for s in ss]
        check('story styles: 13 Instagram names, each mapped to a bundled real face', names==['Classic','Modern','Strong','Typewriter','Editor','Meme','Elegant','Signature','Directional','Poster','Bubble','Deco','Squeeze'] and all(s['ok'] for s in ss), ss)
        exp={'Classic':'Inter','Modern':'Roboto Condensed','Strong':'Montserrat','Typewriter':'Courier Prime','Meme':'Comic Neue','Elegant':'Playfair Display','Signature':'Dancing Script','Directional':'Archivo Black','Poster':'Alfa Slab One','Bubble':'Fredoka','Deco':'Poiret One','Squeeze':'Bebas Neue'}
        check('story styles: lookalike fonts as requested', all(next(s['f'] for s in ss if s['n']==k)==v for k,v in exp.items()), ss)
        # ---------- open template, select text ----------
        await E("()=>document.querySelector('[data-template=\"hook-sea-post\"]').click()"); await pg.wait_for_timeout(1500)
        await E("()=>{const t=PF.canvas.getObjects().find(o=>o.type==='text'); PF.canvas.setActiveObject(t); PF.canvas.fire('selection:created',{selected:[t]}); PF.canvas.requestRenderAll();}"); await pg.wait_for_timeout(400)
        check('quick bar appears when text is selected', await E("()=>!document.getElementById('textQuickbar').classList.contains('hidden')"))
        await pg.click('#qbAa'); await pg.wait_for_timeout(500)
        st=await E('''async()=>{ const row=document.getElementById('storyStyles'); const chips=[...row.querySelectorAll('.story-chip')];
          await document.fonts.ready; const fams=chips.map(c=>getComputedStyle(c).fontFamily.replace(/"/g,''));
          const loaded=PF21.STORY_STYLES.map(s=>document.fonts.check(`${s.fontStyle==='italic'?'italic ':''}${s.fontWeight} 17px "${s.fontFamily}"`,s.name));
          return {vis:!row.classList.contains('hidden'), n:chips.length, fams, loaded} }''')
        check('Aa opens the Story Styles row: 13 chips, each previewed in its own font', st['vis'] and st['n']==13 and st['fams']==[s['f'] for s in ss], st)
        await pg.wait_for_timeout(800)
        st2=await E("()=>PF21.STORY_STYLES.map(s=>document.fonts.check(`${s.fontStyle==='italic'?'italic ':''}${s.fontWeight} 17px \"${s.fontFamily}\"`,s.name))")
        check('story chip fonts are loaded (not fallback)', all(st2), st2)
        await shot(pg, f'{SH}/02-story-styles-row.png')
        fill0=await E("()=>PF.active().fill")
        await pg.click('[data-style="Strong"]'); await pg.wait_for_timeout(600)
        st=await E("()=>{const o=PF.active(); return {f:o.fontFamily,w:o.fontWeight,s:o.fontStyle,fill:o.fill,story:o.pfStory, on:document.querySelector('[data-style=\"Strong\"]').classList.contains('on')}}")
        check('tapping Strong applies Montserrat Black Italic and keeps the colour', st['f']=='Montserrat' and st['w']==900 and st['s']=='italic' and st['fill']==fill0 and st['on'], st)
        await shot(pg, f'{SH}/03-story-style-strong.png')
        widths=await E('''async()=>{ const o=PF.active(); const out={}; for(const s of PF21.STORY_STYLES){ await PF21.applyStoryStyle(o,s); out[s.name]=Math.round(o.width);} return out }''')
        check('all 13 styles apply and change the text metrics', len(set(widths.values()))>=10, widths)
        await E("async()=>{ await PF21.applyStoryStyle(PF.active(), PF21.STORY_STYLES[6]); }")
        await pg.wait_for_timeout(300); await shot(pg, f'{SH}/04-story-style-elegant.png')
        u=await E("async()=>{ const o=PF.active(); const before=o.fontFamily; await PF21.applyStoryStyle(o, PF21.STORY_STYLES[11]); await PF.history.undo(); await new Promise(r=>setTimeout(r,200)); const t=PF.canvas.getObjects().find(x=>x.type==='text'); return [before,t.fontFamily] }")
        check('undo restores the previous story style', u[0]==u[1], u)
        ml=await E('''async()=>{ const t=PF.makeText('സ്നേഹം',{fontFamily:'Manjari'}); PF.canvas.add(t); await PF21.applyStoryStyle(t, PF21.STORY_STYLES[0]); const f=t.fontFamily; PF.canvas.remove(t); return f }''')
        check('Malayalam text keeps a Malayalam font when a Latin story style is tapped', ml=='Manjari', ml)
        # quick bar buttons
        await E("()=>{const t=PF.canvas.getObjects().find(o=>o.type==='text'); PF.canvas.setActiveObject(t); PF.canvas.fire('selection:created',{selected:[t]});}"); await pg.wait_for_timeout(200)
        sw=[]
        for i in range(3):
            await pg.click('#qbOutline'); await pg.wait_for_timeout(120); sw.append(await E("()=>[PF.active().pfOutline, Math.round(PF.active().strokeWidth||0)]"))
        check('outline button cycles thin → thick → off', sw[0][0]==1 and sw[1][0]==2 and sw[2][0]==0 and sw[1][1]>sw[0][1]>0 and sw[2][1]==0, sw)
        al=[]
        for i in range(3):
            await pg.click('#qbAlign'); await pg.wait_for_timeout(80); al.append(await E("()=>PF.active().textAlign"))
        check('alignment button cycles left → right → centre', al==['left','right','center'], al)
        bx=[]
        for i in range(3):
            await pg.click('#qbBox'); await pg.wait_for_timeout(120); bx.append(await E("()=>({m:PF.active().pfBox||'none', bg:PF.active().textBackgroundColor, fill:PF.active().fill})"))
            if i==0: await shot(pg, f'{SH}/05-text-box-solid.png')
        check('background box cycles solid → semi → none and restores the text colour', bx[0]['m']=='solid' and bx[0]['bg']==fill0 and bx[0]['fill']!=fill0 and bx[1]['m']=='semi' and 'rgba' in bx[1]['bg'] and bx[2]['m']=='none' and not bx[2]['bg'] and bx[2]['fill']==fill0, bx)
        an=[]
        for i in range(4):
            await pg.click('#qbAnim'); await pg.wait_for_timeout(1300); an.append(await E("()=>PF.active().pfAnim"))
        js=await E("()=>JSON.parse(PF.serialize()).canvas.objects.find(o=>o.type==='text').pfAnim")
        txt=await E("()=>PF.active().text")
        check('animation button cycles fade/typewriter/slide/off, previews and restores the text', an==['fade','typewriter','slide','none'] and js=='none' and 'love' in txt, [an,txt])
        await pg.click('#qbAnim'); await pg.wait_for_timeout(900)
        check('animation choice is saved in the project JSON', await E("()=>JSON.parse(PF.serialize()).canvas.objects.find(o=>o.type==='text').pfAnim==='fade'"))
        await shot(pg, f'{SH}/06-quickbar.png')
        # ---------- custom path ----------
        await pg.click('#qbFx'); await pg.wait_for_timeout(400)
        check('Effects pane has the Draw path chip', await E("()=>!!document.getElementById('tyPathBtn')"))
        await shot(pg, f'{SH}/07-effects-draw-path-chip.png')
        await pg.click('#tyPathBtn'); await pg.wait_for_timeout(400)
        r=await E("()=>{const c=document.getElementById('pathDraw').getBoundingClientRect(); return [c.left,c.top,c.width,c.height]}")
        x0,y0,w,h=r
        await pg.mouse.move(x0+w*0.15,y0+h*0.6); await pg.mouse.down()
        import math
        for i in range(1,41):
            t=i/40; await pg.mouse.move(x0+w*(0.15+0.7*t), y0+h*(0.6-0.25*math.sin(math.pi*t)))
        await pg.mouse.up(); await pg.wait_for_timeout(500)
        st=await E("()=>{const o=PF.active(); return {w:o.pfWarp, n:(o.pfPath||[]).length, ang:o.angle, ww:Math.round(o.width), hh:Math.round(o.height), flat:o._pfFlat}}")
        check('drawing a path puts the text on it (40-point normalised path)', st['w']=='path' and st['n']==40 and st['hh']>st['flat']['h']*1.2, st)
        pix=await E('''()=>{ const o=PF.active(); const r=o.getBoundingRect(); const c=PF.canvas.lowerCanvasEl.getContext('2d'); const d=c.getImageData(0,0,PF.canvas.lowerCanvasEl.width,PF.canvas.lowerCanvasEl.height).data; return d.length>0 }''')
        await pg.wait_for_timeout(200); await shot(pg, f'{SH}/08-text-on-custom-path.png')
        st=await E("async()=>{ const s=PF.serialize(); await PF.history.mute(()=>PF.restore(s)); const o=PF.canvas.getObjects().find(x=>x.pfWarp==='path'); return o?{n:o.pfPath.length,w:Math.round(o.width)}:null }")
        check('text on a path survives save / restore', st and st['n']==40, st)
        sv=await E('''async()=>{ const o=PF.canvas.getObjects().find(x=>x.pfWarp==='path'); const svg=o.toSVG(); const sc=await PF.renderStatic(1); const ok=sc.lowerCanvasEl.width===1080; sc.dispose(); return svg.includes('<image') && ok }''')
        check('path text exports (raster in SVG, renders in the export canvas)', sv)
        # shadow colour / direction (audit fix)
        sh=await E('''()=>{ const o=PF.canvas.getObjects().find(x=>x.type==='text'); PF.canvas.setActiveObject(o); PF.openPane('shadow');
          const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input'));}; set('shadowColor','#ff0000'); set('shadowOpacity','50'); set('shadowAngle','0'); set('shadowOffset','20');
          return {c:o.shadow.color, x:o.shadow.offsetX, y:o.shadow.offsetY} }''')
        check('shadow pane: colour, strength and direction (2.0 gap fixed)', sh['c']=='rgba(255,0,0,0.5)' and sh['x']==20 and sh['y']==0, sh)
        await pg.wait_for_timeout(300); await shot(pg, f'{SH}/09-shadow-colour.png')
        await E("()=>PF.closePanel()")
        # ---------- canvas sizes ----------
        await E("()=>{ PF.canvas.discardActiveObject(); PF21.openSizes(); }"); await pg.wait_for_timeout(600)
        st=await E('''()=>{ const hs=[...document.querySelectorAll('#sizeGroups .sz-h')].map(h=>h.textContent); const cards=[...document.querySelectorAll('#sizeGroups .sz-card')];
          const shapes=cards.map(c=>{const s=c.querySelector('.sz-shape'); return [c.dataset.size, s.offsetWidth/s.offsetHeight]}); return {hs, n:cards.length, shapes} }''')
        check('size picker: 6 platform groups with shape previews', st['hs']==['Instagram','Threads & Facebook','YouTube','WhatsApp','Print (300 dpi)','Ratios'] and st['n']>=26, st['hs'])
        sz=await E("()=>Object.fromEntries(PF21.ALL_SIZES.map(s=>[s.id,[s.w,s.h]]))")
        want={'ig-portrait':[1080,1350],'ig-square':[1080,1080],'ig-land':[1080,566],'ig-story':[1080,1920],'ig-reel':[1080,1920],'ig-cover':[1080,1920],'ig-profile':[320,320],'fb-cover':[820,312],'yt-thumb':[1280,720],'yt-banner':[2560,1440],'pr-a4':[2480,3508],'pr-a3':[3508,4961],'pr-a5':[1748,2480],'r-21-9':[2520,1080],'r-3-4':[1080,1440]}
        check('size catalogue has the exact pixel sizes', all(sz.get(k)==v for k,v in want.items()), {k:sz.get(k) for k in want})
        shp={k:v for k,v in st['shapes']}
        check('shape previews match each aspect ratio', abs(shp['yt-thumb']-16/9)<0.12 and abs(shp['ig-story']-9/16)<0.06 and abs(shp['fb-cover']-820/312)<0.25, {k:shp[k] for k in ['yt-thumb','ig-story','fb-cover']})
        await shot(pg, f'{SH}/10-canvas-sizes.png')
        await E("()=>document.querySelector('#sizeGroups [data-size=\"ig-story\"]').click()"); await pg.wait_for_timeout(1200)
        st=await E("()=>({W:PF.state.W,H:PF.state.H,z:PF.state.safeZone})")
        check('picking Story sets 1080×1920 and turns on the safe zone', st=={'W':1080,'H':1920,'z':'story'}, st)
        await pg.wait_for_timeout(300); await shot(pg, f'{SH}/11-story-safe-zone.png')
        g=await E('''async()=>{ PF.canvas.discardActiveObject(); PF.canvas.renderAll(); const v=PF.canvas.viewportTransform; const c=PF.canvas.lowerCanvasEl; const k=c.width/PF.canvas.getWidth();
          const px=(x,y)=>{const d=c.getContext('2d').getImageData(Math.round((v[4]+x*v[0])*k),Math.round((v[5]+y*v[3])*k),1,1).data; return [d[0],d[1],d[2]]};
          const top=px(540,100), mid=px(540,960); const sc=await PF.renderStatic(1); const e=sc.lowerCanvasEl.getContext('2d').getImageData(540,100,1,1).data; sc.dispose();
          PF21.setSafeZone(null); PF.canvas.renderAll(); const top2=px(540,100); return {top,mid,top2,exp:[e[0],e[1],e[2]]} }''')
        check('safe zone tints the covered area on screen but never in exports', g['top'][0]-g['top2'][0]>15 and abs(g['exp'][0]-g['top2'][0])<6, g)
        await E("()=>PF21.setSafeZone('reel')"); await pg.wait_for_timeout(200); await shot(pg, f'{SH}/12-reel-safe-zone.png'); await E("()=>PF21.setSafeZone(null)")
        cv=await E("()=>[PF21.toPx(210,'mm',300),PF21.toPx(297,'mm',300),PF21.toPx(8.5,'in',300),PF21.toPx(500,'px')]")
        check('custom size converts mm / in to px at the chosen DPI', cv==[2480,3508,2550,500], cv)
        await E("()=>{PF21.openSizes();}"); await pg.wait_for_timeout(500)
        await E("()=>{ document.querySelector('#szUnit [data-unit=\"mm\"]').click(); }")
        u=await E("()=>[document.getElementById('szW').value, document.getElementById('szH').value, document.getElementById('szPx').textContent]")
        check('unit switch converts the custom fields (1080×1920 px → mm)', abs(float(u[0])-91.4)<0.2 and '1080 × 1920' in u[2], u)
        await E("()=>{ const w=document.getElementById('szW'), h=document.getElementById('szH'); w.value='100'; h.value='150'; w.dispatchEvent(new Event('input')); document.querySelector('.sheet [data-value=\"savePreset\"]').click(); }"); await pg.wait_for_timeout(400)
        await E("()=>{ const i=document.querySelector('.sheet input[type=text]'); i.value='Postcard'; document.querySelectorAll('.sheet .actions button')[1].click(); }"); await pg.wait_for_timeout(600)
        st=await E("()=>({saved:PF21.savedSizes(), my:!!document.querySelector('#sizeGroups [data-size=\"my-0\"]'), h:document.querySelector('#sizeGroups .sz-h')?.textContent})")
        check('custom size saved as a preset under My sizes', st['saved'][0]=={'label':'Postcard','w':1181,'h':1772} and st['my'] and st['h']=='My sizes', st)
        await shot(pg, f'{SH}/13-my-sizes.png')
        await E("()=>document.querySelector('.sheet [data-value=\"null\"]')?.click()"); await pg.wait_for_timeout(300)
        # panorama
        await E("()=>{PF21.openSizes();}"); await pg.wait_for_timeout(400)
        await E("()=>document.querySelector('#sizeGroups [data-size=\"ig-pano\"]').click()"); await pg.wait_for_timeout(400)
        await E("()=>document.querySelector('.sheet [data-value=\"3\"]').click()"); await pg.wait_for_timeout(1500)
        st=await E("()=>({W:PF.state.W,H:PF.state.H,n:PF21.panoramaCount()})")
        check('carousel panorama: 3 slides = 3240×1350 artboard', st=={'W':3240,'H':1350,'n':3}, st)
        await pg.wait_for_timeout(300); await shot(pg, f'{SH}/14-panorama-guides.png')
        pr=await E('''async()=>{ const before=Object.keys(window.__pfFiles).length; const r=await PF21.exportPanorama(); const fs=Object.values(window.__pfFiles).slice(before);
          const dims=[]; for(const f of fs){ const bm=await createImageBitmap(await (await fetch('data:image/jpeg;base64,'+f.b64.join(''))).blob()); dims.push([bm.width,bm.height,f.name]); } return {n:r.length, dims} }''')
        check('panorama export cuts 3 seamless 1080×1350 slides', pr['n']==3 and all(d[0]==1080 and d[1]==1350 for d in pr['dims']) and pr['dims'][2][2].endswith('3-of-3.jpg'), pr)
        # ---------- subject lift ----------
        await E('''async()=>{ await PF.setArtboard(1080,1350,false); PF.canvas.clear(); PF.canvas.setBackgroundColor('#101010'); }''')
        await pg.set_input_files('#imageUploadInput', p1); await pg.wait_for_timeout(2000)
        info=await E("()=>{const o=PF.canvas.getObjects().find(x=>x.type==='image'); PF.canvas.discardActiveObject(); PF.canvas.requestRenderAll(); const c=o.getCenterPoint(); const v=PF.canvas.viewportTransform; const r=PF.canvas.upperCanvasEl.getBoundingClientRect(); return {x:r.left+v[4]+c.x*v[0], y:r.top+v[5]+c.y*v[3], n:PF.canvas.getObjects().length}}")
        await E("()=>PF.closePanel()"); await pg.wait_for_timeout(300)
        await pg.mouse.move(info['x'],info['y']); await pg.mouse.down(); await pg.wait_for_timeout(750); await pg.mouse.up()
        ok=await wait(pg,"PF.canvas.getObjects().some(o=>o.pfRole==='subject')",8000)
        await pg.wait_for_timeout(1200)
        st=await E('''()=>{ const objs=PF.canvas.getObjects(); const src=objs.find(o=>o.type==='image'&&o.pfRole!=='subject'); const s=objs.find(o=>o.pfRole==='subject');
          const a=src.getCenterPoint(), b=s.getCenterPoint(); return {idx:[objs.indexOf(src),objs.indexOf(s)], d:Math.hypot(a.x-b.x,a.y-b.y), w:s.getScaledWidth()/src.getScaledWidth(), menu:document.querySelector('.sheet h2')?.textContent, shadow:!!s.shadow} }''')
        check('long-press a photo lifts the subject into a new layer just above it', ok and st['idx'][1]==st['idx'][0]+1, st)
        check('lifted layer sits exactly over the subject in the photo', st['d']<2 and abs(st['w']-0.4)<0.01, st)
        check('lift menu opens after the glow animation (glow removed)', st['menu']=='Subject lifted' and not st['shadow'], st)
        await shot(pg, f'{SH}/15-subject-lift-menu.png')
        items=await E("()=>[...document.querySelectorAll('.sheet .menu-list button, .sheet button')].map(b=>b.textContent.trim()).filter(Boolean)")
        check('lift menu: Copy, Paste as layer, Save transparent PNG, Share, Sticker outline, Refine', all(any(k in i for i in items) for k in ['Copy','Paste as layer','Save transparent PNG','Share','Sticker outline','Refine edges']), items)
        await E("()=>[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.includes('Copy')).click()"); await wait(pg,"!!window.__pfClipboard",8000)
        cp=await E("()=>({act:window.__pfClipboard&&window.__pfClipboard.action, mime:window.__pfClipboard&&window.__pfClipboard.mime})")
        check('Copy sends the PNG to the system clipboard (bridge action "copy")', cp=={'act':'copy','mime':'image/png'}, cp)
        n0=await E("()=>PF.canvas.getObjects().length")
        await E("()=>PF21.pasteImage()"); await pg.wait_for_timeout(1200)
        st=await E("()=>{const o=PF.canvas.getObjects().at(-1); return {n:PF.canvas.getObjects().length, name:o.name, w:o.getElement().naturalWidth}}")
        check('Paste as layer adds the clipboard image as a new layer', st['n']==n0+1 and st['name']=='Pasted image' and st['w']==480, st)
        await E("()=>{ const s=PF.canvas.getObjects().find(o=>o.pfRole==='subject'); PF.canvas.setActiveObject(s); }")
        sv=await E('''async()=>{ const before=Object.keys(window.__pfFiles).length; const s=PF.canvas.getObjects().find(o=>o.pfRole==='subject'); await PF21.saveImage(s,'save'); await PF21.saveImage(s,'share');
          const fs=Object.values(window.__pfFiles).slice(before); const bm=await createImageBitmap(await (await fetch('data:image/png;base64,'+fs[0].b64.join(''))).blob());
          const c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height; const x=c.getContext('2d'); x.drawImage(bm,0,0); const corner=x.getImageData(1,1,1,1).data[3], mid=x.getImageData(bm.width/2,bm.height/2,1,1).data[3];
          return {acts:fs.map(f=>f.action), mime:fs[0].mime, corner, mid} }''')
        check('Save transparent PNG (gallery) and Share: PNG with real transparency', sv['acts']==['save','share'] and sv['mime']=='image/png' and sv['corner']==0 and sv['mid']==255, sv)
        stk=await E('''async()=>{ const s=PF.canvas.getObjects().find(o=>o.pfRole==='subject'); const w0=s.getScaledWidth(), c0=s.getCenterPoint(); await PF21.stickerOutline(s); await new Promise(r=>setTimeout(r,300));
          const c=document.createElement('canvas'); const e=s.getElement(); c.width=e.naturalWidth; c.height=e.naturalHeight; const x=c.getContext('2d'); x.drawImage(e,0,0);
          const edge=x.getImageData(Math.round(c.width*0.5), 3, 1, 12).data; let white=0; for(let i=0;i<edge.length;i+=4) if(edge[i]>240&&edge[i+1]>240&&edge[i+3]>200) white++;
          const c1=s.getCenterPoint(); return {grew:s.getScaledWidth()/w0, white, moved:Math.hypot(c1.x-c0.x,c1.y-c0.y), flag:s.pfSticker} }''')
        check('Sticker outline adds a white die-cut border and keeps the position', stk['grew']>1.02 and stk['white']>0 and stk['moved']<1 and stk['flag'], stk)
        await pg.wait_for_timeout(200); await shot(pg, f'{SH}/16-sticker-outline.png')
        # refine brush on a fresh lift
        await E("async()=>{ PF.canvas.getObjects().filter(o=>o.pfRole==='subject'||o.name==='Pasted image').forEach(o=>PF.canvas.remove(o)); const src=PF.canvas.getObjects().find(o=>o.type==='image'); window.__pfLiftP = PF21.liftSubject(src); }")
        await wait(pg,"document.querySelector('.sheet h2')?.textContent==='Subject lifted'",8000)
        await E("()=>[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.includes('Refine')).click()"); await pg.wait_for_timeout(500)
        alpha_js="()=>{const c=document.getElementById('refineCanvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>128) n++; return n}"
        a0=await E(alpha_js)
        rr=await E("()=>{const r=document.getElementById('refineCanvas').getBoundingClientRect(); return [r.left,r.top,r.width,r.height]}")
        await pg.mouse.move(rr[0]+rr[2]*0.2, rr[1]+rr[3]*0.5); await pg.mouse.down(); await pg.mouse.move(rr[0]+rr[2]*0.8, rr[1]+rr[3]*0.5, steps=12); await pg.mouse.up()
        a1=await E(alpha_js)
        await shot(pg, f'{SH}/17-refine-edges.png')
        await E("()=>document.querySelector('#refineMode [data-mode=\"restore\"]').click()")
        await pg.mouse.move(rr[0]+rr[2]*0.02, rr[1]+rr[3]*0.05); await pg.mouse.down(); await pg.mouse.move(rr[0]+rr[2]*0.98, rr[1]+rr[3]*0.05, steps=12); await pg.mouse.up()
        a2=await E(alpha_js)
        check('refine brush: Erase removes pixels, Restore paints the original photo back', a1<a0*0.99 and a2>a1, [a0,a1,a2])
        await E("()=>document.querySelector('.sheet [data-value=\"true\"]').click()"); await pg.wait_for_timeout(600)
        msgs={}
        for mode in ['no_play_services','model_downloading','none']:
            await E(f"()=>{{ window.__pfSubject.mode='{mode}'; window.__pfSubject.playServices={'false' if mode=='no_play_services' else 'true'}; document.querySelectorAll('.toast').forEach(t=>t.remove()); }}")
            await E("async()=>{ const src=PF.canvas.getObjects().find(o=>o.type==='image'); await PF21.liftSubject(src); }"); await pg.wait_for_timeout(300)
            msgs[mode]=await E("()=>[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')")
        check('graceful messages: no Play services / model downloading / no subject', 'Google Play services' in msgs['no_play_services'] and 'downloading' in msgs['model_downloading'] and 'No clear subject' in msgs['none'], msgs)
        await shot(pg, f'{SH}/18-lift-no-subject-message.png')
        await E("()=>{ window.__pfSubject.mode='ellipse'; window.__pfSubject.playServices=true; }")
        rot=await E('''async()=>{ const src=PF.canvas.getObjects().find(o=>o.type==='image'&&o.pfRole!=='subject'); src.set({angle:30, scaleX:src.scaleX*0.7, scaleY:src.scaleY*0.7, flipX:true}); src.setCoords();
          const o=await PF21.liftSubject(src); document.querySelectorAll('.sheet-backdrop').forEach(b=>b.remove()); const a=src.getCenterPoint(), b=o.getCenterPoint(); return {d:Math.hypot(a.x-b.x,a.y-b.y), ang:o.angle, flip:o.flipX} }''')
        check('lift lines up on a rotated, scaled, flipped photo', rot['d']<2 and rot['ang']==30 and rot['flip'], rot)
        # ---------- smart colours ----------
        await E("()=>{ PF.canvas.getObjects().filter(o=>o.pfRole==='subject').forEach(o=>PF.canvas.remove(o)); }")
        await E("()=>document.querySelector('[data-template]')")
        c=await E('''()=>{ const C=PF21.color; return {bw:+C.contrast('#ffffff','#000000').toFixed(2), g:+C.contrast('#767676','#ffffff').toFixed(2), y:+C.contrast('#FFD60A','#0B0B0B').toFixed(2),
          h:Object.fromEntries(['complementary','analogous','monochrome','accent'].map(m=>[m,C.harmony('#0B4F6C',m)]))} }''')
        check('WCAG contrast maths (21:1, #767676 on white 4.54:1)', c['bw']==21 and abs(c['g']-4.54)<0.02 and c['y']>12, c)
        check('harmony modes give valid colours (complementary/analogous/monochrome/accent)', all(len(v)>=5 and all(len(x)==7 and x[0]=='#' for x in v) for v in c['h'].values()), c['h'])
        await E("async()=>{ const t=PF.makeText('Quiet\\nmorning',{fontSize:120,fill:'#ffffff'}); PF.canvas.add(t); t.set({left:540,top:330}); t.setCoords(); const a=PF.makeText('— someone',{fontSize:40}); PF.canvas.add(a); a.set({left:540,top:520}); PF.canvas.setActiveObject(t); PF.canvas.requestRenderAll(); }")
        await E("()=>{PF21.openSmartColours();}"); await pg.wait_for_timeout(700)
        st=await E('''()=>{ const ph=document.querySelectorAll('#scPhoto .sc-sw').length; const sug=[...document.querySelectorAll('#scSuggest .sc-sw')].map(b=>parseFloat(b.querySelector('small').textContent));
          return {ph, sug, note:document.getElementById('scHiddenNote').textContent, pal:[...document.querySelectorAll('#scPalettes [data-pal]')].map(b=>b.dataset.pal)} }''')
        check('smart colours: photo palette (k-means) shown', 4<=st['ph']<=6, st)
        check('smart colours: only readable suggestions (≥3:1 vs the area under the text), failures hidden', len(st['sug'])>0 and min(st['sug'])>=3 and 'hidden' in st['note'], st)
        check('preset quote palettes: Cinematic, Film, Sea, Sunset, Minimal, Gold', st['pal']==['Cinematic','Film','Sea','Sunset','Minimal','Gold'], st['pal'])
        await shot(pg, f'{SH}/19-smart-colours.png')
        await E("()=>document.querySelector('#scModes [data-mode=\"monochrome\"]').click()"); await pg.wait_for_timeout(200)
        await E("()=>document.querySelector('#scHiddenNote .link')?.click()"); await pg.wait_for_timeout(200)
        st=await E("()=>({fails:document.querySelectorAll('#scSuggest .sc-sw.fail').length, mode:document.querySelector('#scModes .on').dataset.mode})")
        check('show hidden colours reveals the failing ones (dashed), harmony switch works', st['fails']>0 and st['mode']=='monochrome', st)
        await E("()=>document.querySelector('#scSuggest .sc-sw:not(.fail)').click()"); await pg.wait_for_timeout(200)
        f=await E("()=>[PF.active().fill, document.querySelector('#scSuggest .sc-sw:not(.fail)')?.dataset.hex]")
        check('tapping a suggestion colours the text', f[0].lower()==f[1].lower(), f)
        await E("()=>document.querySelector('#scPalettes [data-pal=\"Cinematic\"]').click()"); await pg.wait_for_timeout(200)
        f=await E("()=>{const t=PF.canvas.getObjects().filter(o=>o.type==='text'); return t.map(o=>[o.text.slice(0,6),o.fill])}")
        check('one-tap pair: Cinematic = #FFD60A main + second colour on the author line', ['Quiet\n','#FFD60A'] in f and ['— some','#F5F5F5'] in f, f)
        await shot(pg, f'{SH}/20-cinematic-pair.png')
        await E("()=>document.getElementById('scSave').click()"); await pg.wait_for_timeout(300)
        await E("()=>{ const i=document.querySelectorAll('.sheet input[type=text]'); i[i.length-1].value='Night gold'; const s=[...document.querySelectorAll('.sheet')].at(-1); s.querySelectorAll('.actions button')[1].click(); }"); await pg.wait_for_timeout(400)
        st=await E("()=>({p:PF21.savedPalettes()[0], mine:!!document.querySelector('#scMine [data-pal=\"Night gold\"]'), kit:PF21.getKit().colours})")
        check('save palette: appears in My palettes and in the brand kit colours', st['p']['name']=='Night gold' and st['p']['main']=='#FFD60A' and st['mine'] and '#FFD60A' in st['kit'], st)
        await E("()=>document.querySelector('.sheet [data-value=\"true\"]').click()"); await pg.wait_for_timeout(300)
        # ---------- auto contrast ----------
        ac=await E('''async()=>{ const im0=PF.canvas.getObjects().find(o=>o.type==='image'); im0.set({angle:0,flipX:false,flipY:false}); im0.scale(Math.max(PF.canvas.width/PF.canvas.getZoom()/im0.width, PF.canvas.height/PF.canvas.getZoom()/im0.height)); const Z=PF.canvas.getZoom(); im0.set({originX:'center',originY:'center',left:PF.canvas.width/Z/2,top:PF.canvas.height/Z/2}); im0.setCoords(); PF.canvas.sendToBack(im0);
          const t=PF.canvas.getObjects().find(o=>o.type==='text'); PF.canvas.bringToFront(t); t.set({fill:'#ffffff',left:540,top:200}); t.setCoords(); PF.canvas.setActiveObject(t);
          const r1=PF21.setAutoContrast(t,true); const f1=t.fill;
          t.set({top:1240}); t.setCoords(); PF.canvas.fire('object:modified',{target:t}); await new Promise(r=>setTimeout(r,400)); const f2=t.fill, fx2=t.pfAutoFx;
          return {r1, f1, f2, fx2} }''')
        check('auto contrast: dark text on the bright sky, light text on the dark sea (re-checks after moving)', ac['f1']=='#111111' and ac['f2']=='#ffffff', ac)
        await shot(pg, f'{SH}/21-auto-contrast.png')
        await pg.set_input_files('#imageUploadInput', p2); await pg.wait_for_timeout(1800)
        bz=await E('''()=>{ const im=PF.canvas.getObjects().filter(o=>o.type==='image').at(-1); im.set({left:540,top:800,scaleX:1.6,scaleY:1.6}); im.setCoords(); const t=PF.canvas.getObjects().find(o=>o.type==='text'); PF.canvas.bringToFront(t);
          t.set({top:800}); t.setCoords(); const r=PF21.autoContrast(t); const bg=t.textBackgroundColor; const off=PF21.setAutoContrast(t,false); return {fx:r.fx, busy:r.busy, bg, after:t.textBackgroundColor, flag:t.pfAutoContrast} }''')
        check('auto contrast on a busy photo adds a scrim; turning it off removes it', bz['fx']=='scrim' and 'rgba' in bz['bg'] and not bz['after'] and bz['flag']==False, bz)
        await shot(pg, f'{SH}/22-auto-contrast-scrim.png')
        # ---------- quote quick-start ----------
        wq=await E("()=>PF21.wrapQuote('the quiet moments are where we grow',13)")
        check('quote wrap', wq=='the quiet\nmoments are\nwhere we grow', wq)
        ft=await E('''async()=>{ const m=await import('./js/v2/templates.js'); const out=[]; for(const t of m.TEMPLATES){ const b=PF21.fillTemplate(t,'Stay soft, it looks beautiful on you','Anon');
            const tx=b.pages[0].objects.filter(o=>o.type==='text'); out.push({id:t.id, pages:b.pages.length, has:tx.some(o=>o.text.replace(/\\n/g,' ').toLowerCase().includes('looks beautiful')), author:tx.some(o=>o.pfRole==='author'), counter:tx.some(o=>o.pfRole==='counter')}); }
          const ml=m.TEMPLATES.map(t=>PF21.fillTemplate(t,'സ്നേഹം എല്ലാം മാറ്റും')).map(b=>b.pages[0].objects.filter(o=>o.type==='text').sort((a,c)=>c.fontSize-a.fontSize)[0].fontFamily);
          const tools=await import('./js/tools.js'); return {n:out.length, bad:out.filter(o=>!o.has||!o.author||o.counter||o.pages!==1).map(o=>o.id), mlBad:ml.filter(f=>!tools.fontEntry(f).ml)} }''')
        check('quick-start fills the quote + author into all 26 templates', ft['n']==26 and not ft['bad'], ft)
        check('a Malayalam quote switches every template to a Malayalam font', not ft['mlBad'], ft['mlBad'])
        await E("()=>{ PF21.quoteQuickStart(); }"); await pg.wait_for_timeout(400)
        await shot(pg, f'{SH}/23-quick-start-input.png')
        await E("()=>{ document.getElementById('qsQuote').value='Stay soft, it looks beautiful on you'; document.getElementById('qsAuthor').value='Anon'; document.querySelector('.sheet [data-value=\"[object Object]\"], .sheet .btn-accent').click(); }")
        await wait(pg,"document.querySelectorAll('#quickStart .qs-card.ready').length>=1", 20000)
        await pg.wait_for_timeout(800)
        st=await E("()=>({n:document.querySelectorAll('#quickStart .qs-card').length, c:document.getElementById('qsCount').textContent})")
        check('quick-start gallery: 26 swipeable previews', st['n']==26 and st['c']=='1 / 26', st)
        await shot(pg, f'{SH}/24-quick-start-gallery.png')
        await E("()=>{ const t=document.getElementById('qsTrack'); t.scrollLeft=t.querySelectorAll('.qs-card')[9].offsetLeft-t.clientWidth*0.09; t.dispatchEvent(new Event('scroll')); }")
        await wait(pg,"document.querySelectorAll('#quickStart .qs-card')[9].classList.contains('ready')",20000); await pg.wait_for_timeout(500)
        st=await E("()=>document.getElementById('qsCount').textContent")
        check('swiping updates the counter and renders previews lazily', st.startswith('10 /') or st.startswith('9 /') or st.startswith('11 /'), st)
        await shot(pg, f'{SH}/25-quick-start-swiped.png')
        await E("()=>document.querySelectorAll('#quickStart .qs-card')[9].querySelector('.qs-use').click()"); await pg.wait_for_timeout(600)
        await E("()=>{ const b=[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='Replace'); b&&b.click(); }"); await pg.wait_for_timeout(1800)
        st=await E("()=>({ov:!!document.getElementById('quickStart'), t:PF.canvas.getObjects().filter(o=>o.type==='text').map(o=>o.text)})")
        check('Use this opens the chosen design in the editor with the quote', not st['ov'] and any('beautiful' in t.lower() for t in st['t']) and any('Anon' in t for t in st['t']), st)
        await shot(pg, f'{SH}/26-quick-start-opened.png')
        # ---------- brand kit ----------
        logo=await E('''async()=>{ const c=document.createElement('canvas'); c.width=200; c.height=100; const x=c.getContext('2d'); x.fillStyle='#e11d48'; x.fillRect(0,0,200,100); x.fillStyle='#fff'; x.font='bold 60px sans-serif'; x.fillText('HQ',40,75);
          const m=await import('./js/v21/brand.js'); await m.setLogo(c.toDataURL('image/png')); PF21.setKit({...PF21.getKit(), colours:['#D4AF37','#F7E7B4'], headFont:'Bebas Neue', bodyFont:'Inter', mlFont:'Manjari', logoPos:'bottom-right'}); return true }''')
        await E("()=>{PF21.openBrandKit();}"); await pg.wait_for_timeout(600)
        st=await E("()=>({cols:[...document.querySelectorAll('#bkColours [data-hex]')].map(b=>b.dataset.hex), fonts:[...document.querySelectorAll('#brandKit [data-font]')].map(b=>b.textContent), logo:!!document.querySelector('.bk-logo-img')})")
        check('brand kit sheet: colours, heading/body/Malayalam fonts, logo', st['cols'][:2]==['#D4AF37','#F7E7B4'] and st['fonts']==['Bebas Neue','Inter','Manjari'] and st['logo'], st)
        await shot(pg, f'{SH}/27-brand-kit.png')
        await E("()=>[...document.querySelectorAll('.sheet button')].find(b=>b.textContent==='Apply to this design').click()"); await pg.wait_for_timeout(1500)
        st=await E('''()=>{ const t=PF.canvas.getObjects().filter(o=>o.type==='text').sort((a,b)=>b.fontSize-a.fontSize); const lg=PF.canvas.getObjects().find(o=>o.pfRole==='logo');
          const r=lg&&lg.getBoundingRect(true,true); return {main:[t[0].fontFamily,t[0].fill], other:t.slice(1).map(o=>[o.fontFamily,o.fill]), logo:!!lg, br: r? [Math.round(r.left+r.width), Math.round(r.top+r.height)]:null, W:PF.state.W,H:PF.state.H} }''')
        check('one tap applies the kit: heading font + colour, body font + colour, logo bottom-right', st['main']==['Bebas Neue','#D4AF37'] and all(o==['Inter','#F7E7B4'] for o in st['other']) and st['logo'] and st['W']-st['br'][0]<80 and st['H']-st['br'][1]<80, st)
        await shot(pg, f'{SH}/28-brand-kit-applied.png')
        await E("()=>{ localStorage.setItem('pf.brandOnTemplates','1'); PFv2.showHome(); }"); await pg.wait_for_timeout(500)
        await E("()=>document.querySelector('[data-template=\"cine-night-post\"]').click()"); await pg.wait_for_timeout(600)
        await E("()=>{ const b=[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='Replace'); b&&b.click(); }"); await pg.wait_for_timeout(1800)
        st=await E("()=>({main:PF.canvas.getObjects().filter(o=>o.type==='text').sort((a,b)=>b.fontSize-a.fontSize)[0].fill, logo:PF.canvas.getObjects().some(o=>o.pfRole==='logo')})")
        check('brand kit toggle: templates open already branded', st=={'main':'#D4AF37','logo':True}, st)
        await shot(pg, f'{SH}/29-template-with-brand.png')
        localStorage_off=await E("()=>localStorage.setItem('pf.brandOnTemplates','0')")
        # ---------- menu + regressions ----------
        await E("()=>document.getElementById('btnMenu').click()"); await pg.wait_for_timeout(400)
        items=await E("()=>[...document.querySelectorAll('.sheet .menu-list button')].map(b=>b.textContent)")
        check('menu has the 2.1 entries', all(any(k in i for i in items) for k in ['Quote quick-start','Smart text colours','Brand kit','Paste image','safe zone','Canvas size']), items)
        await shot(pg, f'{SH}/30-menu.png')
        await E("()=>document.querySelector('.sheet-backdrop').click()")
        check('paused AI tool is untouched (AI tab still there)', await E("()=>!!document.querySelector('[data-tool=\"ai\"]')"))
        check('no handle of the private account anywhere in the UI', await E("()=>!/sandeep_njr/i.test(document.documentElement.outerHTML)"))
        check('fully offline: no outside requests', not external, external[:3])
        errs=[e for e in errors if 'favicon' not in e]
        check('no page errors', not errs, errs[:5])
        await b.close()
    json.dump(results, open(f'/workspace/posterforge/test-results-v21{"-csp" if CSP else ""}-2.1.0.json','w'), indent=1)
    print(f'\n{sum(r["ok"] for r in results)}/{len(results)} passed')
asyncio.run(main())
