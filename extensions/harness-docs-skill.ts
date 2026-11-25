import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const skillName = "pi-harness-docs";

export default function (pi: ExtensionAPI) {
	const skillDir = join(getAgentDir(), "cache", skillName);
	const skillPath = join(skillDir, "SKILL.md");

	pi.on("resources_discover", (_event, ctx) => {
		// Custom-prompt sessions without Pi's docs block need no replacement skill.
		if (!ctx.getSystemPrompt().includes("\n<docs>\n")) return;

		const docsDir = getDocsPath();
		const indexPath = join(docsDir, "index.md");
		const content = `---
name: ${skillName}
description: Find official docs and examples when asked about using, configuring, or extending the Pi agent harness.
---

# Pi harness documentation

- Start with \`${existsSync(indexPath) ? indexPath : getReadmePath()}\` to find the relevant guide.
- Pi README: \`${getReadmePath()}\`.
- Reference docs: \`${docsDir}\`.
- Examples: \`${getExamplesPath()}\`.

Resolve doc links and example paths against the installed Pi package, not the working directory. Before implementing harness changes, read the relevant guides and examples in full and follow their cross-references.
`;
		if (!existsSync(skillPath) || readFileSync(skillPath, "utf8") !== content) {
			mkdirSync(skillDir, { recursive: true });
			const tmpPath = join(skillDir, `.${randomUUID()}.tmp`);
			try {
				writeFileSync(tmpPath, content, { flag: "wx" });
				renameSync(tmpPath, skillPath);
			} finally {
				rmSync(tmpPath, { force: true });
			}
		}
		return { skillPaths: [skillPath] };
	});

	pi.on("before_agent_start", ({ systemPromptOptions: options }) => {
		if (!options || options.customPrompt || options.forceSystemPrompt !== undefined || options.sections.docs) return;
		if (!options.skills.some((skill) => skill.filePath === skillPath && !skill.disableModelInvocation)) return;
		const hasReader = ["read", "bash"].some((name) => options.selectedTools.includes(name) && !options.hiddenTools.includes(name));
		if (hasReader) options.sections.docs = `For Pi harness questions or changes, use the ${skillName} skill.`;
	});
}
