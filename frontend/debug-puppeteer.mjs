import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();

const consoleMessages = [];
const consoleErrors = [];

page.on('console', msg => {
  const text = msg.text();
  consoleMessages.push(`[${msg.type()}] ${text}`);
  if (msg.type() === 'error') {
    consoleErrors.push(text);
  }
});

page.on('pageerror', err => {
  consoleErrors.push(`Page Error: ${err.message}`);
});

try {
  console.log('Navigating to http://localhost:3000...');
  const response = await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log(`Response status: ${response?.status()}`);
  
  // Wait for React to render
  await page.waitForTimeout(2000);
  
  // Take screenshot
  await page.screenshot({ path: '/home/hazemoonium/Underleaf/debug-screenshot.png' });
  console.log('Screenshot saved to debug-screenshot.png');
  
  // Get page title
  const title = await page.title();
  console.log(`Page title: ${title}`);
  
  // Check what's in the root div
  const rootContent = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.innerHTML : 'No #root element found';
  });
  console.log(`\n#root content length: ${rootContent.length}`);
  console.log(`#root content preview: ${rootContent.substring(0, 500)}`);
  
  console.log('\n=== CONSOLE ERRORS ===');
  if (consoleErrors.length === 0) {
    console.log('No console errors');
  } else {
    consoleErrors.forEach(e => console.log(e));
  }
  
} catch (err) {
  console.error('Error:', err);
} finally {
  await browser.close();
}
