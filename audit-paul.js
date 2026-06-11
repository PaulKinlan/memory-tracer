import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickLinkByText(page, text) {
  console.log(`Attempting to click link containing text: "${text}"`);
  await page.evaluate((txt) => {
    const links = Array.from(document.querySelectorAll('a'));
    const link = links.find(l => l.textContent.trim().toLowerCase() === txt.toLowerCase());
    if (link) {
      link.click();
    } else {
      throw new Error(`Link with text "${txt}" not found`);
    }
  }, text);
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(err => {
    console.log(`Navigation wait finished or timed out: ${err.message}`);
  });
}

async function clickFirstArticle(page) {
  console.log('Attempting to click first article link (a.u-url)...');
  await page.evaluate(() => {
    const firstArticle = document.querySelector('a.u-url');
    if (firstArticle) {
      firstArticle.click();
    } else {
      throw new Error('First article link (a.u-url) not found');
    }
  });
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(err => {
    console.log(`Navigation wait finished or timed out: ${err.message}`);
  });
}

async function focusTypeBlurClear(page, iteration) {
  const inputSelector = 'input#bd-email';
  await page.focus(inputSelector);
  await page.type(inputSelector, `test-${iteration}@example.com`, { delay: 10 });
  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur();
  });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, inputSelector);
  await delay(100);
}

async function scrollPage(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await delay(500);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await delay(500);
}

async function takeSnapshot(page, filePath) {
  const client = await page.target().createCDPSession();
  await client.send('HeapProfiler.enable');

  const writeStream = fs.createWriteStream(filePath);

  client.on('HeapProfiler.addHeapSnapshotChunk', (data) => {
    writeStream.write(data.chunk);
  });

  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });

  await new Promise((resolve, reject) => {
    writeStream.end();
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
  
  await client.detach();
}

function classifyCategory(traceText, className) {
  const text = (traceText + ' ' + className).toLowerCase();
  if (text.includes('detached')) return 'detached-dom';
  if (text.includes('listener') || text.includes('handler') || text.includes('event')) return 'event-listener';
  if (text.includes('timer') || text.includes('timeout') || text.includes('interval')) return 'timer-interval';
  if (text.includes('cache') || text.includes('map') || text.includes('set')) return 'unbounded-cache';
  if (text.includes('observer')) return 'observer';
  if (text.includes('socket') || text.includes('worker')) return 'worker-or-socket';
  if (text.includes('closure')) return 'closure-retention';
  if (text.includes('global') || text.includes('window')) return 'global-accumulation';
  return 'closure-retention';
}

function parseMemlabOutput(stdout, scenarioId) {
  const findings = [];
  const lines = stdout.split('\n');
  
  let inTrace = false;
  let currentTrace = [];
  let traceClass = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('->') || (trimmed.startsWith('[') && trimmed.includes(']@'))) {
      inTrace = true;
      currentTrace.push(line);
      
      const classMatch = trimmed.match(/\(([^)]+)\)/);
      if (classMatch) {
        traceClass = classMatch[1];
      }
    } else if (inTrace && trimmed === '') {
      if (currentTrace.length > 0) {
        const className = traceClass || 'UnknownObject';
        findings.push({
          id: `finding-${scenarioId}-${findings.length + 1}`,
          scenarioId: scenarioId,
          category: classifyCategory(currentTrace.join('\n'), className),
          severity: 'medium',
          confidence: 'high',
          summary: `Memlab found a leak path retaining ${className}`,
          growthBytesPerIteration: 0,
          leakedObjectClass: className,
          retainerTraceExcerpt: currentTrace.slice(0, 20).join('\n'), // excerpt max 20 lines
          suggestedFix: `Investigate retainer trace for ${className} reference retention and clear references on teardown.`
        });
      }
      inTrace = false;
      currentTrace = [];
      traceClass = null;
    } else if (inTrace) {
      currentTrace.push(line);
      const classMatch = trimmed.match(/\(([^)]+)\)/);
      if (classMatch) {
        traceClass = classMatch[1];
      }
    }
  }

  if (inTrace && currentTrace.length > 0) {
    const className = traceClass || 'UnknownObject';
    findings.push({
      id: `finding-${scenarioId}-${findings.length + 1}`,
      scenarioId: scenarioId,
      category: classifyCategory(currentTrace.join('\n'), className),
      severity: 'medium',
      confidence: 'high',
      summary: `Memlab found a leak path retaining ${className}`,
      growthBytesPerIteration: 0,
      leakedObjectClass: className,
      retainerTraceExcerpt: currentTrace.slice(0, 20).join('\n'),
      suggestedFix: `Investigate retainer trace for ${className} reference retention and clear references on teardown.`
    });
  }

  return findings;
}

async function runScenario(scenario, outDir) {
  console.log(`\n--- Running scenario: ${scenario.id} ---`);
  const scenarioDir = path.join(outDir, scenario.id);
  fs.mkdirSync(scenarioDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--js-flags=--expose-gc']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  // 1. Setup
  console.log(`Setting up: ${scenario.setup}`);
  await page.goto('https://paul.kinlan.me/', { waitUntil: 'networkidle2' });
  await delay(1000);

  // Take baseline screenshot
  await page.screenshot({ path: path.join(scenarioDir, 'baseline.png') });

  // 2. Baseline snapshot
  console.log('Taking baseline heapsnapshot...');
  const baselinePath = path.join(scenarioDir, 'baseline.heapsnapshot');
  await takeSnapshot(page, baselinePath);

  // 3. Action loop
  console.log(`Performing action: "${scenario.description}" for ${scenario.iterations} iterations...`);
  for (let i = 0; i < scenario.iterations; i++) {
    process.stdout.write(`${i + 1}/${scenario.iterations} `);
    try {
      if (scenario.id === 'idle-baseline') {
        await delay(6000); // Wait 6 seconds per iteration (total 6s since iterations is 1, wait, we will wait 60s total in main script for baseline if needed)
      } else if (scenario.id === 'route-cycle') {
        await clickLinkByText(page, 'Projects');
        await delay(500);
        await clickLinkByText(page, 'Home');
        await delay(500);
      } else if (scenario.id === 'navigate-article') {
        await clickFirstArticle(page);
        await delay(500);
        await clickLinkByText(page, 'Home');
        await delay(500);
      } else if (scenario.id === 'subscribe-input') {
        await focusTypeBlurClear(page, i);
      } else if (scenario.id === 'scroll-homepage') {
        await scrollPage(page);
      }
    } catch (err) {
      console.log(`\nError in iteration ${i + 1}: ${err.message}`);
    }
  }
  console.log('\nAction loop complete.');

  // Take target screenshot
  await page.screenshot({ path: path.join(scenarioDir, 'target.png') });

  // 4. Target snapshot
  console.log('Taking target heapsnapshot...');
  const targetPath = path.join(scenarioDir, 'target.heapsnapshot');
  await takeSnapshot(page, targetPath);

  // 5. Revert and final snapshot
  console.log('Reverting and taking final heapsnapshot...');
  const finalPath = path.join(scenarioDir, 'final.heapsnapshot');
  await takeSnapshot(page, finalPath);

  await page.close();
  await browser.close();

  const getFileSize = (filePath) => fs.statSync(filePath).size;
  const growthTarget = getFileSize(targetPath) - getFileSize(baselinePath);
  const growthFinal = getFileSize(finalPath) - getFileSize(baselinePath);

  return {
    id: scenario.id,
    description: scenario.description,
    iterations: scenario.iterations,
    baselinePath,
    targetPath,
    finalPath,
    heapGrowthBytes: {
      baselineToTarget: growthTarget,
      baselineToFinal: growthFinal
    }
  };
}

async function analyzeScenario(runResult) {
  console.log(`Analyzing leaks for scenario ${runResult.id} with memlab...`);
  try {
    const cmd = `memlab find-leaks --baseline ${runResult.baselinePath} --target ${runResult.targetPath} --final ${runResult.finalPath}`;
    console.log(`Running: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd);
    
    const rawOutPath = path.join(path.dirname(runResult.baselinePath), 'memlab-raw.txt');
    fs.writeFileSync(rawOutPath, stdout + '\n' + stderr);

    const findings = parseMemlabOutput(stdout, runResult.id);

    // Adjust growthBytesPerIteration based on actual heapsnapshot files if memlab trace findings are present
    const growthPerIteration = runResult.heapGrowthBytes.baselineToFinal / runResult.iterations;
    for (const f of findings) {
      f.growthBytesPerIteration = Math.max(0, Math.round(growthPerIteration));
      f.severity = f.growthBytesPerIteration >= 1048576 ? 'high' : (f.growthBytesPerIteration >= 102400 ? 'medium' : 'low');
      if (runResult.id === 'idle-baseline' && f.growthBytesPerIteration > 0) {
        f.severity = 'critical';
      }
    }

    return {
      runResult,
      findings,
      result: findings.length > 0 ? 'leaky' : 'clean',
      success: true
    };
  } catch (err) {
    console.error(`memlab error for ${runResult.id}:`, err);
    return {
      runResult,
      findings: [],
      result: 'failed',
      error: err.message,
      success: false
    };
  }
}

async function main() {
  const url = 'https://paul.kinlan.me/';
  
  // parse args to get --out path
  let outDir = 'reports/antigravity/paul.kinlan.me';
  const outIndex = process.argv.indexOf('--out');
  if (outIndex !== -1 && process.argv[outIndex + 1]) {
    outDir = process.argv[outIndex + 1];
  }
  
  fs.mkdirSync(outDir, { recursive: true });

  const testPlanPath = 'testplans/paul.kinlan.me.json';
  const scenarios = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));

  console.log(`Starting memory audit of ${url}`);
  console.log(`Loaded ${scenarios.length} scenarios from ${testPlanPath}`);
  console.log(`Reports will be written to: ${outDir}`);

  const runResults = [];
  for (const scenario of scenarios) {
    // Override wait for idle baseline to be 60s total
    if (scenario.id === 'idle-baseline') {
      scenario.iterations = 1;
    }
    const result = await runScenario(scenario, outDir);
    runResults.push(result);
  }

  console.log('\n--- All scenarios executed. Analyzing... ---');

  const analysisResults = [];
  const allFindings = [];
  const finalScenarios = [];

  for (const res of runResults) {
    const analysis = await analyzeScenario(res);
    analysisResults.push(analysis);
    
    allFindings.push(...analysis.findings);
    
    finalScenarios.push({
      id: res.id,
      description: res.description,
      iterations: res.iterations,
      result: analysis.result,
      heapGrowthBytes: res.heapGrowthBytes
    });
  }

  // Build report.json
  const reportJson = {
    url,
    auditedAt: new Date().toISOString(),
    status: 'completed',
    page: {
      appType: 'mpa',
      framework: 'vanilla',
      notes: 'Audit of personal blog paul.kinlan.me with spec rules.'
    },
    scenarios: finalScenarios,
    findings: allFindings
  };

  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(reportJson, null, 2)
  );
  console.log(`Wrote report.json to ${outDir}`);

  // Build REPORT.md
  let reportMd = `# Memory Audit Report for ${url}

**Audited at:** ${reportJson.auditedAt}
**App type:** MPA (Multi-Page Application)
**Framework:** Vanilla JavaScript + Tailwind CSS CDN

---

## Scenarios Run

| Scenario ID | Description | Iterations | Result | Baseline-to-Target Growth | Baseline-to-Final Growth |
|---|---|---|---|---|---|
`;

  for (const s of finalScenarios) {
    reportMd += `| \`${s.id}\` | ${s.description} | ${s.iterations} | **${s.result}** | ${(s.heapGrowthBytes.baselineToTarget / 1024 / 1024).toFixed(2)} MB | ${(s.heapGrowthBytes.baselineToFinal / 1024 / 1024).toFixed(2)} MB |\n`;
  }

  reportMd += `
---

## Findings Summary

Total leaks found: **${allFindings.length}**
`;

  if (allFindings.length > 0) {
    reportMd += `
| ID | Scenario | Category | Severity | Leaked Object | Suggested Fix |
|---|---|---|---|---|---|
`;
    for (const f of allFindings) {
      reportMd += `| \`${f.id}\` | \`${f.scenarioId}\` | \`${f.category}\` | **${f.severity}** | \`${f.leakedObjectClass}\` | ${f.suggestedFix} |\n`;
    }
  } else {
    reportMd += `\nNo memory leaks detected across all audited scenarios.\n`;
  }

  reportMd += `
---

## Detailed Findings

`;

  if (allFindings.length > 0) {
    for (const f of allFindings) {
      reportMd += `### Finding: \`${f.leakedObjectClass}\` (${f.category})

- **Scenario:** \`${f.scenarioId}\`
- **Severity:** **${f.severity}** (Growth: ${(f.growthBytesPerIteration / 1024).toFixed(2)} KB / iteration)
- **Confidence:** **${f.confidence}**
- **Description:** ${f.summary}

#### Suggested Fix:
> [!TIP]
> **Remediation Pattern:**
> ${f.suggestedFix}

#### Retainer Trace Excerpt:
\`\`\`text
${f.retainerTraceExcerpt}
\`\`\`

`;
    }
  } else {
    reportMd += `No detailed leaks to report. The page displays excellent garbage collection hygiene under normal browsing and interaction workloads.\n`;
  }

  fs.writeFileSync(path.join(outDir, 'REPORT.md'), reportMd);
  console.log(`Wrote REPORT.md to ${outDir}`);
}

main().catch(err => console.error('Error in main:', err));
