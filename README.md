# Pi harness docs skill

Replaces Pi’s default documentation index in the system prompt with a short pointer to the `pi-harness-docs` skill. Pi advertises the skill normally; its body is read only when needed. Custom-prompt sessions without the default docs section are left alone.

## Install

```sh
pi install git:github.com/CloudedQuartz/pi-harness-docs-skill
```

Start a new Pi session to load the extension. For local development, symlink `extensions/harness-docs-skill.ts` into the agent’s `extensions/` directory instead. Use only one installation method.

On discovery the extension refreshes `$PI_CODING_AGENT_DIR/cache/pi-harness-docs/SKILL.md` (under `~/.pi/agent` by default) using the running Pi release’s README, docs, and examples paths. The skill uses the installed docs index directly, so upgrades do not require maintaining a separate index. Tool access is unchanged. Type `/skill:pi-harness-docs` to load the skill explicitly.

Run `node tests/request.test.mjs /absolute/path/to/pi-coding-agent` to verify the generated skill and outgoing prompt against a localhost fixture without provider calls.
