const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<html lang="th"><body><main class="main"><div class="content" id="content"></div></main></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, "public/css/app.css"), "utf8") });
    for (const file of ["ui.js", "pages.js"]) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, "public/js", file), "utf8") });
    }
    await page.evaluate(() => {
      window.State = { user: { id: 1, fullName: "Reporter A", role: "USER" } };
      window.qs = (params) => "?" + new URLSearchParams(params);
      window.posts = [];
      window.messages = [];
      window.navigate = () => {};
      toast = (message) => window.messages.push(message);
      submitBtn = async (_id, action) => action();
      window.assets = [
        { id: 11, assetTag: "PC-A", hostname: "Computer A", ownerId: 1, owner: { id: 1, fullName: "Reporter A" } },
        { id: 22, assetTag: "PC-B", hostname: "Computer B", ownerId: 2, owner: { id: 2, fullName: "Owner B" } },
        { id: 33, assetTag: "PC-C", hostname: "Computer C", ownerId: null, owner: null },
      ];
      window.api = {
        get: async (url) => {
          if (url === "/meta") return { categories: [{ id: 1, name: "Hardware" }], catalogItems: [], departments: [], assetTypes: [] };
          const query = new URLSearchParams(url.split("?")[1]);
          if (query.get("id")) {
            const asset = window.assets.find((item) => item.id === Number(query.get("id")));
            if (!asset) throw new Error("Asset not found");
            return { items: [asset], total: 1 };
          }
          if (query.get("ownerId") === "me") return { items: window.assets.filter((item) => item.ownerId === 1), total: 1 };
          const search = query.get("q");
          if (search === "slow") await new Promise((resolve) => setTimeout(resolve, 700));
          const items = search === "slow" ? [window.assets[1]] : search === "fast" ? [window.assets[2]] : window.assets;
          return { items, total: items.length };
        },
        post: async (url, body) => { window.posts.push({ url, body }); return { id: 99 }; },
      };
      window.renderTicket = async (params = {}) => {
        const result = await Pages["ticket-new"](params);
        document.getElementById("content").innerHTML = result.html;
        result.after();
      };
    });
    const render = async (params = {}) => {
      await page.evaluate((params) => window.renderTicket(params), params);
      await page.waitForFunction(() => document.querySelector('#t-asset option[value="11"]'));
      await page.locator("#t-subject").fill("Repair test");
      await page.locator("#t-description").fill("Test description");
      await page.locator("#t-category").selectOption("1");
    };
    const mode = (value) => page.locator(`input[name="ticket-asset-mode"][value="${value}"]`).check({ force: true });
    const sent = () => page.evaluate(() => window.posts.at(-1)?.body);

    await render();
    assert.equal(await page.locator("#t-asset").inputValue(), "");
    await page.locator("#t-submit").click();
    assert.equal(await page.evaluate(() => window.posts.length), 0);
    await page.locator("#t-asset").selectOption("11");
    await page.locator("#t-submit").click();
    assert.equal((await sent()).assetId, 11);

    await mode("other");
    await page.locator("#t-submit").click();
    assert.equal(await page.evaluate(() => window.posts.length), 1);
    await page.locator("#t-other-asset").fill("PC");
    await page.waitForFunction(() => document.querySelector('#t-other-asset-select option[value="22"]'));
    assert.equal(await page.locator('#t-other-asset-select option[value="11"]').count(), 0);
    assert.equal(await page.locator("#t-other-asset-select").inputValue(), "");
    await page.locator("#t-other-asset-select").selectOption("22");
    assert.equal(await page.locator("#t-asset-owner").innerText(), "Owner B");
    await page.locator("#t-submit").click();
    assert.equal((await sent()).assetId, 22);
    await mode("none");
    await page.locator("#t-submit").click();
    assert.equal(Object.hasOwn(await sent(), "assetId"), false);
    await mode("mine");
    await page.locator("#t-submit").click();
    assert.equal((await sent()).assetId, 11);
    console.log("PASS explicit selection, own/other/none payloads, owner preview, mode switching");

    await render({ assetId: 22 });
    assert.equal(await page.locator('input[value="other"]').isChecked(), true);
    assert.equal(await page.locator("#t-other-asset-select").inputValue(), "22");
    await page.locator("#t-submit").click();
    assert.equal((await sent()).assetId, 22);
    await render({ assetId: 11 });
    assert.equal(await page.locator("#t-asset").inputValue(), "11");
    await render({ assetId: 33 });
    assert.equal(await page.locator("#t-other-asset-select").inputValue(), "33");
    console.log("PASS asset-detail preselection for owned, other, and unassigned assets");

    await page.locator("#t-other-asset").fill("slow");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#t-other-asset-select").inputValue(), "");
    await page.locator("#t-other-asset").fill("fast");
    await page.waitForFunction(() => document.querySelector('#t-other-asset-select option[value="33"]'));
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#t-other-asset-select option[value="22"]').count(), 0);
    await page.locator("#t-other-asset-select").selectOption("33");
    console.log("PASS edited search clears old selection; stale search response ignored");

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      const fits = await page.locator(".ticket-asset-fieldset, .ticket-asset-summary, #t-other-asset-wrap").evaluateAll((els) => els.every((el) => {
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1;
      }));
      assert.ok(fits, `asset controls fit ${width}px`);
      await page.locator(".ticket-asset-fieldset").screenshot({ path: path.join(root, `ticket-asset-modes-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log("PASS desktop/mobile layout; no browser errors; no live data written");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
