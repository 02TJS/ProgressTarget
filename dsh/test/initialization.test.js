import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { EventEmitter } from 'node:events'
// Optional file URL verifies the exact installed module without restarting the Host.
const { apply } = await import(process.env.PROGRESS_TARGET_TEST_MODULE || '../index.js')

const research = { questions: ['Does the stored plan match the contract?'], sources: [{ title: 'User requirement', location: 'init-plan regression', finding: 'Two structured pending phases must persist as v2' }], candidateMetrics: [{ key: 'contract-pass-rate', rationale: 'Directly measures the requested interface', measurement: 'Passed contract assertions / all assertions', limitations: 'Does not measure experiment quality' }], selectedMetrics: ['contract-pass-rate'], selectionReason: 'Direct acceptance test' }
const metric = { key: 'contract-pass-rate', value: 0, operator: '==', targetValue: 1, kind: 'quality', measurement: 'Passed contract assertions / all assertions', limitations: 'Only covers this contract', thresholdBasis: { type: 'requirement', evidence: 'User requested correct initialization', reason: 'Every assertion must pass' } }
export function fixture() {
  const phase = id => ({ id, actionTitle: id, timeline: 'One minute', what: 'Check interface', purpose: 'Ensure usable persisted plan', status: 'pending', deadlineAt: '2099-01-01T12:00:00+08:00', metrics: [structuredClone(metric)], metricResearch: structuredClone(research), objectiveContribution: { finalObjectiveKeys: ['contract-pass-rate'], mechanism: 'Directly validates persistence', evidenceLevel: 'hypothesis', impactEstimate: null, uncertainty: 'Not yet run', validationPlan: 'Read persisted plan', riskIfMissed: 'Invalid plan' }, deliverables: [{ name: 'usable-plan', required: true, acceptance: 'Two pending phase objects', status: 'pending' }], executionPlan: { estimatedMinutes: 1, parallelizable: false, shardable: false, serialReason: 'Sequential lifecycle', shardReason: 'Single storage file', resourceDiscovery: { queriedAt: '2026-09-03T14:00:00+08:00', servers: [] }, resources: [{ id: 'test', work: 'Validate plan', resource: 'CPU', expectedDeliverable: 'Usable plan', status: 'planned' }] } })
  return { operation: 'init-plan', introduction: 'Isolated initialization test, no experiments', finalObjective: { description: 'Correct plan persistence', metrics: [{ key: 'contract-pass-rate', operator: '==', targetValue: 1 }], deliverables: [{ name: 'usable-plan', acceptance: 'Structured v2 plan' }] }, phases: [phase('contract-check'), phase('storage-check')] }
}

test('Tool and API share safe full-plan initialization', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'progress-target-test-'))
  const dataDir = join(temp, 'plans')
  let tool, route
  apply({ effect: fn => fn(), webServer: { register: x => { route = x; return () => {} } }, tools: { register: x => { tool = x } }, agents: { currentInitiator: () => ({ id: 'tool-test' }) } }, { dataDir: relative(process.env.DSH_CWD || process.cwd(), dataDir) })
  const file = id => join(dataDir, id + '.json')
  async function http(id, body) {
    const req = new EventEmitter(); req.url = '/api/progress-target?sessionId=' + id; req.method = body ? 'POST' : 'GET'
    let status, result
    const p = route.handler(req, { writeHead: code => { status = code }, end: text => { result = JSON.parse(text) } })
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end') }
    await p; return { status, result }
  }
  try {
    assert.equal(tool.parameters.properties.phases.type, 'array')
    assert.equal(tool.parameters.properties.timeline.type, 'string')
    assert.ok(!tool.parameters.required.includes('phase_id'))
    const created = await tool.execute(fixture()); assert.equal(created.success, true, created.warning)
    const plan = JSON.parse(await readFile(file('tool-test'), 'utf8'))
    assert.equal(plan.schemaVersion, 2); assert.equal(plan.timeline.length, 2)
    assert.deepEqual(plan.timeline.map(p => p.status), ['pending', 'pending'])
    assert.deepEqual(plan.timeline.map(p => p.id), ['contract-check', 'storage-check'])
    assert.ok(plan.timeline.every(p => typeof p.timeline === 'string' && !p.startedAt && !p.completedAt))
    assert.ok(plan.createdAt.endsWith('+08:00'))
    assert.equal((await http('api-test', fixture())).status, 200)
    assert.equal((await http('api-test')).result.schemaVersion, 2)
    const compatibility = fixture(); compatibility.timeline = compatibility.phases; delete compatibility.phases
    assert.equal((await http('legacy-array', compatibility)).status, 200)
    for (const id of ['tool-test', 'api-test']) {
      const before = await readFile(file(id), 'utf8')
      const result = id === 'tool-test' ? await tool.execute(fixture()) : (await http(id, fixture())).result
      assert.ok(result.success === false || result.error)
      assert.equal(await readFile(file(id), 'utf8'), before)
    }
    for (const [name, mutate] of [
      ['text-array', b => { b.timeline = JSON.stringify(b.phases); delete b.phases }],
      ['no-objective', b => { delete b.finalObjective }],
      ['duplicates', b => { b.phases[1].id = b.phases[0].id }],
      ['missing-research', b => { delete b.phases[0].metricResearch }],
      ['started', b => { b.phases[0].status = 'in-progress' }],
      ['wrong-operation', b => { b.operation = 'init-plann' }],
      ['accidental-update', b => { b.operation = 'update-phase'; b.phase_id = 'draft' }],
    ]) {
      const body = fixture(); body.sessionId = name; mutate(body)
      assert.equal((await tool.execute(body)).success, false, name)
      await assert.rejects(readFile(file(name)), { code: 'ENOENT' })
      assert.equal((await http('http-' + name, body)).status, 400, name)
    }
    const legacy = { introduction: 'Old plan', createdAt: '2026-01-01T00:00:00Z', timeline: plan.timeline.map(p => ({ ...p, metrics: p.metrics.map(({ kind, measurement, limitations, thresholdBasis, ...m }) => m) })) }
    legacy.timeline[0].status = 'completed'; legacy.timeline[0].completedAt = '2026-01-02T00:00:00Z'
    await writeFile(file('legacy'), JSON.stringify(legacy))
    const bytes = await readFile(file('legacy'), 'utf8')
    assert.equal((await tool.execute({ ...fixture(), sessionId: 'legacy' })).success, false)
    assert.equal(await readFile(file('legacy'), 'utf8'), bytes)
    await writeFile(file('empty-history'), JSON.stringify({ timeline: [], deletionAudit: [{ reason: 'Historical deletion' }] }))
    const emptyBefore = await readFile(file('empty-history'), 'utf8')
    assert.equal((await tool.execute({ ...fixture(), sessionId: 'empty-history' })).success, false)
    assert.equal(await readFile(file('empty-history'), 'utf8'), emptyBefore)
    const migrate = { ...fixture(), operation: 'migrate-plan', sessionId: 'legacy', migrationReason: 'Test explicit migration', phases: legacy.timeline.map(p => ({ id: p.id, metrics: fixture().phases[0].metrics, metricResearch: research, objectiveContribution: fixture().phases[0].objectiveContribution })) }
    assert.equal((await tool.execute(migrate)).success, false)
    const migrated = await tool.execute({ ...migrate, userAuthorizedMigration: true }); assert.equal(migrated.success, true, migrated.warning)
    const migratedPlan = JSON.parse(await readFile(file('legacy'), 'utf8'))
    assert.equal(migratedPlan.schemaVersion, 2)
    assert.equal(migratedPlan.timeline[0].status, 'completed')
    assert.equal(migratedPlan.timeline[0].completedAt, '2026-01-02T00:00:00Z')
    await writeFile(file('corrupt'), '{broken')
    assert.equal((await tool.execute({ ...fixture(), sessionId: 'corrupt' })).success, false)
    assert.equal(await readFile(file('corrupt'), 'utf8'), '{broken')
    assert.equal((await tool.execute({ phase_id: 'draft', sessionId: 'absent' })).success, false)
    assert.equal((await tool.execute({ operation: 'delete-plan', sessionId: 'tool-test' })).success, false)
    assert.equal((await tool.execute({ operation: 'delete-plan', sessionId: 'tool-test', userAuthorizedDeletion: true, deletionReason: 'Remove isolated test' })).success, true)
    await assert.rejects(readFile(file('tool-test')), { code: 'ENOENT' })
    assert.equal((await http('api-test')).result.schemaVersion, 2)
    const concurrent = await Promise.all([tool.execute({ ...fixture(), sessionId: 'race' }), tool.execute({ ...fixture(), sessionId: 'race' })])
    assert.equal(concurrent.filter(r => r.success).length, 1)
    assert.equal(JSON.parse(await readFile(file('race'), 'utf8')).schemaVersion, 2)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
