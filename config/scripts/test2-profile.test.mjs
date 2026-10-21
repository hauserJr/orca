import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import profileModule from '../test2-profile.cjs'

test('Test2 keeps the established profile when an update ships a different pointer', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-profile-binding-'))
  try {
    const appData = join(root, 'appdata'),
      installDirectory = join(root, 'app'),
      profile = join(root, 'profile')
    mkdirSync(installDirectory)
    mkdirSync(profile)
    writeFileSync(join(profile, 'orca-profile-index.json'), '{}')
    const pointer = join(installDirectory, 'orca-test2-profile.json')
    writeFileSync(pointer, JSON.stringify({ profilePath: profile }))
    assert.equal(profileModule.resolveTest2Profile({ appData, installDirectory }), profile)
    writeFileSync(pointer, JSON.stringify({ profilePath: join(root, 'wrong-new-default') }))
    assert.equal(profileModule.resolveTest2Profile({ appData, installDirectory }), profile)
    assert.equal(existsSync(join(root, 'wrong-new-default')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('Test2 refuses missing data and data inside the replaceable application directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-profile-binding-'))
  try {
    const installDirectory = join(root, 'app'),
      appData = join(root, 'appdata')
    mkdirSync(installDirectory)
    const pointer = join(installDirectory, 'orca-test2-profile.json')
    const missing = join(root, 'missing')
    writeFileSync(pointer, JSON.stringify({ profilePath: missing }))
    assert.throws(() => profileModule.resolveTest2Profile({ appData, installDirectory }))
    assert.equal(existsSync(missing), false)
    const unsafe = join(installDirectory, 'data')
    mkdirSync(unsafe)
    writeFileSync(join(unsafe, 'orca-profile-index.json'), '{}')
    writeFileSync(pointer, JSON.stringify({ profilePath: unsafe }))
    assert.throws(() => profileModule.resolveTest2Profile({ appData, installDirectory }), /outside/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
