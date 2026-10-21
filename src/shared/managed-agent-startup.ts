import { buildAgentStartupPlan as buildStartup } from './tui-agent-startup'
import { withWorkInboxRoutingPrompt } from './work-inbox-routing-instructions'
export {
  agentPromptRidesLaunchCommand,
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildShellCommandFromArgv,
  isShellProcess,
  planAgentCliArgsSuffix,
  quoteStartupArg,
  resolveStartupShell
} from './tui-agent-startup'
export type {
  AgentCliArgsPlan,
  AgentDraftLaunchPlan,
  AgentStartupPlan,
  AgentStartupShell
} from './tui-agent-startup'

/** Managed launches add the built-in input route; quoting and transport planning stay provider-owned. */
export function buildAgentStartupPlan(args: Parameters<typeof buildStartup>[0]) {
  if (!args.prompt.trim() && !args.allowEmptyPromptLaunch) {
    return null
  }
  return buildStartup({ ...args, prompt: withWorkInboxRoutingPrompt(args.prompt) })
}
