import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://aifoc.us/', { waitUntil: 'networkidle2' });

  // Get the contents of main.js
  const scriptContent = await page.evaluate(async () => {
    const script = document.querySelector('script[src*="main."]');
    if (!script) return 'No main.js script found';
    try {
      const resp = await fetch(script.src);
      return await resp.text();
    } catch (e) {
      return 'Error fetching: ' + e.message;
    }
  });

  console.log('Script content (first 1000 chars):');
  console.log(scriptContent.slice(0, 1000));
  console.log('Script content total length:', scriptContent.length);

  await browser.close();
}

run().catch(console.error);
