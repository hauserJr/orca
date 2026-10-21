import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import Database from './sqlite/sync-database'
import { createUpdateProfileSnapshot } from './update-profile-snapshot'
import { restoreUpdateProfileSnapshot } from './update-profile-restore'
import { WorkInboxStore, WORK_INBOX_SCHEMA_SQL } from './runtime/work-inbox/work-inbox-store'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-update-snapshot-'))
  roots.push(root)
  const profile = join(root, 'profile')
  await mkdir(profile)
  return { root, profile }
}
describe('Update backup and recovery', () => {
  it('preserves WAL questions, settings, credentials, workflow documents and history through restore', async () => {
    const { root, profile } = await fixture()
    const documents = {
      'settings.json': '{"theme":"dark","custom":true}',
      'agent.key': 'isolated-test-key',
      'project-teams.json': '{"teams":[]}',
      'workflow.md': '# Existing workflow',
      'history.json': '["original"]'
    }
    for (const [name, bytes] of Object.entries(documents)) {
      await writeFile(join(profile, name), bytes)
    }
    const db = new Database(join(profile, 'orchestration.db'))
    let itemId: string
    let backup: string
    try {
      db.pragma('journal_mode = WAL')
      db.exec(WORK_INBOX_SCHEMA_SQL)
      const store = new WorkInboxStore(db)
      itemId = store.create({
        asker: {
          handle: 'same-agent',
          paneKey: null,
          projectId: null,
          projectLabel: null,
          worktreeId: null,
          agentKind: 'codex'
        },
        question: 'Still waiting?',
        optionLabels: ['Approve'],
        allowFreeText: true,
        now: 1
      }).id
      backup = await createUpdateProfileSnapshot(profile, 'old-version')
      expect(store.get(itemId)?.status).toBe('open')
    } finally {
      db.close()
    }
    const restored = join(root, 'restored')
    await restoreUpdateProfileSnapshot(backup, restored)
    for (const [name, bytes] of Object.entries(documents)) {
      expect(await readFile(join(restored, name), 'utf8')).toBe(bytes)
      expect(await readFile(join(profile, name), 'utf8')).toBe(bytes)
    }
    const next = new Database(join(restored, 'orchestration.db'))
    try {
      next.exec(WORK_INBOX_SCHEMA_SQL)
      const store = new WorkInboxStore(next)
      expect(store.get(itemId)).toMatchObject({
        status: 'open',
        agentId: 'same-agent',
        revision: 0
      })
      expect(
        store.answer(
          { id: itemId, expectedRevision: 0, clientRequestId: 'after-upgrade', text: 'Continue' },
          2
        ).status
      ).toBe('ok')
      expect(store.acknowledge(itemId, 3).status).toBe('ok')
    } finally {
      next.close()
    }
  })
  it('refuses corruption and an existing restore destination before writing user data', async () => {
    const { root, profile } = await fixture()
    await writeFile(join(profile, 'settings.json'), 'original')
    const backup = await createUpdateProfileSnapshot(profile, 'v1')
    await expect(restoreUpdateProfileSnapshot(backup, profile)).rejects.toThrow()
    await writeFile(join(backup, 'data', 'settings.json'), 'corrupted')
    await expect(restoreUpdateProfileSnapshot(backup, join(root, 'restore'))).rejects.toThrow(
      'checksum'
    )
    expect(await readFile(join(profile, 'settings.json'), 'utf8')).toBe('original')
  })
  it('captures an exclusively locked database without releasing or changing its owner', async () => {
    const { root, profile } = await fixture()
    const owner = new Database(join(profile, 'browser.db'))
    try {
      owner.exec(
        "PRAGMA locking_mode=EXCLUSIVE; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES ('saved')"
      )
      const backup = await createUpdateProfileSnapshot(profile, 'v1')
      const restored = join(root, 'restored-locked')
      await restoreUpdateProfileSnapshot(backup, restored)
      const copy = new Database(join(restored, 'browser.db'))
      try {
        expect(copy.prepare('SELECT value FROM retained').get()).toEqual({ value: 'saved' })
        expect(owner.prepare('SELECT value FROM retained').get()).toEqual({ value: 'saved' })
      } finally {
        copy.close()
      }
    } finally {
      owner.close()
    }
  })
  it('rejects a backup inside the source profile', async () => {
    const { profile } = await fixture()
    await expect(
      createUpdateProfileSnapshot(profile, 'v1', join(profile, 'backups'))
    ).rejects.toThrow('outside')
  })
  it('backs up SQLite at a Windows long path without losing committed rows', async () => {
    const { root, profile } = await fixture()
    const db = new Database(join(profile, 'state.db'))
    try {
      db.exec("CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('original')")
    } finally {
      db.close()
    }
    const backup = await createUpdateProfileSnapshot(
      profile,
      'v1',
      join(root, 'long'.repeat(35), 'path'.repeat(30))
    )
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'))
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].path).toBe('state.db')
  })
  it('rejects path traversal and symlink ancestors before creating a restored directory', async () => {
    const { root, profile } = await fixture()
    const backup = await createUpdateProfileSnapshot(profile, 'v1')
    for (const entries of [
      [{ path: '../outside', link: 'external' }],
      [
        { path: 'link', link: root },
        { path: 'link/child', link: 'external' }
      ]
    ]) {
      await writeFile(
        join(backup, 'manifest.json'),
        JSON.stringify({ format: 1, version: 'v1', createdAt: '', entries })
      )
      await expect(restoreUpdateProfileSnapshot(backup, join(root, 'rejected'))).rejects.toThrow()
    }
  })
})
