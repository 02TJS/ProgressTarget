import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const inject = ['webServer', 'tools', 'agents']

const DEFAULT_DATA_DIR = '.progress-target'
const TERMINAL = new Set(['completed', 'overdue'])
const OPERATORS = new Set(['>=', '>', '<=', '<', '=='])
const DEFAULT_RESOURCE_DISCOVERY_MAX_AGE_MINUTES = 10

const EMPTY_PLAN = {
  introduction: '',
  createdAt: '',
  timeline: []
}

const EVIDENCE_LEVELS = new Set(['hypothesis', 'literature-supported', 'pilot-supported', 'validated'])
const THRESHOLD_BASIS_TYPES = new Set(['requirement', 'literature', 'historical-baseline', 'pilot-baseline', 'expert-judgment', 'adaptive'])
const TRIVIAL_METRIC_KEYS = /^(count|数量|个数|完成数|文件数|样本数|记录数|结果数|产物数)$/i

function nowIso() {
  return new Date().toISOString()
}

function makePhase(id, at = nowIso()) {
  return {
    id,
    pLabel: id,
    actionTitle: '',
    timeline: '',
    what: '',
    purpose: '',
    createdAt: at,
    startedAt: '',
    deadlineAt: '',
    completedAt: '',
    attempts: [],
    metrics: [],
    gatePassed: false,
    deliverables: [],
    deliverablesReady: false,
    deadlineBreached: false,
    executionPlan: null,
    resourceDiscoveryHistory: [],
    result: '',
    status: 'pending',
    progress: 0,
    overdue: false,
  }
}

function normalizeConfig(value) {
  const config = value && typeof value === 'object' ? value : {}
  const requiredServers = Array.isArray(config.requiredServers)
    ? [...new Set(config.requiredServers.map(item => String(item).trim()).filter(Boolean))]
    : []
  const maxAgeMinutes = config.resourceDiscoveryMaxAgeMinutes === undefined
    ? DEFAULT_RESOURCE_DISCOVERY_MAX_AGE_MINUTES
    : Number(config.resourceDiscoveryMaxAgeMinutes)
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) throw new Error('resourceDiscoveryMaxAgeMinutes 必须是正数')
  const dataDir = config.dataDir === undefined ? DEFAULT_DATA_DIR : requiredText(config.dataDir, 'dataDir')
  return {
    requiredServers,
    maxAgeMinutes,
    maxAgeMs: maxAgeMinutes * 60 * 1000,
    dataDir,
  }
}

function getBaseDir(settings) {
  return join(process.env.DSH_CWD || process.cwd(), settings.dataDir)
}

function getDataPath(sessionId, settings) {
  return join(getBaseDir(settings), sessionId + '.json')
}

async function loadPlan(sessionId, settings) {
  const path = getDataPath(sessionId, settings)
  try {
    if (existsSync(path)) return JSON.parse(await readFile(path, 'utf-8'))
  } catch (e) { /* fall through */ }
  return null
}

async function savePlan(sessionId, plan, settings) {
  const path = getDataPath(sessionId, settings)
  const dir = dirname(path)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify(plan, null, 2), 'utf-8')
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

function parseUrl(url) {
  return new URL(url, 'http://localhost')
}

function requiredText(value, name) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) throw new Error(name + ' 不能为空')
  return text
}

function optionalIso(value, name) {
  if (value === undefined) return undefined
  const text = requiredText(value, name)
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) throw new Error(name + ' 必须是 ISO 8601 时间')
  return new Date(ms).toISOString()
}

function normalizeFinalObjective(value) {
  if (!value || typeof value !== 'object') throw new Error('v2 新计划必须设置 finalObjective')
  const metrics = Array.isArray(value.metrics) ? value.metrics.map((metric, index) => ({
    key: requiredText(metric && metric.key, 'finalObjective.metrics[' + index + '].key'),
    operator: requiredText(metric && metric.operator, 'finalObjective.metrics[' + index + '].operator'),
    targetValue: Number(metric && metric.targetValue),
    unit: metric && metric.unit !== undefined ? String(metric.unit) : '',
  })) : []
  if (!metrics.length) throw new Error('finalObjective 至少需要一个结构化最终指标')
  for (const metric of metrics) {
    if (!OPERATORS.has(metric.operator) || !Number.isFinite(metric.targetValue)) throw new Error('finalObjective metric 的 operator/targetValue 无效')
  }
  if (new Set(metrics.map(metric => metric.key)).size !== metrics.length) throw new Error('finalObjective.metrics.key 必须唯一')
  const deliverables = Array.isArray(value.deliverables) ? value.deliverables.map((item, index) => ({
    name: requiredText(item && item.name, 'finalObjective.deliverables[' + index + '].name'),
    acceptance: requiredText(item && item.acceptance, 'finalObjective.deliverables[' + index + '].acceptance'),
  })) : []
  if (!deliverables.length) throw new Error('finalObjective 至少需要一个最终交付物')
  return { description: requiredText(value.description, 'finalObjective.description'), metrics, deliverables }
}

function normalizeThresholdBasis(value, metricKey) {
  if (!value || typeof value !== 'object') throw new Error(metricKey + ' 必须设置 thresholdBasis')
  const type = requiredText(value.type, metricKey + '.thresholdBasis.type')
  if (!THRESHOLD_BASIS_TYPES.has(type)) throw new Error(metricKey + '.thresholdBasis.type 无效')
  return { type, evidence: requiredText(value.evidence, metricKey + '.thresholdBasis.evidence'), reason: requiredText(value.reason, metricKey + '.thresholdBasis.reason') }
}

function normalizeMetric(metric, options = {}) {
  const key = requiredText(metric && metric.key, 'metrics.key')
  const operator = requiredText(metric && metric.operator, 'metrics.operator')
  if (!OPERATORS.has(operator)) throw new Error('metrics.operator 必须是 >=、>、<=、< 或 ==')
  const value = Number(metric && metric.value)
  const targetValue = Number(metric && metric.targetValue)
  if (!Number.isFinite(value)) throw new Error('metrics.value 必须是数值')
  if (!Number.isFinite(targetValue)) throw new Error('metrics.targetValue 必须是数值')
  const result = {
    key,
    value,
    operator,
    targetValue,
    unit: metric.unit === undefined ? '' : String(metric.unit),
  }
  if (options.v2) {
    result.kind = requiredText(metric.kind, key + '.kind')
    if (!['quality', 'process', 'final'].includes(result.kind)) throw new Error(key + '.kind 必须是 quality、process 或 final')
    result.measurement = requiredText(metric.measurement, key + '.measurement')
    result.limitations = requiredText(metric.limitations, key + '.limitations')
    result.thresholdBasis = normalizeThresholdBasis(metric.thresholdBasis, key)
    const trivialPositive = result.kind !== 'process' && result.targetValue === 0 && ['>', '>='].includes(result.operator)
    if (trivialPositive && (TRIVIAL_METRIC_KEYS.test(key) || /存在|非空|生成|完成|成功/.test(result.measurement))) {
      throw new Error(key + ' 使用了无效的“>0/≥0”存在性目标；请设置能区分质量好坏、与最终目标相关且有依据的阈值')
    }
    if (result.kind !== 'process' && result.thresholdBasis.type === 'adaptive') {
      throw new Error(key + ' 的 adaptive 阈值尚未冻结；请先完成调研/pilot并更新为有证据的正式阈值，再进入正式阶段')
    }
  }
  return result
}

function normalizeMetricResearch(value) {
  if (!value || typeof value !== 'object') throw new Error('v2 阶段必须包含 metricResearch')
  const questions = Array.isArray(value.questions) ? value.questions.map((item, index) => requiredText(item, 'metricResearch.questions[' + index + ']')) : []
  const sources = Array.isArray(value.sources) ? value.sources.map((item, index) => ({
    title: requiredText(item && item.title, 'metricResearch.sources[' + index + '].title'),
    location: requiredText(item && item.location, 'metricResearch.sources[' + index + '].location'),
    finding: requiredText(item && item.finding, 'metricResearch.sources[' + index + '].finding'),
  })) : []
  const candidates = Array.isArray(value.candidateMetrics) ? value.candidateMetrics.map((item, index) => ({
    key: requiredText(item && item.key, 'metricResearch.candidateMetrics[' + index + '].key'),
    rationale: requiredText(item && item.rationale, 'metricResearch.candidateMetrics[' + index + '].rationale'),
    measurement: requiredText(item && item.measurement, 'metricResearch.candidateMetrics[' + index + '].measurement'),
    limitations: requiredText(item && item.limitations, 'metricResearch.candidateMetrics[' + index + '].limitations'),
  })) : []
  const selectedMetrics = Array.isArray(value.selectedMetrics) ? value.selectedMetrics.map((item, index) => requiredText(item, 'metricResearch.selectedMetrics[' + index + ']')) : []
  if (!questions.length || !sources.length || !candidates.length || !selectedMetrics.length) throw new Error('metricResearch 必须包含问题、可追溯来源、候选指标和已选指标')
  const candidateKeys = new Set(candidates.map(item => item.key))
  const unknown = selectedMetrics.filter(key => !candidateKeys.has(key))
  if (unknown.length) throw new Error('selectedMetrics 必须来自 candidateMetrics；未知：' + unknown.join(', '))
  return { questions, sources, candidateMetrics: candidates, selectedMetrics, selectionReason: requiredText(value.selectionReason, 'metricResearch.selectionReason') }
}

function normalizeObjectiveContribution(value, finalObjective) {
  if (!value || typeof value !== 'object') throw new Error('v2 阶段必须包含 objectiveContribution')
  const finalObjectiveKeys = Array.isArray(value.finalObjectiveKeys) ? value.finalObjectiveKeys.map((item, index) => requiredText(item, 'objectiveContribution.finalObjectiveKeys[' + index + ']')) : []
  if (!finalObjectiveKeys.length) throw new Error('objectiveContribution 必须关联至少一个最终指标')
  const allowed = new Set(finalObjective.metrics.map(metric => metric.key))
  const unknown = finalObjectiveKeys.filter(key => !allowed.has(key))
  if (unknown.length) throw new Error('阶段关联了不存在的最终指标：' + unknown.join(', '))
  const evidenceLevel = requiredText(value.evidenceLevel, 'objectiveContribution.evidenceLevel')
  if (!EVIDENCE_LEVELS.has(evidenceLevel)) throw new Error('objectiveContribution.evidenceLevel 无效')
  return {
    finalObjectiveKeys,
    mechanism: requiredText(value.mechanism, 'objectiveContribution.mechanism'),
    evidenceLevel,
    impactEstimate: value.impactEstimate === undefined || value.impactEstimate === null ? null : String(value.impactEstimate),
    uncertainty: requiredText(value.uncertainty, 'objectiveContribution.uncertainty'),
    validationPlan: requiredText(value.validationPlan, 'objectiveContribution.validationPlan'),
    riskIfMissed: requiredText(value.riskIfMissed, 'objectiveContribution.riskIfMissed'),
  }
}

function metricPassed(metric) {
  if (metric.operator === '>=') return metric.value >= metric.targetValue
  if (metric.operator === '>') return metric.value > metric.targetValue
  if (metric.operator === '<=') return metric.value <= metric.targetValue
  if (metric.operator === '<') return metric.value < metric.targetValue
  return metric.value === metric.targetValue
}

function computeGate(metrics) {
  return Array.isArray(metrics) && metrics.length > 0 && metrics.every(metricPassed)
}

function normalizeDeliverable(value) {
  const name = requiredText(value && value.name, 'deliverables.name')
  const status = requiredText(value && value.status, 'deliverables.status')
  if (!['pending', 'ready'].includes(status)) throw new Error('deliverables.status 必须是 pending 或 ready')
  return {
    name,
    required: value.required === undefined ? true : Boolean(value.required),
    acceptance: requiredText(value.acceptance, 'deliverables.acceptance'),
    status,
    evidence: value.evidence === undefined ? '' : String(value.evidence).trim(),
  }
}

function computeDeliverablesReady(deliverables) {
  return Array.isArray(deliverables) && deliverables.length > 0 && deliverables
    .filter(item => item.required !== false)
    .every(item => item.status === 'ready' && Boolean(item.evidence))
}

function normalizeResourceDiscovery(value, settings) {
  if (!value || typeof value !== 'object') throw new Error('executionPlan.resourceDiscovery 必填；规划前必须查询全部已配置资源服务器')
  const queriedAt = optionalIso(value.queriedAt, 'executionPlan.resourceDiscovery.queriedAt')
  if (!queriedAt) throw new Error('executionPlan.resourceDiscovery.queriedAt 必填')
  const servers = Array.isArray(value.servers) ? value.servers.map((server, index) => {
    const name = requiredText(server && server.name, 'resourceDiscovery.servers[' + index + '].name')
    const status = requiredText(server && server.status, 'resourceDiscovery.servers[' + index + '].status')
    if (!['available', 'busy', 'unreachable', 'unknown'].includes(status)) throw new Error('resourceDiscovery.servers.status 无效')
    const availableGpus = Number(server && server.availableGpus)
    if (!Number.isInteger(availableGpus) || availableGpus < 0) throw new Error('resourceDiscovery.servers.availableGpus 必须是非负整数')
    return { name, status, availableGpus, evidence: requiredText(server && server.evidence, 'resourceDiscovery.servers[' + index + '].evidence') }
  }) : []
  if (!servers.length && settings.requiredServers.length) throw new Error('资源发现结果不能为空')
  const duplicates = servers.filter((server, index) => servers.findIndex(item => item.name === server.name) !== index)
  if (duplicates.length) throw new Error('资源发现包含重复服务器：' + [...new Set(duplicates.map(item => item.name))].join(', '))
  for (const name of settings.requiredServers) {
    if (!servers.some(server => server.name === name)) throw new Error('资源发现缺少已配置服务器 ' + name)
  }
  return { queriedAt, servers }
}

function validateFreshResourceDiscovery(discovery, at, earliestAt, previousQueriedAt, settings) {
  const queriedMs = Date.parse(discovery.queriedAt)
  const nowMs = Date.parse(at)
  if (queriedMs > nowMs + 60 * 1000) throw new Error('resourceDiscovery.queriedAt 不能晚于当前时间')
  if (nowMs - queriedMs > settings.maxAgeMs) throw new Error('资源发现已超过配置的新鲜度窗口（' + settings.maxAgeMinutes + '分钟）；阶段启动或重规划前必须重新查询全部已配置服务器')
  if (earliestAt && queriedMs <= Date.parse(earliestAt)) throw new Error('资源发现必须发生在上一阶段结束之后，不能复用上一阶段快照')
  if (previousQueriedAt && queriedMs <= Date.parse(previousQueriedAt)) throw new Error('本次资源发现必须晚于该阶段上一份快照；重规划时必须重新查询全部已配置服务器')
}

function normalizeExecutionPlan(value, settings) {
  if (!value || typeof value !== 'object') throw new Error('长时间阶段必须填写 executionPlan')
  const estimatedMinutes = Number(value.estimatedMinutes)
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) throw new Error('executionPlan.estimatedMinutes 必须是正数')
  const parallelizable = Boolean(value.parallelizable)
  const shardable = Boolean(value.shardable)
  const shardReason = value.shardReason === undefined ? '' : String(value.shardReason).trim()
  const serialReason = value.serialReason === undefined ? '' : String(value.serialReason).trim()
  const resourceDiscovery = normalizeResourceDiscovery(value.resourceDiscovery, settings)
  const resources = Array.isArray(value.resources) ? value.resources.map((resource, index) => ({
    id: requiredText(resource && resource.id, 'executionPlan.resources[' + index + '].id'),
    work: requiredText(resource && resource.work, 'executionPlan.resources[' + index + '].work'),
    resource: requiredText(resource && resource.resource, 'executionPlan.resources[' + index + '].resource'),
    server: resource.server === undefined ? '' : String(resource.server).trim(),
    shard: resource.shard === undefined ? '' : String(resource.shard).trim(),
    expectedDeliverable: requiredText(resource && resource.expectedDeliverable, 'executionPlan.resources[' + index + '].expectedDeliverable'),
    status: requiredText(resource && resource.status, 'executionPlan.resources[' + index + '].status'),
  })) : []
  for (const resource of resources) {
    if (!['planned', 'running', 'completed', 'blocked'].includes(resource.status)) throw new Error('executionPlan.resources.status 无效')
  }
  if (estimatedMinutes > 30) {
    if (parallelizable && resources.length < 2) throw new Error('超过30分钟且可并行的阶段必须安排至少2个独立资源分支')
    if (!parallelizable && !serialReason) throw new Error('超过30分钟但不可并行时必须填写 serialReason')
  }
  if (parallelizable && resources.length < 2) throw new Error('声明 parallelizable=true 时必须安排至少2个资源分支')
  const availableServers = resourceDiscovery.servers.filter(server => server.status === 'available' && server.availableGpus > 0)
  if (shardable && availableServers.length > 1) {
    const missing = availableServers.filter(server => !resources.some(resource => resource.server === server.name))
    if (missing.length) throw new Error('可分片任务必须利用所有已发现的可用服务器；缺少 ' + missing.map(server => server.name).join(', '))
  }
  if (!shardable && parallelizable && !shardReason) throw new Error('并行但不可分片时必须填写 shardReason')
  return {
    estimatedMinutes,
    parallelizable,
    shardable,
    shardReason,
    serialReason,
    resourceDiscovery,
    resources,
    checkpoints: [
      { kind: '5min', minutes: Math.min(5, estimatedMinutes) },
      { kind: '50%', minutes: estimatedMinutes * 0.5 },
      { kind: '75%', minutes: estimatedMinutes * 0.75 },
    ],
    harvestAtMinutes: estimatedMinutes,
  }
}

function normalizeAttempt(value, at) {
  if (!value || typeof value !== 'object') throw new Error('未达目标时必须填写 attempt')
  return {
    at,
    summary: requiredText(value.summary, 'attempt.summary'),
    findings: requiredText(value.findings, 'attempt.findings'),
    adjustment: requiredText(value.adjustment, 'attempt.adjustment'),
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function applyAuditSupplement(item, supplement, at, settings) {
  if (!TERMINAL.has(item.status)) throw new Error('auditSupplement 仅用于 completed/overdue 阶段')
  if (!supplement || typeof supplement !== 'object') throw new Error('必须提供 auditSupplement')
  const next = clone(item)
  const added = []
  if (!next.createdAt && supplement.createdAt !== undefined) { next.createdAt = optionalIso(supplement.createdAt, 'auditSupplement.createdAt'); added.push('createdAt') }
  if (!next.startedAt && supplement.startedAt !== undefined) { next.startedAt = optionalIso(supplement.startedAt, 'auditSupplement.startedAt'); added.push('startedAt') }
  if (!next.deadlineAt && supplement.deadlineAt !== undefined) { next.deadlineAt = optionalIso(supplement.deadlineAt, 'auditSupplement.deadlineAt'); added.push('deadlineAt') }
  if (!next.completedAt && supplement.completedAt !== undefined) { next.completedAt = optionalIso(supplement.completedAt, 'auditSupplement.completedAt'); added.push('completedAt') }
  if ((!Array.isArray(next.metrics) || !next.metrics.length) && supplement.metrics !== undefined) { next.metrics = supplement.metrics.map(normalizeMetric); added.push('metrics') }
  if ((!Array.isArray(next.deliverables) || !next.deliverables.length) && supplement.deliverables !== undefined) { next.deliverables = supplement.deliverables.map(normalizeDeliverable); added.push('deliverables') }
  if (!next.executionPlan && supplement.executionPlan !== undefined) { next.executionPlan = normalizeExecutionPlan(supplement.executionPlan, settings); added.push('executionPlan') }
  if (!added.length) throw new Error('没有可补录的空缺审计字段；终态既有值不可覆盖')
  next.gatePassed = computeGate(next.metrics)
  next.deliverablesReady = computeDeliverablesReady(next.deliverables)
  next.deadlineBreached = Boolean(next.deadlineAt && next.completedAt && Date.parse(next.completedAt) > Date.parse(next.deadlineAt))
  if (!Array.isArray(next.auditSupplements)) next.auditSupplements = []
  next.auditSupplements.push({ at, fields: added, reason: requiredText(supplement.reason, 'auditSupplement.reason') })
  return next
}

function preparePhaseUpdate(item, src, at, settings, options = {}) {
  const next = clone(item)
  if (!Array.isArray(next.metrics)) next.metrics = []
  if (!Array.isArray(next.attempts)) next.attempts = []
  if (!Array.isArray(next.deliverables)) next.deliverables = []
  if (!Array.isArray(next.resourceDiscoveryHistory)) next.resourceDiscoveryHistory = []
  if (!next.createdAt) next.createdAt = at

  for (const key of ['pLabel', 'actionTitle', 'timeline', 'what', 'purpose', 'result']) {
    if (src[key] !== undefined) next[key] = String(src[key])
  }

  const startedAt = optionalIso(src.startedAt, 'startedAt')
  const deadlineAt = optionalIso(src.deadlineAt, 'deadlineAt')
  if (startedAt !== undefined) next.startedAt = startedAt
  if (deadlineAt !== undefined) next.deadlineAt = deadlineAt

  if (src.metrics !== undefined) {
    if (!Array.isArray(src.metrics)) throw new Error('metrics 必须是数组')
    next.metrics = src.metrics.map(metric => normalizeMetric(metric, { v2: options.schemaVersion === 2 }))
  }
  if (src.deliverables !== undefined) {
    if (!Array.isArray(src.deliverables)) throw new Error('deliverables 必须是数组')
    next.deliverables = src.deliverables.map(normalizeDeliverable)
  }
  if (options.schemaVersion === 2) {
    if (src.metricResearch !== undefined) next.metricResearch = normalizeMetricResearch(src.metricResearch)
    if (src.objectiveContribution !== undefined) next.objectiveContribution = normalizeObjectiveContribution(src.objectiveContribution, options.finalObjective)
  }
  let suppliedExecutionPlan = null
  if (src.executionPlan !== undefined) {
    suppliedExecutionPlan = normalizeExecutionPlan(src.executionPlan, settings)
    next.executionPlan = suppliedExecutionPlan
  }

  if (src.progress !== undefined) {
    const progress = Number(src.progress)
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('progress 必须是 0-100')
    next.progress = progress
  }

  if (src.overdue !== undefined) next.overdue = Boolean(src.overdue)
  const requestedStatus = src.status === undefined ? next.status : String(src.status)
  if (!['pending', 'in-progress', 'completed', 'overdue'].includes(requestedStatus)) throw new Error('无效 status')

  if (TERMINAL.has(item.status) && requestedStatus !== item.status && !options.allowTerminalRewrite) {
    throw new Error('已结束阶段不可回退或改写，除非用户明确授权')
  }

  if (options.schemaVersion === 2 && requestedStatus !== 'pending') {
    if (!next.metricResearch || !next.objectiveContribution) throw new Error('v2 阶段启动前必须完成指标调研和最终目标贡献契约')
    if (!next.metrics.some(metric => metric.kind === 'quality' || metric.kind === 'final')) throw new Error('v2 阶段至少需要一个影响最终目标的 quality/final 指标；过程指标不能单独门控')
    const meaningfulQuality = next.metrics.filter(metric => metric.kind === 'quality' || metric.kind === 'final')
    if (meaningfulQuality.every(metric => metric.targetValue === 0 && ['>', '>='].includes(metric.operator))) throw new Error('阶段质量目标不能全部是“>0/≥0”；必须设置能区分质量好坏且有阈值依据的目标')
    const selected = new Set(next.metricResearch.selectedMetrics)
    const unresearched = next.metrics.filter(metric => (metric.kind === 'quality' || metric.kind === 'final') && !selected.has(metric.key))
    if (unresearched.length) throw new Error('质量指标必须来自 metricResearch.selectedMetrics：' + unresearched.map(metric => metric.key).join(', '))
  }

  if (requestedStatus === 'in-progress') {
    if (!next.startedAt) next.startedAt = at
    if (!next.deadlineAt) throw new Error('阶段进入进行中前必须设置 deadlineAt')
    if (Date.parse(next.deadlineAt) <= Date.parse(next.startedAt)) throw new Error('deadlineAt 必须晚于 startedAt')
    if (!next.executionPlan) throw new Error('阶段进入进行中前必须设置 executionPlan，评估并行资源与巡检点')
    const isStarting = item.status !== 'in-progress'
    const isReplanning = item.status === 'in-progress' && src.executionPlan !== undefined
    if (isStarting || isReplanning) {
      if (!suppliedExecutionPlan) throw new Error('阶段启动或重规划必须提交新的 executionPlan，并重新查询全部已配置服务器')
      const previousDiscovery = next.resourceDiscoveryHistory.length
        ? next.resourceDiscoveryHistory[next.resourceDiscoveryHistory.length - 1]
        : (item.executionPlan && item.executionPlan.resourceDiscovery)
      validateFreshResourceDiscovery(
        suppliedExecutionPlan.resourceDiscovery,
        at,
        options.previousPhaseCompletedAt || '',
        previousDiscovery && previousDiscovery.queriedAt,
        settings
      )
      next.resourceDiscoveryHistory.push({
        generation: next.resourceDiscoveryHistory.length + 1,
        trigger: isStarting ? 'phase-start' : 'replan',
        recordedAt: at,
        queriedAt: suppliedExecutionPlan.resourceDiscovery.queriedAt,
        servers: clone(suppliedExecutionPlan.resourceDiscovery.servers),
      })
    }
  }

  next.gatePassed = computeGate(next.metrics)
  next.deliverablesReady = computeDeliverablesReady(next.deliverables)
  next.deadlineBreached = Boolean(next.deadlineAt && Date.parse(at) > Date.parse(next.deadlineAt))
  const missedGate = !next.gatePassed
  const missingDeliverables = !next.deliverablesReady
  if ((missedGate || missingDeliverables || next.deadlineBreached) && requestedStatus === 'in-progress') {
    next.attempts.push(normalizeAttempt(src.attempt, at))
    if (item.deadlineBreached && src.deadlineAt !== undefined && src.executionPlan === undefined) {
      throw new Error('逾期重估 deadlineAt 时必须同步提交新的 executionPlan，重新分析并行资源和剩余时间')
    }
  }

  if (requestedStatus === 'completed') {
    if (!next.startedAt || !next.deadlineAt) throw new Error('completed 前必须有 startedAt 和 deadlineAt')
    if (!next.metrics.length) throw new Error('completed 前必须设置硬目标 metrics')
    if (!next.deliverablesReady) throw new Error('必需交付物未齐备，禁止 completed；必须继续执行并产出可供下一阶段使用的交付物')
    if (!next.gatePassed) throw new Error('硬目标未达标，禁止 completed；请总结调研、记录调整并继续尝试')
    if (next.deadlineBreached) throw new Error('已超过 deadlineAt；若交付物齐备可标记 overdue，否则必须保持 in-progress、重估截止时间并继续执行')
    next.completedAt = at
    next.progress = 100
    next.overdue = false
  }

  if (requestedStatus === 'overdue') {
    if (!next.deadlineAt) throw new Error('overdue 前必须设置 deadlineAt')
    if (!next.deadlineBreached) throw new Error('尚未到 deadlineAt，不能提前标记 overdue')
    if (!next.deliverablesReady) throw new Error('逾期但必需交付物缺失，阶段不能结束；保持 in-progress，重估 deadlineAt 并继续执行')
    next.completedAt = at
    next.overdue = true
  }

  next.status = requestedStatus
  return next
}

function validateInitPhase(src, index, at, settings, options = {}) {
  const id = requiredText(src && src.id, 'timeline[' + index + '].id')
  const phase = makePhase(id, at)
  const next = preparePhaseUpdate(phase, src, at, settings, { previousPhaseCompletedAt: '', schemaVersion: options.schemaVersion, finalObjective: options.finalObjective })
  if (!next.metrics.length) throw new Error(id + ' 必须在规划时设置至少一个硬目标 metric')
  if (!next.deliverables.length) throw new Error(id + ' 必须在规划时设置至少一个必需交付物 deliverable')
  if (!next.executionPlan) throw new Error(id + ' 必须在规划时设置 executionPlan')
  if (!next.deadlineAt) throw new Error(id + ' 必须在规划时设置 deadlineAt')
  if (!next.actionTitle || !next.what || !next.purpose) throw new Error(id + ' 必须填写 actionTitle、what、purpose')
  if (options.schemaVersion === 2) {
    if (!next.metricResearch || !next.objectiveContribution) throw new Error(id + ' 必须在新计划中设置 metricResearch 和 objectiveContribution')
    if (!next.metrics.some(metric => metric.kind === 'quality' || metric.kind === 'final')) throw new Error(id + ' 至少需要一个经调研选择的 quality/final 指标')
  }
  return next
}

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/progress-target',
    async handler(req, res) {
      const parsed = parseUrl(req.url)
      const sessionId = parsed.searchParams.get('sessionId')
      if (!sessionId) {
        sendJson(res, 400, { error: 'missing sessionId query parameter' })
        return
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          sendJson(res, 200, await loadPlan(sessionId, settings))
        } catch (error) {
          sendJson(res, 503, { error: String(error) })
        }
        return
      }

      if (req.method === 'POST') {
        try {
          const body = await new Promise((resolve, reject) => {
            let data = ''
            req.on('data', chunk => { data += chunk })
            req.on('end', () => {
              try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
            })
            req.on('error', reject)
          })
          const at = nowIso()
          let plan = await loadPlan(sessionId, settings)
          if (!plan) plan = clone(EMPTY_PLAN)
          if (!plan.createdAt) plan.createdAt = at

          if (body.operation === 'migrate-plan') {
            if (body.userAuthorizedMigration !== true) throw new Error('迁移v2必须由用户明确授权 userAuthorizedMigration=true')
            if (!Array.isArray(plan.timeline) || !plan.timeline.length) throw new Error('没有可迁移的既有计划')
            if ((plan.schemaVersion || 1) !== 1) throw new Error('只有v1计划可以迁移到v2')
            const finalObjective = normalizeFinalObjective(body.finalObjective)
            if (!Array.isArray(body.timeline) || body.timeline.length !== plan.timeline.length) throw new Error('迁移必须为全部既有阶段提供完整v2契约，且不得增删阶段')
            const byId = new Map(body.timeline.map(item => [requiredText(item && item.id, 'timeline.id'), item]))
            const migrated = plan.timeline.map((oldItem, index) => {
              const supplement = byId.get(oldItem.id)
              if (!supplement) throw new Error('迁移缺少阶段 ' + oldItem.id)
              const merged = { ...clone(oldItem), ...clone(supplement), id: oldItem.id, status: oldItem.status, completedAt: oldItem.completedAt }
              return validateInitPhase(merged, index, at, settings, { schemaVersion: 2, finalObjective })
            })
            plan = {
              ...plan,
              schemaVersion: 2,
              finalObjective,
              timeline: migrated,
              migrations: [...(Array.isArray(plan.migrations) ? plan.migrations : []), {
                at,
                from: 1,
                to: 2,
                reason: requiredText(body.migrationReason, 'migrationReason'),
              }],
            }
          } else if (body._initPlan || body.operation === 'init-plan') {
            if (!Array.isArray(body.timeline) || !body.timeline.length) throw new Error('初始化计划必须包含非空 timeline')
            const isExistingPlan = Array.isArray(plan.timeline) && plan.timeline.length > 0
            const schemaVersion = isExistingPlan ? (plan.schemaVersion || 1) : 2
            const finalObjective = schemaVersion === 2 ? normalizeFinalObjective(body.finalObjective) : plan.finalObjective
            const existingTerminal = new Map((plan.timeline || []).filter(item => TERMINAL.has(item.status)).map(item => [item.id, item]))
            const proposed = body.timeline.map((src, index) => {
              const id = requiredText(src && src.id, 'timeline[' + index + '].id')
              if (existingTerminal.has(id)) return clone(existingTerminal.get(id))
              return validateInitPhase(src, index, at, settings, { schemaVersion, finalObjective })
            })
            const proposedIds = new Set(proposed.map(item => item.id))
            for (const [id, oldItem] of existingTerminal) {
              if (!proposedIds.has(id)) proposed.push(clone(oldItem))
            }
            plan.introduction = requiredText(body.introduction, 'introduction')
            plan.schemaVersion = schemaVersion
            if (schemaVersion === 2) plan.finalObjective = finalObjective
            plan.timeline = proposed
          } else {
            const phaseId = requiredText(body.phase_id, 'phase_id')
            const index = (plan.timeline || []).findIndex(item => item.id === phaseId)
            const item = index >= 0 ? plan.timeline[index] : makePhase(phaseId, at)
            const requestedStatus = body.status === undefined ? item.status : String(body.status)
            if (requestedStatus === 'in-progress' && index > 0) {
              const blocked = plan.timeline.slice(0, index).find(previous => !TERMINAL.has(previous.status) || !previous.deliverablesReady)
              if (blocked) throw new Error('前序阶段 ' + blocked.id + ' 尚未合法结束或交付物未齐备，不能启动当前阶段')
            }
            const previousPhase = index > 0 ? plan.timeline[index - 1] : null
            const next = body.userAuthorizedAudit === true
              ? applyAuditSupplement(item, body.auditSupplement, at, settings)
              : preparePhaseUpdate(item, body, at, settings, { previousPhaseCompletedAt: previousPhase && previousPhase.completedAt, schemaVersion: plan.schemaVersion || 1, finalObjective: plan.finalObjective })
            if (index >= 0) plan.timeline[index] = next
            else plan.timeline.push(next)
          }

          await savePlan(sessionId, plan, settings)
          sendJson(res, 200, plan)
        } catch (error) {
          sendJson(res, 400, { error: String(error.message || error) })
        }
        return
      }

      res.writeHead(405, { allow: 'GET, HEAD, POST' })
      res.end()
    },
  }), 'progress-target: route')

  ctx.tools.register({
    name: 'update-progress-target',
    description: '更新当前会话某个进程目标阶段。\n\n【契约版本】\n既有无 schemaVersion 的计划按 v1 兼容执行；新建计划必须使用 v2，先定义 finalObjective。每阶段必须先充分调研候选质量指标，记录来源、测量方法、阈值依据、局限性、影响机制、不确定性与验证方案。无法可靠估计贡献幅度时使用 null，禁止编造。只有过程指标不能完成阶段。\n\n【根本目标】\n以完整完成计划为根本。每阶段规划至少一个必需交付物 deliverable；没有可供下一阶段消费的交付物，阶段即使超时也不能结束，且不得启动后续阶段。\n\n【时间规则】\n首次创建自动记录 createdAt；首次进入 in-progress 自动记录 startedAt。规划或启动每个阶段时必须设置 ISO 8601 deadlineAt。逾期但交付物缺失时保持 in-progress，填写 attempt 并重估新的 deadlineAt 继续执行。\n\n【双门控】\n质量门 metrics 决定是否达标；交付物门 deliverables 决定能否离开阶段。全部质量目标达标、交付物齐备且未超时才允许 completed。超过 deadlineAt 后，只有必需交付物全部 ready 且有 evidence 时才允许 overdue（质量可不达标）；交付物缺失则不能 overdue。\n硬目标未达标或交付物缺失时必须填写 attempt.summary、attempt.findings、attempt.adjustment，总结本轮结果、调研结论和下一轮调整后继续尝试。\n\n【资源发现与并行加速】\n每次阶段从 pending 进入 in-progress，以及进行中阶段重规划 executionPlan 时，都必须重新查询插件 requiredServers 配置中的全部资源服务器，并在 executionPlan.resourceDiscovery 中记录每台服务器状态、可用GPU数、查询时间和证据。查询快照不得超过配置的 resourceDiscoveryMaxAgeMinutes；阶段切换时 queriedAt 必须晚于上一阶段 completedAt，且不得复用本阶段旧快照。插件会保留 resourceDiscoveryHistory。不得锁定第一台GPU后停止查询。推理、评估、数据处理等可分片任务应设置 shardable=true；若多台服务器有可用GPU，resources 必须覆盖所有可用服务器并写明各自 shard。不可分片时必须填写 shardReason。\n每阶段必须填写 executionPlan。预计超过30分钟时，应主动拆出可独立推进的GPU、CPU、后台作业、子进程或调研分支并尽可能并行利用可用资源；parallelizable=true 时至少安排2个资源分支。确实只能串行时填写 serialReason。初始巡检仅为5分钟、预计总时间50%、75%；100%是结果收获点，不是普通巡检。每次巡检检查资源空闲、慢分支、可新增并行工作和各分支交付物。\n\n【巡检未结束】\n在任何计划巡检点，若任务进程/后台作业仍在运行，或阶段状态不是 completed/overdue，或质量目标/交付物门未通过，即判定“未结束”。应立即根据当前进度、速度和剩余工作量重新估计剩余时间，并重新分析并行资源；此后只安排该剩余时间的50%与100%两个检查点。100%时仍未结束，则再次重估、重新分配资源并重复50%/100%，直到完成、可逾期交付或出现明确阻塞。禁止恢复5分钟/75%巡检或额外轮询。\n\n【自动推进】\n阶段超过 deadlineAt、质量门未通过但必需交付物全部 ready 且有 evidence 时，应立即标记当前阶段 overdue，并使用合法交付物启动下一阶段；不得停下来等待用户审批。只有缺少用户专属输入、权限、安全确认或遇到无法自主解决的外部阻塞时才询问用户。\n\n【阶段拆分】\n按任务实际依赖拆分语义阶段，不要机械四等分；phase_id 使用英文短横线。\n\n【留存】\ncompleted/overdue 阶段不得清除、回退或改写，除非用户明确授权。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话ID；通常留空以自动绑定当前会话' },
        operation: { type: 'string', enum: ['init-plan', 'update-phase', 'migrate-plan'], description: '显式操作；未填写时兼容既有阶段更新调用' },
        _initPlan: { type: 'boolean', description: '旧初始化入口；等价于 operation=init-plan' },
        userAuthorizedMigration: { type: 'boolean', description: '仅当用户明确授权v1迁移到v2时设为true' },
        migrationReason: { type: 'string', description: '迁移原因' },
        introduction: { type: 'string', description: '完整计划说明' },
        finalObjective: { type: 'object', description: 'v2新计划必填：description、结构化metrics和最终deliverables' },
        phase_id: { type: 'string', description: '语义化阶段ID，如 data-prep、train-baseline、full-eval' },
        userAuthorizedAudit: { type: 'boolean', description: '仅当用户明确授权补录终态审计字段时设为 true' },
        auditSupplement: {
          type: 'object',
          description: '仅补终态空缺字段，不覆盖既有状态、结果或审计值',
          properties: {
            reason: { type: 'string' },
            createdAt: { type: 'string' },
            startedAt: { type: 'string' },
            deadlineAt: { type: 'string' },
            completedAt: { type: 'string' },
            executionPlan: { type: 'object' },
            deliverables: { type: 'array' },
            metrics: { type: 'array' },
          },
          required: ['reason'],
        },
        pLabel: { type: 'string', description: '阶段标签' },
        actionTitle: { type: 'string', description: '阶段标题' },
        timeline: { type: 'string', description: '人类可读时间范围' },
        what: { type: 'string', description: '做什么' },
        purpose: { type: 'string', description: '目的' },
        startedAt: { type: 'string', description: 'ISO 8601 起始时间；通常首次 in-progress 自动记录' },
        deadlineAt: { type: 'string', description: 'ISO 8601 硬截止时间；规划/启动阶段时必填' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'overdue'], description: '阶段状态' },
        overdue: { type: 'boolean', description: '是否逾期' },
        result: { type: 'string', description: '包含具体数值的阶段结果' },
        progress: { type: 'number', description: '阶段完成度 0-100', minimum: 0, maximum: 100 },
        metricResearch: { type: 'object', description: 'v2必填：调研问题、来源、候选指标、已选指标及选择理由' },
        objectiveContribution: { type: 'object', description: 'v2必填：关联最终指标、影响机制、证据等级、不确定性和验证方案' },
        executionPlan: {
          type: 'object',
          description: '阶段执行与资源并行计划；进入 in-progress 前必填',
          properties: {
            estimatedMinutes: { type: 'number', description: '预计总分钟数' },
            parallelizable: { type: 'boolean', description: '是否可并行' },
            shardable: { type: 'boolean', description: '任务是否可跨服务器分片，如推理、评估、数据处理' },
            shardReason: { type: 'string', description: '不可分片或分片受限的理由' },
            serialReason: { type: 'string', description: '不可并行时的原因' },
            resourceDiscovery: {
              type: 'object',
              description: '阶段启动/切换/重规划时对 requiredServers 中全部服务器重新查询的结果；必须在配置的新鲜度窗口内且不得复用旧快照',
              properties: {
                queriedAt: { type: 'string' },
                servers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: '服务器名称；应覆盖插件 requiredServers 配置中的全部名称' },
                      status: { type: 'string', enum: ['available', 'busy', 'unreachable', 'unknown'] },
                      availableGpus: { type: 'number' },
                      evidence: { type: 'string' },
                    },
                    required: ['name', 'status', 'availableGpus', 'evidence'],
                  },
                },
              },
              required: ['queriedAt', 'servers'],
            },
            resources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  work: { type: 'string' },
                  resource: { type: 'string', description: 'GPU、CPU、后台作业、子进程、subagent等' },
                  server: { type: 'string', description: '服务器名，应与 resourceDiscovery.servers 中的名称一致' },
                  shard: { type: 'string', description: '分片范围，如 users-0-9999' },
                  expectedDeliverable: { type: 'string' },
                  status: { type: 'string', enum: ['planned', 'running', 'completed', 'blocked'] },
                },
                required: ['id', 'work', 'resource', 'expectedDeliverable', 'status'],
              },
            },
          },
          required: ['estimatedMinutes', 'parallelizable', 'shardable', 'resourceDiscovery', 'resources'],
        },
        deliverables: {
          type: 'array',
          description: '阶段交付物；必需项必须 ready 且提供 evidence 才能 completed/overdue，并允许下一阶段启动',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              required: { type: 'boolean' },
              acceptance: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'ready'] },
              evidence: { type: 'string' },
            },
            required: ['name', 'acceptance', 'status'],
          },
        },
        metrics: {
          type: 'array',
          description: '结构化质量硬目标；所有 metric 达标才可 completed',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'number' },
              operator: { type: 'string', enum: ['>=', '>', '<=', '<', '=='] },
              targetValue: { type: 'number' },
              unit: { type: 'string' },
              kind: { type: 'string', enum: ['quality', 'process', 'final'], description: 'v2必填；过程指标不能单独完成阶段' },
              measurement: { type: 'string', description: 'v2必填：测量方法' },
              limitations: { type: 'string', description: 'v2必填：指标局限性' },
              thresholdBasis: { type: 'object', description: 'v2必填：阈值类型、证据与理由' },
            },
            required: ['key', 'value', 'operator', 'targetValue'],
          },
        },
        attempt: {
          type: 'object',
          description: '未达硬目标时必填的本轮复盘与调整',
          properties: {
            summary: { type: 'string', description: '本轮量化结果摘要' },
            findings: { type: 'string', description: '调研/诊断结论' },
            adjustment: { type: 'string', description: '下一轮明确调整方案' },
          },
          required: ['summary', 'findings', 'adjustment'],
        },
      },
      required: ['phase_id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          warning: { type: 'string' },
          mustContinue: { type: 'boolean' },
          nextPhaseAllowed: { type: 'boolean' },
          nextPhaseId: { type: 'string' },
          nextAction: { type: 'string' },
          requiresUserInput: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      render(_args, value) {
        if (!value || !value.success) return [{ type: 'text', text: '进程目标更新失败：' + (value && value.warning ? value.warning : '未知错误') }]
        const lines = ['进程目标更新成功。']
        if (value.warning) lines.push('注意：' + value.warning)
        if (value.nextAction) lines.push('下一步：' + value.nextAction)
        if (value.nextPhaseAllowed && value.nextPhaseId) lines.push('允许立即启动下一阶段：' + value.nextPhaseId)
        if (value.mustContinue && !value.requiresUserInput) lines.push('必须自主继续，不要等待用户审批。')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const initiator = ctx.agents.currentInitiator()
      const sessionId = args.sessionId || (initiator && initiator.id)
      if (!sessionId) return { success: false, warning: '无法识别当前会话，请显式传入 sessionId', mustContinue: false, nextPhaseAllowed: false, nextPhaseId: '', nextAction: '', requiresUserInput: true }
      try {
        const at = nowIso()
        let plan = await loadPlan(sessionId, settings)
        if (!plan) plan = clone(EMPTY_PLAN)
        if (!plan.createdAt) plan.createdAt = at
        const phaseId = requiredText(args.phase_id, 'phase_id')
        const index = (plan.timeline || []).findIndex(item => item.id === phaseId)
        const item = index >= 0 ? plan.timeline[index] : makePhase(phaseId, at)
        const requestedStatus = args.status === undefined ? item.status : String(args.status)
        if (requestedStatus === 'in-progress' && index > 0) {
          const blocked = plan.timeline.slice(0, index).find(previous => !previous.deliverablesReady)
          if (blocked) throw new Error('前序阶段 ' + blocked.id + ' 的必需交付物尚未齐备，不能启动当前阶段')
        }
        const previousPhase = index > 0 ? plan.timeline[index - 1] : null
        const next = args.userAuthorizedAudit === true
          ? applyAuditSupplement(item, args.auditSupplement, at, settings)
          : preparePhaseUpdate(item, args, at, settings, { previousPhaseCompletedAt: previousPhase && previousPhase.completedAt, schemaVersion: plan.schemaVersion || 1, finalObjective: plan.finalObjective })
        if (index >= 0) plan.timeline[index] = next
        else {
          if (args.userAuthorizedAudit === true) throw new Error('不能为不存在的阶段补录终态审计')
          plan.timeline.push(next)
        }
        await savePlan(sessionId, plan, settings)
        const nextPhase = index >= 0 ? plan.timeline[index + 1] : null
        const terminalAndUsable = TERMINAL.has(next.status) && next.deliverablesReady
        const nextPhaseAllowed = Boolean(terminalAndUsable && nextPhase)
        const mustContinue = next.status === 'in-progress' || nextPhaseAllowed
        let nextAction = ''
        if (next.status === 'overdue' && next.deliverablesReady) {
          nextAction = nextPhase
            ? '当前阶段逾期且质量未达标，但合法交付物已齐备；立即使用该交付物启动下一阶段 ' + nextPhase.id + '，不要等待用户审批。'
            : '当前阶段逾期且合法交付物已齐备；计划无后续阶段，进入最终汇总。'
        } else if (next.status === 'completed' && nextPhase) {
          nextAction = '当前阶段质量门与交付物门均通过；立即启动下一阶段 ' + nextPhase.id + '。'
        } else if (!next.deliverablesReady) {
          nextAction = '继续当前阶段，重估时间和资源，直到必需交付物齐备。'
        } else if (!next.gatePassed && !next.deadlineBreached) {
          nextAction = '继续当前阶段，按 attempt 调整并重跑；未超时不得提前推进。'
        }
        return {
          success: true,
          warning: next.deliverablesReady
            ? (next.gatePassed ? '' : (next.status === 'overdue' ? '质量目标未达标，但逾期交付物合法，可推进计划。' : '交付物齐备但质量未达标，未超时前继续改进。'))
            : '必需交付物尚未齐备：即使超时也不能结束或推进下一阶段。',
          mustContinue,
          nextPhaseAllowed,
          nextPhaseId: nextPhaseAllowed ? nextPhase.id : '',
          nextAction,
          requiresUserInput: false,
        }
      } catch (error) {
        return { success: false, warning: String(error.message || error), mustContinue: false, nextPhaseAllowed: false, nextPhaseId: '', nextAction: '', requiresUserInput: false }
      }
    },
  })
}
