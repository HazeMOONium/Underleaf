const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleErrors = [];
  const networkErrors = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    consoleErrors.push(`Page Error: ${err.message}`);
  });
  
  page.on('requestfailed', request => {
    networkErrors.push(`Failed: ${request.url()} - ${request.failure()?.errorText}`);
  });

  console.log('=== 1. LOGIN PAGE ===');
  console.log('Navigating to http://localhost:3000...');
  const response = await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`Response status: ${response?.status()}`);
  
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: '/home/hazemoonium/Underleaf/screenshots/login-page.png', fullPage: true });
  console.log('Screenshot saved to screenshots/login-page.png');
  
  const loginForm = await page.$('form');
  console.log(`Login form found: ${!!loginForm}`);

  console.log('\n=== 2. LOGIN ATTEMPT ===');
  const emailInput = await page.$('input[type="email"]');
  const passwordInput = await page.$('input[type="password"]');
  console.log(`Email input: ${!!emailInput}, Password input: ${!!passwordInput}`);
  
  if (emailInput && passwordInput) {
    await emailInput.fill('demo@test.com');
    await passwordInput.fill('demo123');
    
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    }
  }
  
  await page.waitForTimeout(3000);
  
  await page.screenshot({ path: '/home/hazemoonium/Underleaf/screenshots/after-login.png', fullPage: true });
  console.log('Screenshot saved to screenshots/after-login.png');

  const currentUrl = page.url();
  console.log(`Current URL after login: ${currentUrl}`);

  console.log('\n=== 3. CREATE PROJECT ===');
  try {
    await page.waitForTimeout(1000);
    const newProjectBtn = await page.$('button:has-text("New Project"), a:has-text("New Project")');
    if (newProjectBtn) {
      await newProjectBtn.click();
      await page.waitForTimeout(1000);
      
      const titleInput = await page.$('input[name="title"]');
      if (titleInput) {
        await titleInput.fill('Test Project');
      }
      
      const createBtn = await page.$('button:has-text("Create")');
      if (createBtn) {
        await createBtn.click();
      }
      await page.waitForTimeout(2000);
    }
    
    await page.screenshot({ path: '/home/hazemoonium/Underleaf/screenshots/editor.png', fullPage: true });
    console.log('Screenshot saved to screenshots/editor.png');
  } catch (e) {
    console.log(`Error creating project: ${e.message}`);
  }

  console.log('\n=== ERRORS ===');
  console.log('Console Errors:', consoleErrors.length === 0 ? 'None' : consoleErrors);
  console.log('Network Errors:', networkErrors.length === 0 ? 'None' : networkErrors);
  
  await browser.close();
  console.log('\n=== TEST COMPLETE ===');
})();
