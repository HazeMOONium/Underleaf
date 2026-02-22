import { test, expect } from '@playwright/test'

// Generate unique email per test run to avoid conflicts
const timestamp = Date.now()
const testEmail = `e2e-auth-${timestamp}@test.com`
const testPassword = 'testpass123'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure clean state
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
  })

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Login to Underleaf')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible()
  })

  test('navigate to register page', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Register' }).click()
    await expect(page).toHaveURL(/\/register/)
    await expect(page.getByText('Create an Account')).toBeVisible()
  })

  test('register a new user', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Email').fill(testEmail)

    // There are two password fields - fill by index
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(testPassword)
    await passwordInputs.nth(1).fill(testPassword)

    await page.getByRole('button', { name: 'Register' }).click()

    // Should redirect to dashboard after successful registration
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })

  test('login with registered user', async ({ page }) => {
    // First register
    await page.goto('/register')
    const loginEmail = `e2e-login-${timestamp}@test.com`
    await page.getByLabel('Email').fill(loginEmail)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(testPassword)
    await passwordInputs.nth(1).fill(testPassword)
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Logout
    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(page).toHaveURL(/\/login/)

    // Now login
    await page.getByLabel('Email').fill(loginEmail)
    await page.getByLabel('Password').fill(testPassword)
    await page.getByRole('button', { name: 'Login' }).click()

    // Should redirect to dashboard
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nonexistent@test.com')
    await page.getByLabel('Password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Login' }).click()

    // Should show error toast
    await expect(page.getByText('Invalid credentials')).toBeVisible({ timeout: 5000 })
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout redirects to login', async ({ page }) => {
    // Register and login first
    const logoutEmail = `e2e-logout-${timestamp}@test.com`
    await page.goto('/register')
    await page.getByLabel('Email').fill(logoutEmail)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(testPassword)
    await passwordInputs.nth(1).fill(testPassword)
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Now logout
    await page.getByRole('button', { name: 'Logout' }).click()

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })

  test('unauthenticated user redirected to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })
})
