import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':412,'height':915},device_scale_factor=2,is_mobile=True,has_touch=True)
        await ctx.add_init_script(path='mock_native.js')
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto('http://127.0.0.1:8241/index.html#nohome')
        for i in range(200):
            if await pg.evaluate('!!(window.PF21&&PF.v2Ready)'): break
            await pg.wait_for_timeout(50)
        print('ready', await pg.evaluate('!!window.PF21'), errs)
        await b.close()
asyncio.run(main())
