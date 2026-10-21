const { app } = require('electron')
const { join, resolve } = require('node:path')
const { resolveTest2Profile } = require('./test2-profile.cjs')
const profilePath = resolveTest2Profile({
  appData: app.getPath('appData'),
  installDirectory: join(process.resourcesPath, '..')
})
app.setName('Orca Test2')
app.commandLine.appendSwitch('user-data-dir', resolve(profilePath))
app.setPath('userData', resolve(profilePath))
process.env.ORCA_USER_DATA_PATH = resolve(profilePath)
process.env.ORCA_CLOUD_API_URL ||= 'https://login.onorca.dev'
process.env.ORCA_CLOUD_CLIENT_ID ||= 'orca-desktop'
process.env.ORCA_RELAY_URL ||= 'https://relay.onorca.dev'
require('./out/main/index.js')
