#!/usr/bin/env node
/**
 * Batch memory audits: one headless agent run per URL.
 *
 *   node runner/run-batch.mjs --urls urls/sample.txt [--agent claude]
 *                             [--concurrency 2] [--out reports]
 *                             [--max-turns 80] [--dry-run] [--verbose]
 *
 * --verbose streams agent stdout/stderr live, each line prefixed with the
 * site slug (output is still captured to run.json either way), and echoes
 * the exact command being spawned.
 *
 * Agents: claude (default) | gemini | antigravity | codex
 * See runner/README.md for per-agent MCP setup (each CLI needs the
 * chrome-devtools MCP server configured in its own config file).
 *
 * Reports land in <out>/<agent>/<site-slug>/ so the same URL list can be run
 * through several agents and compared. Resumable: a URL is skipped if its
 * report.json already exists. Each audit uses an isolated browser profile
 * (chrome-devtools-mcp --isolated), so concurrent runs don't share state.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

// Claude invokes the project skill directly; the other CLIs don't read
// .claude/skills, so they're pointed at the SKILL.md file, which is plain
// markdown instructions any agent can follow.
const skillPrompt = (url, siteDir) =>
  `Read the file .claude/skills/memory-audit/SKILL.md and follow its ` +
  `instructions exactly, with these arguments: ${url} --out ${siteDir}`;

const AGENTS = {
  claude: {
    bin: 'claude',
    prompt: (url, siteDir) => `/memory-audit ${url} --out ${siteDir}`,
    args: (prompt, { maxTurns }) => [
      '-p', prompt,
      '--output-format', 'json',
      '--max-turns', String(maxTurns),
      // Scoped permissions instead of a blanket bypass.
      '--allowedTools',
      'mcp__chrome-devtools__*,Read,Write,Edit,Glob,Grep,Bash(memlab:*),Bash(node:*),Bash(mkdir:*)',
    ],
  },
  gemini: {
    bin: 'gemini',
    prompt: skillPrompt,
    // --yolo auto-approves every tool call: run untrusted sites in a container.
    args: (prompt) => ['-p', prompt, '--yolo', '--output-format', 'json'],
  },
  antigravity: {
    bin: 'agy',
    prompt: skillPrompt,
    // No reliable JSON output mode yet; we keep raw stdout in run.json.
    args: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
  },
  codex: {
    bin: 'codex',
    prompt: skillPrompt,
    // workspace-write keeps file edits sandboxed to the repo. If Chrome can't
    // reach the network from the sandbox, run inside a container with
    // --dangerously-bypass-approvals-and-sandbox instead.
    args: (prompt) => ['exec', '--json', '--sandbox', 'workspace-write', prompt],
  },
};

const args = parseArgs(process.argv.slice(2));
const agentName = args.agent ?? 'claude';
const agent = AGENTS[agentName];
if (!agent) {
  console.error(`Unknown agent "${agentName}". Choose one of: ${Object.keys(AGENTS).join(', ')}`);
  process.exit(1);
}

const urlsFile = args.urls ?? 'urls/sample.txt';
const outDir = args.out ?? 'reports';
const concurrency = Number(args.concurrency ?? 2);
const maxTurns = Number(args['max-turns'] ?? 80);
const verbose = Boolean(args.verbose);

const urls = (await readFile(urlsFile, 'utf8'))
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

console.log(`${urls.length} URLs via ${agentName}, concurrency ${concurrency}, output → ${outDir}/${agentName}/`);

const queue = [...urls];
const failures = [];
await Promise.all(Array.from({ length: concurrency }, worker));

console.log(`Done. ${failures.length} failure(s).`);
if (failures.length) {
  console.log(failures.map((f) => `  ${f.url}: ${f.reason}`).join('\n'));
  process.exitCode = 1;
}

async function worker() {
  while (queue.length) {
    const url = queue.shift();
    const siteDir = join(outDir, agentName, slugify(url));

    if (await exists(join(siteDir, 'report.json'))) {
      console.log(`skip (exists)  ${url}`);
      continue;
    }
    if (args['dry-run']) {
      const prompt = agent.prompt(url, siteDir);
      console.log(`would run      ${agent.bin} ${agent.args(prompt, { maxTurns }).join(' ')}`);
      continue;
    }

    await mkdir(siteDir, { recursive: true });
    console.log(`auditing       ${url}`);
    try {
      const result = await runAgent(url, siteDir);
      await writeFile(join(siteDir, 'run.json'), result);
      const ok = await exists(join(siteDir, 'report.json'));
      console.log(`${ok ? 'done' : 'NO REPORT'}     ${url}`);
      if (!ok) failures.push({ url, reason: 'finished without report.json' });
    } catch (err) {
      failures.push({ url, reason: String(err) });
      console.error(`failed         ${url}: ${err}`);
    }
  }
}

function runAgent(url, siteDir) {
  const prompt = agent.prompt(url, siteDir);
  const cliArgs = agent.args(prompt, { maxTurns });
  const slug = slugify(url);
  if (verbose) console.log(`[${slug}] $ ${agent.bin} ${cliArgs.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(agent.bin, cliArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const echoOut = verbose ? linePrinter(`[${slug}] `, process.stdout) : null;
    const echoErr = verbose ? linePrinter(`[${slug}!] `, process.stderr) : null;
    child.stdout.on('data', (d) => { out += d; echoOut?.(d); });
    child.stderr.on('data', (d) => { err += d; echoErr?.(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      echoOut?.flush();
      echoErr?.flush();
      code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err.slice(-500)}`));
    });
  });
}

// Buffers chunks into whole lines so concurrent agents' output doesn't
// interleave mid-line, prefixing each line for attribution.
function linePrinter(prefix, stream) {
  let buffer = '';
  const print = (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) stream.write(`${prefix}${line}\n`);
  };
  print.flush = () => {
    if (buffer) stream.write(`${prefix}${buffer}\n`);
    buffer = '';
  };
  return print;
}

function slugify(url) {
  return new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}
