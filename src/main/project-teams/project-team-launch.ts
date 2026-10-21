import { withWorkInboxRoutingPrompt } from '../../shared/work-inbox-routing-instructions'
import { runProcess } from '@orca/process-host'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { buildShellCommandFromArgv } from '../../shared/tui-agent-startup-shell'
import { readTeamResource, resolveTeamPath, type ProjectTeamRole } from './project-team-config'

export async function buildTeamLaunch(
  role: ProjectTeamRole,
  config: string,
  root: string,
  contextFile: string
) {
  const shell = process.platform === 'win32' ? ('powershell' as const) : ('posix' as const)
  const cwd = resolveTeamPath(role.cwd, root)
  const env: Record<string, string> = {}
  const executable =
    role.provider === 'claude' && process.platform === 'win32'
      ? join(homedir(), '.local', 'bin', 'claude.exe')
      : role.provider
  if (role.provider === 'claude' && role.configHome) {
    env.CLAUDE_CONFIG_DIR = resolveTeamPath(role.configHome, root)
  }
  const binary = await resolveCommandOnLocalPath(executable, {
    cwd,
    env: { ...process.env, ...env }
  })
  if (!binary) {
    throw new Error(`team_cli_missing:${role.provider}`)
  }
  const initialization =
    role.provider === 'codex'
      ? `完整讀取 ${contextFile}`
      : '確認啟動時已附加的完整職位、skills與索引內容，不使用工具、不重複讀檔'
  const prompt = withWorkInboxRoutingPrompt(
    `只初始化目前職位，不接續舊任務、不改檔、不派工。${initialization} 後回覆 TEAM_READY:${role.id}，簡短列出已載入的職位、skills及索引，然後待命。`
  )
  let args: string[]
  if (role.provider === 'codex') {
    args = [
      '--no-daemon',
      '--cd',
      cwd,
      '--model',
      role.model,
      '-c',
      `model_reasoning_effort="${role.effort}"`
    ]
    if (role.codexSettings) {
      args.push(
        '-c',
        `model_auto_compact_token_limit=${role.codexSettings.model_auto_compact_token_limit}`,
        '-c',
        'model_auto_compact_token_limit_scope="total"'
      )
    }
  } else {
    if (!role.account || !role.configHome || !role.tools) {
      throw new Error('team_claude_account_or_tools_missing')
    }
    const status = await runProcess({
      program: binary,
      args: ['auth', 'status', '--json'],
      cwd,
      env: { ...process.env, ...env },
      timeoutMs: 15000
    })
    if (status.code !== 0 || status.timedOut) {
      throw new Error('team_auth_status_failed')
    }
    const auth: unknown = JSON.parse(status.stdout)
    if (
      !auth ||
      typeof auth !== 'object' ||
      !('loggedIn' in auth) ||
      auth.loggedIn !== true ||
      !('email' in auth) ||
      auth.email !== role.account
    ) {
      throw new Error('team_account_login_required')
    }
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '70'
    env.ECC_HOOKS_ENABLED = 'false'
    args = [
      '--restricted',
      '--tools',
      role.tools,
      '--strict-mcp-config',
      '--permission-mode',
      role.permissionMode,
      '--model',
      role.model,
      '--effort',
      role.effort,
      '--name',
      role.title,
      '--append-system-prompt-file',
      contextFile
    ]
    if (role.pluginDir) {
      args.push('--plugin-dir', resolveTeamPath(role.pluginDir, root))
    }
    if (role.settingsFile) {
      await readTeamResource(config, role.settingsFile)
      args.push('--settings', resolveTeamPath(role.settingsFile, join(config, '..')))
    }
    for (const scope of role.scopeDirs) {
      args.push('--add-dir', resolveTeamPath(scope, root))
    }
  }
  const base = role.provider === 'codex' ? 'codex' : buildShellCommandFromArgv([binary], shell)
  return {
    cwd,
    env,
    shell: process.platform === 'win32' ? ('powershell' as const) : undefined,
    command:
      role.provider === 'codex'
        ? `codex ${buildShellCommandFromArgv([...args, prompt], shell).replace(/^& /, '')}`
        : buildShellCommandFromArgv([binary, prompt, ...args], shell),
    launchConfig: {
      agentCommand: base,
      agentArgs: buildShellCommandFromArgv(args, shell).replace(/^& /, ''),
      agentEnv: env
    }
  }
}
