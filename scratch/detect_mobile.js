import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  
  await page.goto('https://aifoc.us/', { waitUntil: 'networkidle2' });

  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (
          el.tagName === 'A' || 
          el.tagName === 'BUTTON' || 
          el.onclick || 
          el.className.includes('menu') || 
          el.className.includes('nav') || 
          el.className.includes('toggle')
        );
      })
      .map(el => ({
        tagName: el.tagName,
        className: el.className,
        text: el.innerText ? el.innerText.trim().slice(0, 50) : '',
        id: el.id
      }));
  });

  console.log('Mobile elements:', JSON.stringify(elements.slice(0, 50), null, 2));

  await browser.close();
}

run().catch(console.error);
