import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { createUpdateProfileSnapshot } from '../../src/main/update-profile-snapshot'
import { restoreUpdateProfileSnapshot } from '../../src/main/update-profile-restore'

// oxlint-disable-next-line no-empty-pattern -- This test owns both hidden launches of one isolated profile.
test('pending question and settings survive backup and application restart', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const session = createRestartSession(testInfo, { ORCA_BACKGROUND_LAUNCH: '1' })
  let active: ElectronApplication | undefined
  try {
    const first = await session.launch()
    active = first.app
    await waitForSessionReady(first.page)
    await first.page.evaluate(async () => {
      await window
        .__store!.getState()
        .updateSettingsOrThrow({ theme: 'dark', terminalFontSize: 19 })
    })
    const created = await first.page.evaluate(() =>
      window.api.runtime.call({
        method: 'workInbox.ask',
        params: {
          from: 'restart-original-agent',
          question: 'Continue after this restart?',
          requestId: 'restart-question',
          timeoutMs: 0
        }
      })
    )
    if (
      !created.ok ||
      typeof created.result !== 'object' ||
      !created.result ||
      !('id' in created.result) ||
      typeof created.result.id !== 'string'
    ) {
      throw new Error('Pending question was not created')
    }
    const id = created.result.id
    const backup = await createUpdateProfileSnapshot(
      session.userDataDir,
      'pre-restart',
      testInfo.outputPath('backups')
    )
    await restoreUpdateProfileSnapshot(backup, testInfo.outputPath('restored-profile'))
    await session.close(active)
    active = undefined
    const second = await session.launch()
    active = second.app
    await waitForSessionReady(second.page)
    expect(
      await second.page.evaluate(() => ({
        theme: window.__store!.getState().settings?.theme,
        terminalFontSize: window.__store!.getState().settings?.terminalFontSize
      }))
    ).toEqual({ theme: 'dark', terminalFontSize: 19 })
    const card = second.page.locator('article').filter({ hasText: 'Continue after this restart?' })
    await expect(card).toBeVisible()
    await second.page.screenshot({ path: testInfo.outputPath('pending-after-restart-dark.png') })
    await card
      .getByRole('textbox', { name: 'Answer', exact: true })
      .fill('Continue with the original task')
    await card.getByRole('button', { name: 'Send answer', exact: true }).click()
    const received = await second.page.evaluate(
      (id) =>
        window.api.runtime.call({
          method: 'workInbox.ask',
          params: {
            from: 'restart-original-agent',
            resume: id,
            timeoutMs: 0
          }
        }),
      id
    )
    expect(received).toMatchObject({
      ok: true,
      result: { id, status: 'answered', answer: { text: 'Continue with the original task' } }
    })
    expect(
      await second.page.evaluate(
        (id) =>
          window.api.runtime.call({
            method: 'workInbox.ack',
            params: { from: 'restart-original-agent', id }
          }),
        id
      )
    ).toMatchObject({ ok: true, result: { status: 'ok', item: { id, status: 'delivered' } } })
    expect(
      await active.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await session.dispose(active)
  }
})
