import { planCodexNoDaemonLaunch } from '../../pty/codex-no-daemon-launch-command'
import { prepareWorkInboxCliLaunch } from './work-inbox-cli-launch'
import { prepareCodexWorkInboxCommand } from '../../codex/codex-work-inbox-launch'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'

export async function prepareAgentWorkInboxLaunch(
  input: Omit<
    Parameters<typeof prepareCodexWorkInboxCommand>[0],
    'shell' | 'serverIsolation' | 'command'
  > & {
    command?: string
    shellOverride?: string
  }
) {
  const shell =
    resolveLocalWindowsAgentStartupShell({
      platform: process.platform,
      isRemote: input.remote,
      terminalWindowsShell: input.shellOverride
    }) ?? 'posix'
  const noDaemon = planCodexNoDaemonLaunch({
    command: input.command,
    executesOnThisHost: !input.remote,
    shellOverride: input.shellOverride,
    env: input.env,
    envToDelete: input.envToDelete,
    cwd: input.cwd
  })
  const command = await prepareWorkInboxCliLaunch({
    ...input,
    command: noDaemon ? await noDaemon : input.command,
    shell
  })
  return prepareCodexWorkInboxCommand({
    ...input,
    command,
    shell,
    serverIsolation: input.env?.ORCA_CODEX_ISOLATE
  })
}
