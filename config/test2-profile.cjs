const {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} = require('node:fs')
const { dirname, isAbsolute, join, relative, sep } = require('node:path')

// The installer may replace its bundled pointer; the user's established binding wins.
function resolveTest2Profile({ appData, installDirectory }) {
  const binding = join(appData, 'Orca Test2', 'profile-location.json')
  const location = existsSync(binding) ? binding : join(installDirectory, 'orca-test2-profile.json')
  const { profilePath } = JSON.parse(readFileSync(location, 'utf8'))
  if (
    typeof profilePath !== 'string' ||
    !isAbsolute(profilePath) ||
    !lstatSync(profilePath).isDirectory()
  ) {
    throw new Error(
      'The existing Orca Test2 profile is unavailable. Restore its location before starting; no new profile was created.'
    )
  }
  const profile = realpathSync(profilePath)
  if (!existsSync(join(profile, 'orca-profile-index.json'))) {
    throw new Error(
      'The existing Orca Test2 profile index is missing. No default settings were written.'
    )
  }
  const inside = relative(realpathSync(installDirectory), profile)
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside))) {
    throw new Error('Orca Test2 data must be outside the application installation directory.')
  }
  if (!existsSync(binding)) {
    mkdirSync(dirname(binding), { recursive: true })
    try {
      writeFileSync(binding, JSON.stringify({ profilePath: profile }), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
      return resolveTest2Profile({ appData, installDirectory })
    }
  }
  return profile
}

module.exports = { resolveTest2Profile }
