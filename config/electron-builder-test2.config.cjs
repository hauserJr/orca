const { join, resolve } = require('node:path')
const base = require('./electron-builder.config.cjs')
const buildRoot = process.env.ORCA_TEST2_BUILD_ROOT || resolve(__dirname, '../../test/orca-test2')
module.exports = {
  ...base,
  appId: 'com.stablyai.orca.test2',
  productName: 'Orca Test2',
  protocols: [],
  publish: null,
  // This local x64 package reuses verified native modules held open by live terminals.
  npmRebuild: false,
  electronDist: process.env.ORCA_TEST2_ELECTRON_DIST || join(buildRoot, 'electron-runtime'),
  directories: { ...base.directories, output: join(buildRoot, 'package-output') },
  extraMetadata: {
    name: 'orca-test2',
    version: `${require('../package.json').version}-test.2`,
    main: 'test2-bootstrap.cjs'
  },
  files: [
    ...base.files,
    { from: __dirname, to: '.', filter: ['test2-bootstrap.cjs', 'test2-profile.cjs'] }
  ],
  extraFiles: [
    {
      from: join(buildRoot, 'package-input/orca-test2-profile.json'),
      to: 'orca-test2-profile.json'
    }
  ],
  win: {
    ...base.win,
    signtoolOptions: { sign: base.win.signtoolOptions.sign },
    verifyUpdateCodeSignature: false
  },
  nsis: {
    ...base.nsis,
    artifactName: 'Orca-Test2-Setup.${ext}',
    include: join(__dirname, 'nsis', 'orca-test2-profile.nsh')
  }
}
