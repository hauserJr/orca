import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ seedTestRepo: false })
test('question X closes without approval and history reopens the original question', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.setViewportSize({ width: 1200, height: 850 })
  const created = await orcaPage.evaluate(() =>
    window.api.runtime.call({
      method: 'workInbox.ask',
      params: {
        from: 'isolated-e2e-agent',
        question: 'May I deploy the isolated test?',
        options: 'Approve (recommended),Reject',
        requestId: 'close-reopen-ui',
        timeoutMs: 0
      }
    })
  )
  expect(created.ok).toBe(true)
  if (
    !created.ok ||
    typeof created.result !== 'object' ||
    !created.result ||
    !('id' in created.result) ||
    typeof created.result.id !== 'string'
  ) {
    throw new Error('Question creation failed')
  }
  const id = created.result.id
  await orcaPage.getByRole('button', { name: 'Work Inbox', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Refresh', exact: true }).click()
  const card = orcaPage.locator('article').filter({ hasText: 'May I deploy the isolated test?' })
  await expect(card).toBeVisible()
  await card.getByRole('checkbox', { name: 'Approve (recommended)', exact: true }).click()
  await orcaPage.screenshot({ path: testInfo.outputPath('question-close.png') })
  await card.getByRole('button', { name: 'Close without answering', exact: true }).click()
  await expect(card).toHaveCount(0)
  const notification = await orcaPage.evaluate(
    (id) =>
      window.api.runtime.call({
        method: 'workInbox.ask',
        params: {
          from: 'isolated-e2e-agent',
          resume: id,
          timeoutMs: 0
        }
      }),
    id
  )
  expect(notification).toMatchObject({
    ok: true,
    result: { id, cancelled: true, answer: null, message: expect.stringContaining('not approval') }
  })
  await orcaPage.getByRole('combobox', { name: 'Question list' }).click()
  await orcaPage.getByRole('option', { name: 'History', exact: true }).click()
  await expect(card).toBeVisible()
  await expect(card.getByText('Closed without an answer', { exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('question-history.png') })
  await card.getByRole('button', { name: 'Reopen question' }).click()
  await expect(card).toHaveCount(0)
  await orcaPage.getByRole('combobox', { name: 'Question list' }).click()
  await orcaPage.getByRole('option', { name: 'Unanswered', exact: true }).click()
  await expect(card).toBeVisible()
  const state = await orcaPage.evaluate(
    (id) => window.api.runtime.call({ method: 'workInbox.list', params: { id } }),
    id
  )
  expect(state).toMatchObject({
    ok: true,
    result: { items: [{ id, status: 'open', revision: 2 }] }
  })
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
})
