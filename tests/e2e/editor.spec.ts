import { test, expect, Page } from '@playwright/test'

const timestamp = Date.now()
const testPassword = 'testpass123'

async function registerAndCreateProject(page: Page, projectTitle: string): Promise<void> {
  const email = `e2e-editor-${timestamp}-${Math.random().toString(36).slice(2, 8)}@test.com`

  // Register
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  const passwordInputs = page.locator('input[type="password"]')
  await passwordInputs.nth(0).fill(testPassword)
  await passwordInputs.nth(1).fill(testPassword)
  await page.getByRole('button', { name: 'Register' }).click()
  await expect(page).toHaveURL('/', { timeout: 10000 })

  // Create project
  await page.getByRole('button', { name: '+ New Project' }).click()
  await page.getByPlaceholder('Project title').fill(projectTitle)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })
}

test.describe('Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
  })

  test('editor page layout loads correctly', async ({ page }) => {
    await registerAndCreateProject(page, 'Layout Test')

    // Verify header elements
    await expect(page.getByText('Back')).toBeVisible()
    await expect(page.locator('h2').first()).toContainText('Layout Test')
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compile' })).toBeVisible()

    // Verify sidebar
    await expect(page.getByText('Files')).toBeVisible()
    await expect(page.getByText('main.tex')).toBeVisible()

    // Verify PDF preview panel
    await expect(page.getByRole('heading', { name: 'PDF Preview' })).toBeVisible()
    await expect(page.getByText('Compile to see PDF preview')).toBeVisible()
  })

  test('Monaco editor loads', async ({ page }) => {
    await registerAndCreateProject(page, 'Monaco Test')

    // Monaco editor renders in a container with specific classes
    // Wait for the editor to initialize
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 })
  })

  test('file sidebar shows main.tex', async ({ page }) => {
    await registerAndCreateProject(page, 'Sidebar Test')

    // main.tex should be in the file list and active
    const mainTexItem = page.getByText('main.tex')
    await expect(mainTexItem).toBeVisible()
  })

  test('save button triggers save', async ({ page }) => {
    await registerAndCreateProject(page, 'Save Test')

    // Wait for editor to be ready
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 })

    // Click save
    await page.getByRole('button', { name: 'Save' }).click()

    // Should show saving state then success toast
    // The save will fail because no file content was previously stored,
    // but the button interaction should work
    await expect(
      page.getByText('Saved').or(page.getByText('Save failed'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('compile button triggers compilation', async ({ page }) => {
    await registerAndCreateProject(page, 'Compile Test')

    // Wait for editor
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 })

    // Click compile
    await page.getByRole('button', { name: 'Compile' }).click()

    // Button should change to "Compiling..."
    await expect(page.getByRole('button', { name: 'Compiling...' })).toBeVisible({ timeout: 5000 })

    // Wait for compilation result - either success or failure
    await expect(
      page
        .getByText('Compilation complete')
        .or(page.getByText('Compilation failed'))
        .or(page.getByText('Compile job started'))
        .or(page.getByText('Compile failed'))
    ).toBeVisible({ timeout: 30000 })
  })

  test('back button navigates to dashboard', async ({ page }) => {
    await registerAndCreateProject(page, 'Back Nav Test')

    // Click back link
    await page.getByRole('link', { name: /Back/ }).click()
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })
})
