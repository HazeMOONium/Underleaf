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
    // The login page shows the brand name "Underleaf" and tagline
    await expect(page.getByText('Underleaf')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    // Use the input element specifically (not the show/hide button)
    await expect(page.locator('input#login-password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    // Register link text is "Create one"
    await expect(page.getByRole('link', { name: 'Create one' })).toBeVisible()
  })

  test('navigate to register page', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Create one' }).click()
    await expect(page).toHaveURL(/\/register/)
    await expect(page.getByText('Create your account')).toBeVisible()
  })

  test('register a new user', async ({ page }) => {
    await page.goto('/register')
    await page.locator('input#register-email').fill(testEmail)

    // Fill password inputs by specific IDs
    await page.locator('input#register-password').fill(testPassword)
    await page.locator('input#register-confirm-password').fill(testPassword)

    await page.getByRole('button', { name: 'Create account' }).click()

    // Should redirect to dashboard after successful registration
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })

  test('login with registered user', async ({ page }) => {
    // First register
    await page.goto('/register')
    const loginEmail = `e2e-login-${timestamp}@test.com`
    await page.locator('input#register-email').fill(loginEmail)
    await page.locator('input#register-password').fill(testPassword)
    await page.locator('input#register-confirm-password').fill(testPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Logout — dashboard button text is "Sign out"
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    // Now login
    await page.locator('input#login-email').fill(loginEmail)
    await page.locator('input#login-password').fill(testPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should redirect to dashboard
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input#login-email').fill('nonexistent@test.com')
    await page.locator('input#login-password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should show error toast
    await expect(page.getByText('Invalid credentials')).toBeVisible({ timeout: 5000 })
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout redirects to login', async ({ page }) => {
    // Register and login first
    const logoutEmail = `e2e-logout-${timestamp}@test.com`
    await page.goto('/register')
    await page.locator('input#register-email').fill(logoutEmail)
    await page.locator('input#register-password').fill(testPassword)
    await page.locator('input#register-confirm-password').fill(testPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Now logout — dashboard button text is "Sign out"
    await page.getByRole('button', { name: 'Sign out' }).click()

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })

  test('unauthenticated user redirected to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
  })
})
