import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { runInNewContext } from 'node:vm'
import { apply } from '../index.js'

export function planInput() {
  return {
    operation: 'init-plan',
    introduction: 'DSH service contract compatibility check',
    finalObjective: {
      description: 'Validate useful model quality',
      metrics: [{ key: 'accuracy', operator: '>=', targetValue: 0.8 }],
      deliverables: [{ name: 'model', acceptance: 'Loadable and evaluated' }],
    },
    phases: [{
      id: 'prepare',
      actionTitle: 'Validate dataset',
      what: 'Measure usable input coverage',
      purpose: 'Provide valid training input',
      deadlineAt: '2099-01-01T10:00:00+08:00',
      status: 'pending',
      metrics: [{
        key: 'coverage', value: 0, operator: '>=', targetValue: 95, kind: 'quality',
        measurement: 'valid / total', limitations: 'Does not measure labels',
        thresholdBasis: { type: 'requirement', evidence: 'Test contract', reason: 'Minimum coverage' },
      }],
      deliverables: [{ name: 'dataset', required: true, acceptance: 'Readable', status: 'pending' }],
      metricResearch: {
        questions: ['Is the dataset usable?'],
        sources: [{ title: 'Contract', location: 'Test', finding: 'Coverage at least 95%' }],
        candidateMetrics: [{ key: 'coverage', rationale: 'Usable records', measurement: 'valid / total', limitations: 'No label audit' }],
        selectedMetrics: ['coverage'],
        selectionReason: 'Gates downstream input quality',
      },
      objectiveContribution: {
        finalObjectiveKeys: ['accuracy'], mechanism: 'Usable input supports learning',
        evidenceLevel: 'hypothesis', impactEstimate: null, uncertainty: 'Needs evaluation',
        validationPlan: 'Evaluate model', riskIfMissed: 'Incomplete input',
      },
      executionPlan: {
        estimatedMinutes: 10, parallelizable: false, shardable: false,
        serialReason: 'Single local validation pass',
        resourceDiscovery: { queriedAt: '2099-01-01T08:00:00+08:00', servers: [] },
        resources: [],
      },
    }],
  }
}

test('progress panel renders initial, reduced and missing checkpoint schedules', async (suite) => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let definition
  runInNewContext(source, { window: { __ModuleLoader__: { load(value) { definition = value } } }, console })
  const plan = planInput()
  let dashboard
  const react = {
    createElement(type, props, ...children) { return typeof type === 'function' ? type(props || {}) : { type, props, children } },
    useState() { return [{ status: 'loaded', plan: { schemaVersion: 2, finalObjective: plan.finalObjective, timeline: plan.phases } }, () => {}] },
    useEffect() {},
  }
  const client = definition.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  client.apply({
    effect() {},
    slots: {
      inject(_slot, callback) { callback() },
      register(_entry, component) { dashboard = component },
    },
  })
  const cases = [
    ['initial', [{ kind: '5min', minutes: 5 }, { kind: '50%', minutes: 30 }, { kind: '75%', minutes: 45 }], '75% · 45min'],
    ['reestimated', [{ kind: '50%', minutes: 22.5 }, { kind: '100%', minutes: 45 }], '100% · 45min'],
    ['missing', undefined, '检查点：未记录'],
    ['empty', [], '检查点：未记录'],
  ]
  for (const [name, checkpoints, expected] of cases) {
    await suite.test(name, () => {
      const execution = plan.phases[0].executionPlan
      if (checkpoints === undefined) delete execution.checkpoints
      else execution.checkpoints = checkpoints
      execution.harvestAtMinutes = 60
      const rendered = JSON.stringify(dashboard({ sessionId: 'compat-session' }))
      assert.ok(rendered.includes(expected), rendered)
      assert.ok(rendered.includes('Validate dataset'))
    })
  }
})

test('DSH service contract storage, tool lifecycle and HTTP compatibility', async (suite) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-progress-compat-'))
  const previousHome = process.env.DSH_HOME
  const previousCwd = process.env.DSH_CWD
  const disposers = []
  let tool
  let route
  let registered = false
  let server
  process.env.DSH_HOME = root
  process.env.DSH_CWD = join(root, 'unrelated-launcher')
  const context = {
    effect(factory) {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
    webServer: { register(value) { route = value; return () => {} } },
    tools: {
      register(value) {
        assert.equal(registered, false)
        registered = true
        tool = value
        return () => { registered = false }
      },
    },
    agents: { currentInitiator() { return { id: 'compat-session' } } },
  }
  try {
    apply(context)
    server = createServer((request, response) => route.handler(request, response))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const endpoint = `http://127.0.0.1:${server.address().port}/api/progress-target`
    const filename = join(root, '.progress-target', 'compat-session.json')

    await suite.test('initializes v2 from the model-visible phases array without phase_id', async () => {
      const result = await tool.execute(planInput())
      assert.equal(result.success, true, result.warning)
      const plan = JSON.parse(await readFile(filename, 'utf8'))
      assert.equal(plan.schemaVersion, 2)
      assert.equal(plan.timeline[0].status, 'pending')
      assert.equal(plan.timeline[0].id, 'prepare')
    })
    await suite.test('keeps data in activation home after environment changes', async () => {
      process.env.DSH_CWD = join(root, 'other-project')
      process.env.DSH_HOME = join(root, 'other-home')
      const result = await tool.execute({ phase_id: 'prepare', introduction: 'Updated from tool' })
      assert.equal(result.success, true, result.warning)
      assert.equal(JSON.parse(await readFile(filename, 'utf8')).introduction, 'Updated from tool')
    })
    await suite.test('refuses repeated initialization without overwriting the existing plan', async () => {
      const before = await readFile(filename, 'utf8')
      assert.equal((await tool.execute(planInput())).success, false)
      assert.equal(await readFile(filename, 'utf8'), before)
    })
    await suite.test('reads tool data through HTTP and persists HTTP updates', async () => {
      const response = await fetch(`${endpoint}?sessionId=compat-session`)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).introduction, 'Updated from tool')
      const update = await fetch(`${endpoint}?sessionId=compat-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase_id: 'prepare', introduction: 'Updated from HTTP' }),
      })
      assert.equal(update.status, 200, await update.text())
      assert.equal(JSON.parse(await readFile(filename, 'utf8')).introduction, 'Updated from HTTP')
    })
    await suite.test('initializes another plan through HTTP using the same contract', async () => {
      const response = await fetch(`${endpoint}?sessionId=http-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(planInput()),
      })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).schemaVersion, 2)
    })
    await suite.test('preserves v1 plans and refuses unauthorized migration', async () => {
      const legacyPath = join(root, '.progress-target', 'legacy.json')
      const legacy = JSON.stringify({ introduction: 'Legacy plan', timeline: [{ id: 'done', status: 'completed' }] })
      await writeFile(legacyPath, legacy)
      const response = await fetch(`${endpoint}?sessionId=legacy`)
      assert.equal((await response.json()).introduction, 'Legacy plan')
      const result = await tool.execute({ ...planInput(), sessionId: 'legacy', operation: 'migrate-plan' })
      assert.equal(result.success, false)
      assert.equal(await readFile(legacyPath, 'utf8'), legacy)
    })
    await suite.test('refuses corrupt plans and path traversal', async () => {
      const corruptPath = join(root, '.progress-target', 'corrupt.json')
      await writeFile(corruptPath, '{broken')
      assert.equal((await tool.execute({ ...planInput(), sessionId: 'corrupt' })).success, false)
      assert.equal(await readFile(corruptPath, 'utf8'), '{broken')
      assert.equal((await tool.execute({ ...planInput(), sessionId: '../outside' })).success, false)
    })
    await suite.test('unloads and re-registers the tool without duplicate registrations', async () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      assert.equal(registered, false)
      process.env.DSH_HOME = root
      apply(context)
      assert.equal(registered, true)
    })
    await suite.test('supports an explicit absolute data directory', async () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      const dataDir = join(root, 'explicit-data')
      await mkdir(dataDir)
      apply(context, { dataDir })
      assert.equal((await tool.execute(planInput())).success, true)
      assert.equal(JSON.parse(await readFile(join(dataDir, 'compat-session.json'), 'utf8')).schemaVersion, 2)
    })
  } finally {
    if (server) await new Promise((done) => server.close(done))
    for (const dispose of disposers.reverse()) dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousCwd === undefined) delete process.env.DSH_CWD
    else process.env.DSH_CWD = previousCwd
    assert.equal(dirname(root), resolve(tmpdir()))
    await rm(root, { recursive: true, force: true })
  }
})
