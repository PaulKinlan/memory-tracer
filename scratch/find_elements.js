import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://aifoc.us/', { waitUntil: 'networkidle2' });

  // Let's print all buttons, links, forms, inputs
  const elements = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('a, button, input, form').forEach(el => {
      list.push({
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        text: el.innerText || el.value || '',
        href: el.href || null,
        type: el.type || null
      });
    });
    return list;
  });

  console.log('Interactive Elements found:');
  console.log(JSON.stringify(elements, null, 2));

  await browser.close();
}

run().catch(console.error);
