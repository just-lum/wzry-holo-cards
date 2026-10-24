"""Browser checks for the local, static holographic-card collection.

Requires Python Playwright and its Chromium runtime. With no --url, this script
serves the repository on an unused localhost port and stops it on exit. Browser
profiles are temporary; screenshots and JSON evidence go to --output.
"""

from __future__ import annotations

import argparse
import asyncio
import http.server
import json
import pathlib
import tempfile
import threading
import time
import traceback
from urllib.parse import quote, unquote, urlsplit

from playwright.async_api import async_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBE = r"""(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet();
  const state = window.__holoSmoke = {
    contexts: 0, calls: 0, lost: 0, draws: 0, rafRequested: 0,
    rafExecuted: 0, resources: {}, uploads: []
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    state.rafRequested++;
    return raf(time => { state.rafExecuted++; callback(time); });
  };
  HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
    const gl = getContext.call(this, kind, ...args);
    if (!gl || !/^(webgl|webgl2|experimental-webgl)$/.test(kind)) return gl;
    state.calls++;
    if (seen.has(gl)) return gl;
    seen.add(gl); state.contexts++;
    this.addEventListener('webglcontextlost', () => state.lost++);
    for (const type of ['Texture', 'Shader', 'Program', 'Buffer', 'Framebuffer']) {
      const counts = state.resources[type] ||= {created: 0, deleted: 0};
      const create = gl['create' + type].bind(gl);
      const remove = gl['delete' + type].bind(gl);
      gl['create' + type] = (...a) => { counts.created++; return create(...a); };
      gl['delete' + type] = (...a) => {
        if (a[0]) counts.deleted++;
        return remove(...a);
      };
    }
    const draw = gl.drawArrays.bind(gl);
    gl.drawArrays = (...a) => { state.draws++; return draw(...a); };
    const framebufferStatus = gl.checkFramebufferStatus.bind(gl);
    gl.checkFramebufferStatus = (...a) => {
      if (window.__smokeFailFramebuffer > 0) {
        window.__smokeFailFramebuffer--;
        return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
      }
      return framebufferStatus(...a);
    };
    const upload = gl.texImage2D.bind(gl);
    gl.texImage2D = (...a) => {
      const image = a[a.length - 1];
      if (image && (image.currentSrc || image.src)) {
        state.uploads.push(image.currentSrc || image.src);
        if (state.uploads.length > 100) state.uploads.shift();
      }
      return upload(...a);
    };
    return gl;
  };
})();"""

GEOMETRY = """() => {
  const box = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {x:r.x, y:r.y, width:r.width, height:r.height,
            right:r.right, bottom:r.bottom};
  };
  const canvas = document.querySelector('#cv');
  return {width:innerWidth, height:innerHeight,
    documentWidth:document.documentElement.scrollWidth,
    card:box('#card'), stage:box('#stage'), controls:box('#controls'), collection:box('#list'),
    item:box('#grid .item:not([hidden])'),
    thumbnail:box('#grid .item:not([hidden]) img'),
    itemName:box('#grid .item:not([hidden]) b'),
    itemSubtitle:box('#grid .item:not([hidden]) span'),
    buffer:{width:canvas.width, height:canvas.height}};
}"""


def check(condition, message):
    if not condition:
        raise AssertionError(message)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


class SmokeSuite:
    def __init__(self, browser, url, output):
        self.browser = browser
        self.url = url.rstrip("/")
        self.output = output
        self.heroes = json.loads((ROOT / "heroes.json").read_text(encoding="utf-8"))
        self.results = []

    async def page(self, viewport=None, init=None, reduced_motion="reduce", device_scale_factor=1):
        context = await self.browser.new_context(
            viewport=viewport or {"width": 1440, "height": 1000},
            device_scale_factor=device_scale_factor,
            reduced_motion=reduced_motion,
        )
        page = await context.new_page()
        page.set_default_timeout(15000)
        await page.add_init_script(PROBE)
        if init:
            await page.add_init_script(init)
        errors, warnings = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: warnings.append({"type": msg.type, "text": msg.text})
                if msg.type in ("warning", "error") else None)
        page.smoke_errors = errors
        page.smoke_warnings = warnings
        self.pages.append(page)
        return page

    async def ready(self, page, key=None):
        await page.wait_for_function(
            "key => document.body.dataset.loadState === 'ready' && "
            "(!key || (document.body.dataset.hero === key && "
            "document.body.dataset.renderedHero === key))",
            arg=key,
        )

    async def goto(self, page, key=None, path="index.html", query=""):
        fragment = "#hero=" + quote(key, safe="") if key else ""
        await page.goto(f"{self.url}/{path}{query}{fragment}", wait_until="networkidle")
        await self.ready(page, key)

    def item(self, page, key):
        return page.locator(f'#grid .item[data-key="{key}"]')

    async def select(self, page, index):
        hero = self.heroes[index]
        await self.item(page, hero["key"]).click()
        await self.ready(page, hero["key"])

    async def verify_hero(self, page, index):
        hero = self.heroes[index]
        await self.ready(page, hero["key"])
        check(await page.locator("#tname").inner_text() == hero["name"], "wrong visible hero name")
        check(hero["name"] in await page.title(), "document title does not identify loaded hero")
        check(hero["edition"] in await page.locator("#tmeta").inner_text(), "original edition changed")
        check(await self.item(page, hero["key"]).get_attribute("aria-pressed") == "true", "selection is not announced")
        check(unquote(urlsplit(page.url).fragment) == "hero=" + hero["key"], "URL and hero disagree")

    async def initial_and_resources(self):
        page = await self.page(reduced_motion="no-preference")
        start = time.perf_counter()
        await self.goto(page)
        ready_ms = round((time.perf_counter() - start) * 1000)
        check(await page.locator("#grid .item").count() == len(self.heroes), "collection count is wrong")
        check(await page.locator("#grid .item:not(button)").count() == 0, "hero cards must be real buttons")
        check(str(len(self.heroes)) in await page.locator("#result-count").inner_text(), "total is missing")
        await self.verify_hero(page, 0)
        await page.evaluate("window.__smokeCanvas = document.querySelector('#cv')")
        switches = []
        for index in range(1, 11):
            start = time.perf_counter()
            await self.select(page, index)
            switches.append(round((time.perf_counter() - start) * 1000))
        check(await page.evaluate("window.__smokeCanvas === document.querySelector('#cv')"), "canvas was replaced")
        probe = await page.evaluate("window.__holoSmoke")
        check(probe["contexts"] == 1, f"switching created {probe['contexts']} WebGL contexts")
        for kind, counts in probe["resources"].items():
            check(counts["created"] - counts["deleted"] <= 24, f"unbounded live {kind}: {counts}")
        await page.wait_for_timeout(1200)
        before = await page.evaluate("({...window.__holoSmoke})")
        await page.wait_for_timeout(300)
        after = await page.evaluate("({...window.__holoSmoke})")
        check(after["rafRequested"] - before["rafRequested"] <= 1, "animation frames continue while idle")
        check(after["draws"] == before["draws"], "GPU draws continue while idle")
        return {"initial_ready_ms": ready_ms, "switch_ms": switches, "probe": probe,
                "idle_raf_delta": after["rafRequested"] - before["rafRequested"]}

    async def rapid_switch(self):
        page = await self.page()
        await self.goto(page)
        delayed, middle, final = self.heroes[1:4]

        async def delay_asset(route):
            if delayed["key"] in unquote(route.request.url):
                await asyncio.sleep(0.9)
            await route.continue_()

        await page.route("**/layers/**/character.webp*", delay_asset)
        await page.evaluate("""keys => keys.forEach(key => {
          const button = [...document.querySelectorAll('#grid .item')]
            .find(element => element.dataset.key === key);
          button.click();
        })""", [delayed["key"], middle["key"], final["key"]])
        await self.ready(page, final["key"])
        await page.wait_for_timeout(1200)
        await self.verify_hero(page, 3)
        probe = await page.evaluate("window.__holoSmoke")
        check(probe["contexts"] == 1, "race created extra contexts")
        characters = [unquote(url) for url in probe["uploads"] if "/character.webp" in url]
        if characters:
            check(final["key"] in characters[-1], "late request replaced the final character texture")
        return {"requested": [delayed["key"], middle["key"], final["key"]], "probe": probe}

    async def failure_retry(self):
        page = await self.page()
        await self.goto(page)
        failed_key = self.heroes[1]["key"]

        async def missing_asset(route):
            if failed_key in unquote(route.request.url):
                await route.fulfill(status=404, content_type="text/plain", body="missing test asset")
            else:
                await route.continue_()

        await page.route("**/layers/**/character.webp*", missing_asset)
        await self.item(page, failed_key).click()
        await page.wait_for_function("document.body.dataset.loadState === 'error'")
        check(await page.locator("#retry").is_visible(), "missing asset has no retry action")
        check(await page.locator("#preview").is_visible(), "missing asset has no image fallback")
        check(bool((await page.locator("#status").inner_text()).strip()), "error is not explained")
        await page.screenshot(path=str(self.output / "recovery-error.png"), full_page=True)
        await page.unroute("**/layers/**/character.webp*", missing_asset)
        await page.locator("#retry").click()
        await self.ready(page, failed_key)
        await self.verify_hero(page, 1)
        await self.select(page, 2)
        check(not await page.locator("#retry").is_visible(), "retry remains visible after recovery")

    async def favorites_and_search(self):
        page = await self.page()
        await self.goto(page)
        await page.locator("#favorite").click()
        check(await page.locator("#favorite").get_attribute("aria-pressed") == "true", "favorite was not set")
        await page.reload(wait_until="networkidle")
        await self.ready(page)
        check(await page.locator("#favorite").get_attribute("aria-pressed") == "true", "favorite did not survive reload")
        await page.locator("#favorites-only").click()
        check(await page.locator("#grid .item:visible").count() == 1, "favorites filter includes other heroes")
        await page.locator("#favorite").click()
        check(await page.locator("#grid .item:visible").count() == 0, "unfavorited hero remains in filtered list")
        await page.locator("#favorites-only").click()
        await page.locator("#search").fill(self.heroes[3]["name"])
        check(await page.locator("#grid .item:visible").count() == 1, "exact hero search is incorrect")
        await self.item(page, self.heroes[3]["key"]).click()
        await self.ready(page, self.heroes[3]["key"])
        await page.locator("#search").fill("no-such-hero-xyz")
        check(await page.locator("#grid .item:visible").count() == 0, "empty search state is incorrect")

    async def urls_history_share(self):
        page = await self.page(init="""Object.defineProperty(navigator, 'clipboard', {
          configurable:true, value:{writeText:async()=>{throw new Error('test clipboard denied')}}
        });""")
        await self.goto(page, self.heroes[5]["key"])
        await self.verify_hero(page, 5)
        await self.select(page, 1)
        await self.select(page, 2)
        await page.go_back()
        await self.verify_hero(page, 1)
        await page.go_forward()
        await self.verify_hero(page, 2)
        await page.locator("#share").click()
        await page.locator("#share-link").wait_for(state="visible")
        share = page.locator("#share-link")
        check(await share.get_attribute("readonly") is not None, "share fallback is editable")
        check(unquote(urlsplit(await share.input_value()).fragment) == "hero=" + self.heroes[2]["key"], "share link is stale")
        await page.goto(self.url + "/index.html#hero=does-not-exist", wait_until="networkidle")
        await self.verify_hero(page, 0)
        await self.goto(page, self.heroes[4]["key"], path="all.html", query="?smoke=redirect")
        check(urlsplit(page.url).path.endswith("/index.html"), "legacy page did not redirect")
        check(urlsplit(page.url).query == "smoke=redirect", "legacy redirect discarded the query")
        await self.verify_hero(page, 4)

    async def keyboard(self):
        page = await self.page()
        await self.goto(page)
        second = self.item(page, self.heroes[1]["key"])
        await second.focus()
        await page.keyboard.press("Enter")
        await self.verify_hero(page, 1)
        await page.locator("#next").focus()
        await page.keyboard.press("Enter")
        await self.verify_hero(page, 2)
        await page.locator("#prev").click()
        await self.verify_hero(page, 1)
        await page.locator("#card").focus()
        await page.keyboard.press("ArrowRight")
        await self.verify_hero(page, 2)
        search = page.locator("#search")
        await search.fill(self.heroes[2]["name"])
        await page.keyboard.press("ArrowLeft")
        await self.verify_hero(page, 2)
        await search.fill("")
        slider = page.locator("#depth")
        await slider.focus()
        old_value = float(await slider.input_value())
        await page.keyboard.press("ArrowRight")
        check(float(await slider.input_value()) > old_value, "range arrow key was intercepted")
        await self.verify_hero(page, 2)
        check(await page.locator("#status").get_attribute("role") == "status", "status lacks live-region semantics")
        check(await page.locator("#status").get_attribute("aria-live") in ("polite", "assertive"), "status is not announced")
        await self.select(page, 3)
        old_url = page.url
        await page.locator('.skip-link').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(100)
        check(await page.evaluate("document.activeElement === document.querySelector('#search')"),
              'skip link did not focus search')
        check(page.url == old_url and await page.locator('body').get_attribute('data-hero') == self.heroes[3]['key'],
              'skip link changed the selected hero or hero URL')

    async def layouts_and_quality(self):
        page = await self.page()
        await self.goto(page)
        layouts = []
        for width, height in [(1440, 1000), (1024, 800), (768, 1024), (320, 780), (390, 844), (844, 390), (568, 320)]:
            await page.set_viewport_size({"width": width, "height": height})
            await page.wait_for_timeout(180)
            geometry = await page.evaluate(GEOMETRY)
            await page.screenshot(path=str(self.output / f"after-{width}x{height}.png"), full_page=True)
            check(geometry["documentWidth"] <= width + 1, f"horizontal overflow at {width}px")
            item = geometry['item']
            content_height = sum(geometry[key]['height'] for key in ('thumbnail', 'itemName', 'itemSubtitle'))
            check(item['height'] + 1 >= content_height,
                  f"hero row clips its contents at {width}px: button={item['height']:.1f}, image and text={content_height:.1f}")
            check(geometry['itemName']['bottom'] <= item['bottom'] + 1
                  and geometry['itemSubtitle']['bottom'] <= item['bottom'] + 1,
                  f"hero labels extend outside their button at {width}px")
            card, controls = geometry["card"], geometry["controls"]
            check(card['height'] >= 40, f"card is squashed to {card['height']:.1f}px at {width}x{height}")
            check(controls["x"] >= -1 and controls["right"] <= width + 1,
                  f"controls extend beyond {width}px viewport")
            check(controls["y"] >= -1 and controls["bottom"] <= height + 1,
                  f"controls are outside {width}x{height} viewport")
            intersects = (card["right"] > controls["x"] + 2 and card["x"] < controls["right"] - 2
                          and card["bottom"] > controls["y"] + 2 and card["y"] < controls["bottom"] - 2)
            check(not intersects, f"card and controls overlap at {width}px")
            collection = geometry['collection']
            overlaps_collection = (collection['right'] > controls['x'] + 2 and collection['x'] < controls['right'] - 2
                                   and collection['bottom'] > controls['y'] + 2 and collection['y'] < controls['bottom'] - 2)
            check(not overlaps_collection, f"catalog and controls overlap at {width}x{height}")
            layouts.append(geometry)
        # Quality presets cap DPR; a DPR-1 display can correctly have equal sizes.
        page = await self.page(device_scale_factor=2)
        await self.goto(page)
        await page.locator("#quality").select_option("low")
        await page.wait_for_timeout(150)
        low = await page.evaluate("() => { const c=document.querySelector('#cv'); return {width:c.width,height:c.height}; }")
        await page.locator("#quality").select_option("high")
        await page.wait_for_function("old => document.querySelector('#cv').width > old", arg=low["width"])
        high = await page.evaluate("() => { const c=document.querySelector('#cv'); return {width:c.width,height:c.height}; }")
        return {"layouts": layouts, "quality_low": low, "quality_high": high}

    async def context_recovery(self):
        page = await self.page()
        await self.goto(page)
        supported = await page.evaluate("""() => {
          const gl = document.querySelector('#cv').getContext('webgl');
          window.__smokeLoss = gl.getExtension('WEBGL_lose_context');
          if (!window.__smokeLoss) return false;
          window.__smokeLoss.loseContext(); return true;
        }""")
        check(supported, "browser does not expose WEBGL_lose_context")
        await page.wait_for_function("window.__holoSmoke.lost > 0")
        await page.wait_for_function("document.body.dataset.loadState !== 'ready'")
        await page.wait_for_timeout(150)
        await page.evaluate("window.__smokeLoss.restoreContext()")
        await self.ready(page, self.heroes[0]["key"])
        await self.verify_hero(page, 0)
        await self.select(page, 1)
        probe = await page.evaluate("window.__holoSmoke")
        check(probe["contexts"] == 1, "restoration replaced the context")
        return {"probe": probe}

    async def blocked_storage(self):
        page = await self.page(init="""Object.defineProperty(window, 'localStorage', {
          configurable:true, get(){throw new DOMException('blocked in test', 'SecurityError')}
        });""")
        await self.goto(page)
        await page.locator("#favorite").click()
        check(await page.locator("#favorite").get_attribute("aria-pressed") == "true", "blocked storage breaks session favorites")
        await page.locator("#quality").select_option("low")
        await self.select(page, 1)
        await self.verify_hero(page, 1)

    async def corrupt_storage(self):
        page = await self.page(init="""if (!sessionStorage.getItem('smoke-corrupt-set')) {
          localStorage.setItem('wzry-holo-preferences-v1', '{broken-json');
          sessionStorage.setItem('smoke-corrupt-set', '1');
        }""")
        await self.goto(page)
        check(await page.locator('#quality').input_value() == 'auto', 'corrupt preferences did not use defaults')
        await page.locator('#favorite').click()
        await page.reload(wait_until='networkidle')
        await self.ready(page)
        check(await page.locator('#favorite').get_attribute('aria-pressed') == 'true',
              'preferences did not recover after corrupt JSON')

    async def unavailable_webgl(self):
        page = await self.page(init="""const smokeGetContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            return /^(webgl|webgl2|experimental-webgl)$/.test(kind)
              ? null : smokeGetContext.call(this, kind, ...args);
          };""")
        await page.goto(self.url + '/index.html', wait_until='networkidle')
        await page.wait_for_function("document.body.dataset.loadState === 'error'")
        check(await page.locator('#preview').is_visible(), 'WebGL failure hides the image fallback')
        await page.wait_for_function("document.querySelector('#preview').naturalWidth > 0")
        check(await page.locator('#grid .item').count() == len(self.heroes), 'WebGL failure breaks the collection')
        await self.item(page, self.heroes[1]['key']).click()
        await page.wait_for_function("key => document.body.dataset.hero === key && document.body.dataset.loadState === 'error'",
                                     arg=self.heroes[1]['key'])
        check(await page.locator('#tname').inner_text() == self.heroes[1]['name'], 'image fallback cannot switch hero')
        check(bool((await page.locator('#status').inner_text()).strip()), 'WebGL failure has no explanation')
        await page.screenshot(path=str(self.output / 'webgl-fallback.png'), full_page=True)

    async def framebuffer_failures(self):
        page = await self.page(init='window.__smokeFailFramebuffer = 1;', device_scale_factor=2)
        await page.goto(self.url + '/index.html', wait_until='networkidle')
        await page.wait_for_function("document.body.dataset.loadState === 'error'")
        check(await page.locator('#retry').is_visible(), 'initial allocation failure has no retry')
        check(await page.locator('#preview').is_visible(), 'initial allocation failure hides fallback')
        initial = await page.evaluate('window.__holoSmoke')
        problems = []
        live = {kind: value['created'] - value['deleted'] for kind, value in initial['resources'].items()}
        if any(live.values()):
            problems.append(f'initial allocation leaked live resources: {live}')
        await page.locator('#retry').click()
        await self.ready(page, self.heroes[0]['key'])
        await page.locator('#quality').select_option('low')
        await page.wait_for_timeout(100)
        before = await page.evaluate("({width:document.querySelector('#cv').width, hero:document.body.dataset.renderedHero})")
        await page.evaluate('window.__smokeFailFramebuffer = 1')
        await page.locator('#quality').select_option('high')
        await page.wait_for_timeout(150)
        after = await page.evaluate("({width:document.querySelector('#cv').width, hero:document.body.dataset.renderedHero, state:document.body.dataset.loadState})")
        if page.smoke_errors:
            problems.append(f'resize failure was uncaught: {page.smoke_errors}')
        if before['width'] != after['width'] or before['hero'] != after['hero'] or after['state'] != 'ready':
            problems.append(f'resize failure discarded the old card: before={before}, after={after}')
        if '失败' not in await page.locator('#status').inner_text():
            problems.append('resize failure did not explain the retained quality setting')
        await page.evaluate('window.__smokeFailFramebuffer = 0')
        await page.locator('#quality').select_option('low')
        await page.locator('#quality').select_option('high')
        await page.wait_for_function("width => document.querySelector('#cv').width > width", arg=before['width'])
        await self.verify_hero(page, 0)
        check(not problems, '; '.join(problems))
        return {'initial_live_resources': live, 'before_resize': before, 'after_failed_resize': after}

    async def network_deadlines(self):
        page = await self.page()
        await page.clock.install()
        catalog_gate = asyncio.Event()
        catalog_started = asyncio.Event()

        async def stalled_catalog(route):
            catalog_started.set()
            await catalog_gate.wait()
            try:
                await route.abort('timedout')
            except Exception:
                pass  # An AbortSignal may already have cancelled this request.

        await page.route('**/heroes.json', stalled_catalog)
        await page.goto(self.url + '/index.html', wait_until='domcontentloaded')
        await asyncio.wait_for(catalog_started.wait(), timeout=5)
        await page.clock.fast_forward(15050)
        await page.wait_for_function("document.body.dataset.loadState === 'error'", timeout=2500)
        check(await page.locator('#retry').is_visible(), 'stalled catalog has no recovery action')
        catalog_gate.set()
        await page.unroute('**/heroes.json', stalled_catalog)
        await page.locator('#retry').click()
        await self.ready(page)
        image_gate = asyncio.Event()
        image_started = asyncio.Event()
        key = self.heroes[1]['key']

        async def stalled_image(route):
            if key not in unquote(route.request.url):
                await route.continue_()
                return
            image_started.set()
            await image_gate.wait()
            try:
                await route.abort('timedout')
            except Exception:
                pass

        await page.route('**/layers/**/character.webp*', stalled_image)
        await self.item(page, key).click()
        await asyncio.wait_for(image_started.wait(), timeout=5)
        await page.clock.fast_forward(15050)
        await page.wait_for_function("document.body.dataset.loadState === 'error'", timeout=2500)
        check(await page.locator('#retry').is_visible(), 'stalled image has no recovery action')
        image_gate.set()
        await page.unroute('**/layers/**/character.webp*', stalled_image)
        await page.locator('#retry').click()
        await self.ready(page, key)
        await self.verify_hero(page, 1)

    async def run(self, only=None):
        cases = [self.initial_and_resources, self.rapid_switch, self.failure_retry,
                 self.favorites_and_search, self.urls_history_share, self.keyboard,
                 self.layouts_and_quality, self.context_recovery, self.blocked_storage,
                 self.corrupt_storage, self.unavailable_webgl,
                 self.framebuffer_failures, self.network_deadlines]
        if only:
            unknown = set(only) - {case.__name__ for case in cases}
            check(not unknown, f"unknown test cases: {sorted(unknown)}")
            cases = [case for case in cases if case.__name__ in only]
        for case in cases:
            self.pages = []
            start = time.perf_counter()
            result = {"case": case.__name__}
            try:
                result["evidence"] = await case()
                errors = [error for page in self.pages for error in page.smoke_errors]
                check(not errors, f"uncaught browser errors: {errors}")
                result["passed"] = True
            except Exception as error:
                result.update(passed=False, error=str(error), traceback=traceback.format_exc())
                if self.pages:
                    try:
                        await self.pages[-1].screenshot(path=str(self.output / (case.__name__ + "-failure.png")), full_page=True)
                    except Exception:
                        pass
            finally:
                result["console"] = [warning for page in self.pages for warning in page.smoke_warnings]
                result["elapsed_ms"] = round((time.perf_counter() - start) * 1000)
                self.results.append(result)
                print(("PASS " if result["passed"] else "FAIL ") + case.__name__ +
                      (": " + result["error"] if "error" in result else ""), flush=True)
                for page in self.pages:
                    await page.context.close()
        return all(result["passed"] for result in self.results)


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Existing HTTP site root; otherwise start an isolated local server")
    parser.add_argument("--output", type=pathlib.Path, help="Evidence directory (default: temporary folder)")
    parser.add_argument("--case", action='append', help="Run one named case; may be repeated")
    args = parser.parse_args()
    output = args.output or pathlib.Path(tempfile.mkdtemp(prefix="holo-smoke-"))
    output.mkdir(parents=True, exist_ok=True)
    server = None
    if not args.url:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
    url = args.url or f"http://127.0.0.1:{server.server_port}"
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            suite = SmokeSuite(browser, url, output)
            passed = await suite.run(args.case)
            report = {"url": url, "browser": browser.version,
                      "environment": "isolated headless Chromium, DPR 1; timings are local observations",
                      "passed": passed, "results": suite.results}
            (output / "browser-results.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            await browser.close()
        print(f"Evidence: {output}", flush=True)
        return 0 if passed else 1
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
