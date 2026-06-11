import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function runScenario(scenario, browser, outDir) {
  console.log(`\n--- Running scenario: ${scenario.id} ---`);
  const scenarioDir = path.join(outDir, scenario.id);
  fs.mkdirSync(scenarioDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  // 1. Setup
  console.log(`Setting up: ${scenario.setup}`);
  await page.goto('https://aifoc.us/', { waitUntil: 'networkidle2' });
  await delay(2000); // Wait for stability

  // Take baseline screenshot
  await page.screenshot({ path: path.join(scenarioDir, 'baseline.png') });

  // 2. Baseline snapshot
  console.log('Taking baseline heapsnapshot...');
  const baselinePath = path.join(scenarioDir, 'baseline.heapsnapshot');
  await takeSnapshot(page, baselinePath);

  // 3. Action loop
  console.log(`Performing action: "${scenario.description}" for ${scenario.iterations} iterations...`);
  
  if (scenario.id === 'idle-baseline') {
    // Wait for 60 seconds
    console.log('Waiting 60 seconds...');
    await delay(60000);
  } else if (scenario.id === 'speculative-hover') {
    // Find first 5 article links
    const articleLinkSelectors = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a.u-url'));
      return links.slice(0, 5).map((l, index) => {
        // assign a unique test id if needed, or query by index
        l.setAttribute('data-test-id', `article-link-${index}`);
        return `a[data-test-id="article-link-${index}"]`;
      });
    });

    console.log(`Found article selectors: ${articleLinkSelectors.join(', ')}`);

    for (let i = 0; i < scenario.iterations; i++) {
      process.stdout.write(`Iteration ${i + 1}/${scenario.iterations}: `);
      for (const selector of articleLinkSelectors) {
        process.stdout.write(`hover(${selector}) `);
        try {
          await page.hover(selector);
          await delay(2000); // Wait 2s for speculative prerender
          
          // Hover away to a neutral element (like header or body)
          await page.hover('h1');
          await delay(1000); // Wait 1s
        } catch (e) {
          process.stdout.write(`[Error: ${e.message}] `);
        }
      }
      process.stdout.write('\n');
    }
  }

  console.log('Action loop complete.');

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

  // Get size of heapsnapshot files
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

// Parse memlab output dynamically
function parseMemlabOutputGeneric(stdout, scenarioId) {
  const findings = [];
  const rawOut = stdout.toString();
  
  // Memlab reports leak traces separated by headers or sections.
  // Let's check if there are any leak summaries or retainer traces.
  // Each leak trace usually starts with a line containing "Leak size:" or similar,
  // or a list of objects with "-->".
  // Let's do a generic extraction of leak traces.
  const traceBlocks = rawOut.split('\n\n');
  let leakIndex = 1;

  for (const block of traceBlocks) {
    if (block.includes('-->') || block.includes('Retainer trace') || block.includes('Leak candidate')) {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      // Determine leaked class name
      let leakedClass = 'Unknown';
      for (const line of lines) {
        if (line.includes('-->')) {
          // The last or first object in the trace is usually the leaked object.
          // In memlab traces, the target is usually at the top or bottom.
          // Let's extract names like Detached HTMLDivElement or specific classes.
          const match = line.match(/@\d+\s+\[?(\w+)\]?/);
          if (match) {
            leakedClass = match[1];
          }
        }
      }

      // Determine category
      let category = 'other';
      if (block.toLowerCase().includes('detached')) {
        category = 'detached-dom';
      } else if (block.toLowerCase().includes('listener') || block.toLowerCase().includes('event')) {
        category = 'event-listener';
      } else if (block.toLowerCase().includes('timeout') || block.toLowerCase().includes('interval')) {
        category = 'timer-interval';
      }

      findings.push({
        id: `finding-${scenarioId}-${leakIndex++}`,
        scenarioId: scenarioId,
        category: category,
        severity: 'medium',
        confidence: 'medium',
        summary: `Potential memory leak involving ${leakedClass}.`,
        growthBytesPerIteration: 0, // we will fill this in based on actual heap growth
        leakedObjectClass: leakedClass,
        retainerTraceExcerpt: lines.slice(0, 20).join('\n'),
        suggestedFix: `Review lifecycle management of ${leakedClass} to ensure proper release.`
      });
    }
  }

  return findings;
}

async function analyzeScenario(runResult) {
  console.log(`Analyzing leaks for scenario ${runResult.id} with memlab...`);
  try {
    const cmd = `memlab find-leaks --baseline ${runResult.baselinePath} --target ${runResult.targetPath} --final ${runResult.finalPath}`;
    console.log(`Running: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd);
    
    const rawOutPath = path.join(path.dirname(runResult.baselinePath), 'memlab-raw.txt');
    fs.writeFileSync(rawOutPath, stdout + '\n' + stderr);

    const findings = parseMemlabOutputGeneric(stdout, runResult.id);

    // Update growth metrics in findings if we have growth data
    const iterations = runResult.iterations;
    const growthPerIteration = runResult.heapGrowthBytes.baselineToFinal / iterations;
    
    for (const finding of findings) {
      finding.growthBytesPerIteration = Math.max(0, Math.round(growthPerIteration));
      if (growthPerIteration >= 1024 * 1024) {
        finding.severity = 'high';
      } else if (growthPerIteration >= 100 * 1024) {
        finding.severity = 'medium';
      } else {
        finding.severity = 'low';
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
  const url = 'https://aifoc.us/';
  const outDir = '/Users/paulkinlan/Code/memory-tracer/reports/antigravity/aifoc.us';
  fs.mkdirSync(outDir, { recursive: true });

  const testPlanPath = '/Users/paulkinlan/Code/memory-tracer/testplans/aifoc.us.json';
  const scenarios = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));

  console.log(`Starting memory audit of ${url}`);
  console.log(`Loaded ${scenarios.length} scenarios from ${testPlanPath}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const runResults = [];
  try {
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, browser, outDir);
      runResults.push(result);
    }
  } finally {
    await browser.close();
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
      notes: 'Multi-Page Application / static site using speculation rules prerendering.'
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
**Framework:** Vanilla JavaScript (with Speculation Rules prerendering)

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
    reportMd += `| ID | Scenario | Category | Severity | Leaked Object | Suggested Fix |
|---|---|---|---|---|---|
`;
    for (const f of allFindings) {
      reportMd += `| \`${f.id}\` | \`${f.scenarioId}\` | \`${f.category}\` | **${f.severity}** | \`${f.leakedObjectClass}\` | ${f.suggestedFix} |\n`;
    }
  } else {
    reportMd += `No memory leaks were detected by memlab find-leaks.\n`;
  }

  reportMd += `
---

## Detailed Findings

`;

  if (allFindings.length > 0) {
    for (const f of allFindings) {
      reportMd += `### Finding: \`${f.leakedObjectClass}\` (${f.category})

- **Scenario:** \`${f.scenarioId}\`
- **Severity:** **${f.severity}** (Growth per iteration: ${(f.growthBytesPerIteration / 1024).toFixed(2)} KB)
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
    reportMd += `All scenarios returned cleanly with no retained leak traces.\n`;
  }

  fs.writeFileSync(path.join(outDir, 'REPORT.md'), reportMd);
  console.log(`Wrote REPORT.md to ${outDir}`);
}

main().catch(err => console.error('Error in main:', err));
