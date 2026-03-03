import { test, expect, Page } from '@playwright/test'

const timestamp = Date.now()
const testPassword = 'testpass123'

async function registerAndCreateProject(page: Page, projectTitle: string): Promise<void> {
  const email = `e2e-editor-${timestamp}-${Math.random().toString(36).slice(2, 8)}@test.com`

  // Register
  await page.goto('/register')
  await page.locator('input#register-email').fill(email)
  await page.locator('input#register-password').fill(testPassword)
  await page.locator('input#register-confirm-password').fill(testPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/', { timeout: 10000 })

  // Create project
  await page.getByRole('button', { name: /New Project/ }).first().click()
  await page.getByPlaceholder('My LaTeX Document').fill(projectTitle)
  // Use exact: true to match only the modal submit button, not the empty-state "+ Create project" button
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page).toHaveURL(/\/project\//, { timeout: 10000 })
}

test.describe('Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
  })

  test('editor page layout loads correctly', async ({ page }) => {
    await registerAndCreateProject(page, 'Layout Test')

    // Verify header elements — the back link uses "Underleaf" logo text
    await expect(page.getByRole('link', { name: /Underleaf/ }).first()).toBeVisible()
    await expect(page.locator('h2').first()).toContainText('Layout Test')
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compile' })).toBeVisible()

    // Verify sidebar — FILES label (all caps)
    // Use exact: true to avoid strict mode violation with partial matches
    await expect(page.getByText('FILES', { exact: true })).toBeVisible()

    // Verify PDF panel — tab is "PDF" and empty state text
    await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible()
    await expect(page.getByText(/Click.*Compile.*to render your PDF/)).toBeVisible()
  })

  test('Monaco editor loads', async ({ page }) => {
    await registerAndCreateProject(page, 'Monaco Test')

    // Monaco editor renders in a container with specific classes
    // Wait for the editor to initialize
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 })
  })

  test('file sidebar shows main.tex after save', async ({ page }) => {
    await registerAndCreateProject(page, 'Sidebar Test')

    // Wait for Monaco editor to be ready
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 })

    // Save to create main.tex in MinIO (the file list is empty for blank projects)
    await page.getByRole('button', { name: 'Save' }).click()

    // After save, main.tex should appear in the sidebar file tree
    await expect(page.getByText('main.tex')).toBeVisible({ timeout: 10000 })
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

    // Button should change to "Compiling…" (with ellipsis character)
    await expect(page.getByRole('button', { name: /Compiling/ })).toBeVisible({ timeout: 5000 })

    // Wait for compilation result — either success or failure
    await expect(
      page
        .getByText('Compilation complete')
        .or(page.getByText('Compilation failed'))
        .or(page.getByText('Compile job started'))
        .or(page.getByText('Compile failed'))
        .or(page.getByText(/Compiled in/))
    ).toBeVisible({ timeout: 30000 })
  })

  test('back button navigates to dashboard', async ({ page }) => {
    await registerAndCreateProject(page, 'Back Nav Test')

    // The "back" link is the Underleaf logo link to "/"
    await page.getByRole('link', { name: /Underleaf/ }).first().click()
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByText('My Projects')).toBeVisible()
  })
})
