// Universal rule injector — axis registry. Each axis resolves independently; the hook composes
// whichever axes yield a non-"off" level for the current event. Axes never reference one another,
// so disabling one never affects another. Add an axis by pushing to AXES.
import { resolveEffectiveLevel, loadRuleText } from "./leanmode-rules.mjs";
import { resolveVerbosityLevel, loadVerbosityRule } from "./verbosity-rules.mjs";

export const leanmodeAxis = {
  name: "leanmode",
  events: ["SubagentStart"],
  killSwitchEnv: "CLAUDE_LEANMODE",
  resolve: (agentType, root) => resolveEffectiveLevel(agentType, root),
  loadRuleText,
};

export const verbosityAxis = {
  name: "verbosity",
  events: ["SessionStart", "SubagentStart"],
  killSwitchEnv: "CLAUDE_VERBOSITY",
  resolve: (agentType, root) => resolveVerbosityLevel(agentType, root),
  loadRuleText: loadVerbosityRule,
};

export const AXES = [leanmodeAxis, verbosityAxis];
