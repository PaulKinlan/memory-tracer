import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://aifoc.us/', { waitUntil: 'networkidle2' });

  const pageDetails = await page.evaluate(() => {
    return {
      scripts: Array.from(document.querySelectorAll('script')).map(s => ({
        src: s.src,
        textContent: s.textContent.slice(0, 100)
      })),
      frameworks: {
        next: !!window.__NEXT_DATA__,
        nuxt: !!window.__NUXT__,
        react: !!(window.React || document.querySelector('[data-reactroot]')),
        vue: !!window.Vue,
        angular: !!window.angular,
        svelte: !!window.__svelte
      }
    };
  });

  console.log('Page details:', JSON.stringify(pageDetails, null, 2));
  await browser.close();
}

run().catch(console.error);
