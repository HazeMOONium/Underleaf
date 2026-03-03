import { test, expect, Page } from '@playwright/test'

const timestamp = Date.now()
const testEmail = `e2e-projects-${timestamp}@test.com`
const testPassword = 'testpass123'

async function registerAndLogin(page: Page, email: string = testEmail) {
  await page.goto('/register')
  await page.locator('input#register-email').fill(email)
  await page.locator('input#register-password').fill(testPassword)
  await page.locator('input#register-confirm-password').fill(testPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/', { timeout: 10000 })
}

test.describe('Project Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
  })

  test('dashboard shows empty state for new user', async ({ page }) => {
    const email = `e2e-empty-${timestamp}@test.com`
    await registerAndLogin(page, email)
    await expect(page.getByText('My Projects')).toBeVisible()
    await expect(page.getByText('No projects yet')).toBeVisible()
    // The header "New Project" button (not the "+ Create project" empty-state button)
    await expect(page.getByRole('button', { name: /New Project/ }).first()).toBeVisible()
  })

  test('create a new project', async ({ page }) => {
    const email = `e2e-create-${timestamp}@test.com`
    await registerAndLogin(page, email)

    // Click new project button in the header
    await page.getByRole('button', { name: /New Project/ }).first().click()

    // Modal should appear — heading is "New Project"
    await expect(page.getByRole('heading', { name: 'New Project' })).toBeVisible()

    // Fill project title and submit
    // Placeholder is "My LaTeX Document"; submit button is "Create project" (exact, in modal)
    await page.getByPlaceholder('My LaTeX Document').fill('My Test Project')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()

    // Should redirect to editor page
    await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })

    // Editor page should show the project title
    await expect(page.locator('h2').first()).toContainText('My Test Project')
  })

  test('project appears in dashboard list', async ({ page }) => {
    const email = `e2e-list-${timestamp}@test.com`
    await registerAndLogin(page, email)

    // Create a project
    await page.getByRole('button', { name: /New Project/ }).first().click()
    await page.getByPlaceholder('My LaTeX Document').fill('Listed Project')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })

    // Navigate back to dashboard — the header link to "/" shows "Underleaf" logo text
    await page.getByRole('link', { name: /Underleaf/ }).first().click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Project should appear in the list
    await expect(page.getByText('Listed Project')).toBeVisible()
  })

  test('cancel create project modal', async ({ page }) => {
    const email = `e2e-cancel-${timestamp}@test.com`
    await registerAndLogin(page, email)

    await page.getByRole('button', { name: /New Project/ }).first().click()
    await expect(page.getByRole('heading', { name: 'New Project' })).toBeVisible()

    // Click cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Modal heading should disappear
    await expect(page.getByRole('heading', { name: 'New Project' })).not.toBeVisible()
    // Should still be on dashboard
    await expect(page).toHaveURL('/')
  })

  test('navigate to project from dashboard', async ({ page }) => {
    const email = `e2e-navigate-${timestamp}@test.com`
    await registerAndLogin(page, email)

    // Create project
    await page.getByRole('button', { name: /New Project/ }).first().click()
    await page.getByPlaceholder('My LaTeX Document').fill('Navigate Project')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })

    // Go back to dashboard
    await page.getByRole('link', { name: /Underleaf/ }).first().click()
    await expect(page).toHaveURL('/', { timeout: 10000 })

    // Click the project card
    await page.getByText('Navigate Project').click()
    await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })
    await expect(page.locator('h2').first()).toContainText('Navigate Project')
  })
})
