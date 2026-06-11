import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  
  await page.goto('https://paul.kinlan.me/', { waitUntil: 'networkidle2' });
  
  const result = await page.evaluate(() => {
    const interactives = Array.from(document.querySelectorAll('button, a, [onclick], [role="button"]')).map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id,
      className: el.className,
      text: el.textContent.trim().substring(0, 30),
      href: el.getAttribute('href')
    }));
    
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.getAttribute('action'),
      id: f.id,
      className: f.className,
      inputs: Array.from(f.querySelectorAll('input, button')).map(i => i.outerHTML.substring(0, 100))
    }));

    return {
      interactives,
      forms
    };
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
