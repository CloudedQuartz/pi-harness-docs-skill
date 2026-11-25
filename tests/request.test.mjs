import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const piRoot = process.argv[2];
assert.ok(piRoot, 'Pass the installed pi-coding-agent package directory');
const extension = fileURLToPath(new URL('../extensions/harness-docs-skill.ts', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'pi-harness-docs-'));
const agentDir = join(scratch, 'agent');
const requests = [];
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const result = {
    id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'offline',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
  };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(result)}\n\ndata: [DONE]\n\n`);
});

try {
  process.env.PI_OFFLINE = '1';
  process.env.HOME = scratch;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const fixtureSkill = join(agentDir, 'skills', 'fixture');
  mkdirSync(fixtureSkill, { recursive: true });
  writeFileSync(join(fixtureSkill, 'SKILL.md'), '---\nname: fixture\ndescription: A separate skill.\n---\n\nFixture body.\n');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, getDocsPath } =
    await import(join(piRoot, 'dist', 'index.js'));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const model = {
    id: 'offline', name: 'Offline fixture', api: 'openai-completions', provider: 'offline-fixture', baseUrl,
    reasoning: false, input: ['text'], contextWindow: 16000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') });
  modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl, apiKey: 'fixture', models: [model] });
  await modelRuntime.setRuntimeApiKey(model.provider, 'fixture');

  async function ask({ enabled = true, customPrompt, tools = ['read', 'bash'], text = 'Fixture request.' } = {}) {
    const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off' }, { projectTrusted: false });
    const resourceLoader = new DefaultResourceLoader({
      cwd: scratch, agentDir, settingsManager, additionalExtensionPaths: enabled ? [extension] : [],
      ...(customPrompt ? { systemPromptOverride: () => customPrompt } : {}),
    });
    await resourceLoader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd: scratch, agentDir, model, modelRuntime, settingsManager, resourceLoader, tools,
      sessionManager: SessionManager.inMemory(scratch),
    });
    try {
      assert.deepEqual(extensionsResult.errors, []);
      const errors = [];
      await session.bindExtensions({ mode: 'print', onError: (error) => errors.push(error) });
      const before = requests.length;
      await session.prompt(text);
      assert.equal(requests.length, before + 1);
      assert.deepEqual(errors, []);
      return requests.at(-1);
    } finally {
      session.dispose();
    }
  }

  const systemText = (payload) => payload.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const original = await ask({ enabled: false });
  const lean = await ask();
  const originalPrompt = systemText(original);
  const leanPrompt = systemText(lean);
  const docsBlock = /<docs>\n[\s\S]*?\n<\/docs>/;
  const skillEntry = /  <skill>\n    <name>pi-harness-docs<\/name>\n[\s\S]*?\n  <\/skill>\n/;
  assert.match(originalPrompt, /When asked about: extensions/);
  assert.match(leanPrompt, /<docs>\nFor Pi harness questions or changes, use the pi-harness-docs skill\.\n<\/docs>/);
  assert.match(leanPrompt, skillEntry);
  assert.equal(leanPrompt.replace(docsBlock, '').replace(skillEntry, ''), originalPrompt.replace(docsBlock, ''));
  assert.deepEqual(lean.tools, original.tools);
  console.log(`PASS: outgoing system text ${Buffer.byteLength(originalPrompt)} → ${Buffer.byteLength(leanPrompt)} bytes in a fixture with an existing skill; only the docs block and new entry differ.`);

  const explicit = await ask({ text: '/skill:pi-harness-docs How do I write an extension?' });
  const explicitContent = explicit.messages.findLast((m) => m.role === 'user').content;
  const explicitText = typeof explicitContent === 'string' ? explicitContent : explicitContent.map((part) => part.text).join('\n');
  assert.match(explicitText, /<skill name="pi-harness-docs"/);
  assert(explicitText.includes(getDocsPath()));
  assert.match(explicitText, /How do I write an extension\?$/);
  assert.doesNotMatch(leanPrompt, /Reference docs:/);

  const customPrompt = 'An SDK or child custom prompt.';
  assert.equal(systemText(await ask({ customPrompt })), systemText(await ask({ customPrompt, enabled: false })));
  assert.match(systemText(await ask({ tools: ['grep'] })), /When asked about: extensions/);
  console.log('PASS: explicit skill loads the docs paths; custom prompts and sessions without a reader keep their original docs behavior.');

  const alternatePackage = join(scratch, 'alternate-pi');
  mkdirSync(join(alternatePackage, 'docs'), { recursive: true });
  writeFileSync(join(alternatePackage, 'docs', 'index.md'), '# Alternate index\n');
  process.env.PI_PACKAGE_DIR = alternatePackage;
  const updated = await ask();
  assert.match(systemText(updated), skillEntry);
  assert(readFileSync(join(agentDir, 'cache', 'pi-harness-docs', 'SKILL.md'), 'utf8').includes(join(alternatePackage, 'docs', 'index.md')));
  console.log('PASS: resource discovery regenerates the cached skill when the running Pi docs path changes.');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
