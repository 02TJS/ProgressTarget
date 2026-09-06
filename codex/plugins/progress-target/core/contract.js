// Adapted from DSH ProgressTarget 2.0.0, copyright (c) 2026 02TJS. MIT.
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

function beijingIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('无效时间')
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().replace('Z', '+08:00')
}

function nowIso() {
  return beijingIso()
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

function requiredText(value, name) {
  if (value != null && typeof value !== 'string') throw new Error(name + ' 必须是字符串')
  const text = (value ?? '').trim()
  if (!text) throw new Error(name + ' 不能为空')
  return text
}

function numericValue(value) {
  return typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN
}

function uniqueItems(items, key, name) {
  const keys = items.map(item => requiredText(item?.[key], name + '.' + key))
  if (new Set(keys).size !== items.length) throw new Error(name + '.' + key + ' 必须唯一，不能重复')
  return items
}

function optionalIso(value, name) {
  if (value === undefined) return undefined
  const text = requiredText(value, name)
  const parts = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!parts) throw new Error(name + ' 必须是带时区的 ISO 8601 时间；请使用北京时间 +08:00')
  if (parts[4] !== '+08:00') throw new Error(name + ' 必须使用北京时间 UTC+08:00')
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) throw new Error(name + ' 必须是有效 ISO 8601 时间')
  const normalized = beijingIso(ms)
  if (normalized !== parts[1] + 'T' + parts[2] + '.' + (parts[3] || '').padEnd(3, '0').slice(0, 3) + '+08:00')
    throw new Error(name + ' 必须是有效日历日期与时间，不能自动滚动到下一天或月份')
  return normalized
}

function normalizeFinalObjective(value) {
  if (!value || typeof value !== 'object') throw new Error('v2 新计划必须设置 finalObjective')
  const metrics = Array.isArray(value.metrics) ? value.metrics.map((metric, index) => ({
    key: requiredText(metric && metric.key, 'finalObjective.metrics[' + index + '].key'),
    operator: requiredText(metric && metric.operator, 'finalObjective.metrics[' + index + '].operator'),
    targetValue: numericValue(metric?.targetValue),
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
  uniqueItems(deliverables, 'name', 'finalObjective.deliverables')
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
  const value = metric?.value === null ? null : numericValue(metric?.value)
  const targetValue = numericValue(metric?.targetValue)
  if (value !== null && !Number.isFinite(value)) throw new Error('metrics.value 必须是数值或 null（尚未测量）')
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
  uniqueItems(candidates, 'key', 'metricResearch.candidateMetrics')
  if (new Set(selectedMetrics).size !== selectedMetrics.length) throw new Error('metricResearch.selectedMetrics 必须唯一')
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
  if (!Number.isFinite(metric.value) || !Number.isFinite(metric.targetValue) || !OPERATORS.has(metric.operator)) return false
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
  if (value.required !== undefined && typeof value.required !== 'boolean') throw new Error('deliverables.required 必须是布尔值')
  if (value.evidence != null && typeof value.evidence !== 'string') throw new Error('deliverables.evidence 必须是字符串')
  return {
    name,
    required: value.required === undefined ? true : value.required,
    acceptance: requiredText(value.acceptance, 'deliverables.acceptance'),
    status,
    evidence: (value.evidence ?? '').trim(),
  }
}

function computeDeliverablesReady(deliverables) {
  return Array.isArray(deliverables) && deliverables.some(item => item.required !== false) && deliverables
    .filter(item => item.required !== false)
    .every(item => item.status === 'ready' && typeof item.evidence === 'string' && item.evidence.trim().length > 0)
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
  if (!discovery || discovery.deferred || !Number.isFinite(Date.parse(discovery.queriedAt))) throw new Error('执行前必须提交真实资源快照，不能使用待查询记录')
  const queriedMs = Date.parse(discovery.queriedAt)
  const nowMs = Date.parse(at)
  if (queriedMs > nowMs + 60 * 1000) throw new Error('resourceDiscovery.queriedAt 不能晚于当前时间')
  if (nowMs - queriedMs > settings.maxAgeMs) throw new Error('资源发现已超过配置的新鲜度窗口（' + settings.maxAgeMinutes + '分钟）；阶段启动或重规划前必须重新查询全部已配置服务器')
  if (earliestAt && queriedMs <= Date.parse(earliestAt)) throw new Error('资源发现必须发生在上一阶段结束之后，不能复用上一阶段快照')
  if (previousQueriedAt && queriedMs <= Date.parse(previousQueriedAt)) throw new Error('本次资源发现必须晚于该阶段上一份快照；重规划时必须重新查询全部已配置服务器')
}

function normalizeExecutionPlan(value, settings, options = {}) {
  if (!value || typeof value !== 'object') throw new Error('长时间阶段必须填写 executionPlan')
  const estimatedMinutes = Number(value.estimatedMinutes)
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) throw new Error('executionPlan.estimatedMinutes 必须是正数')
  const parallelizable = Boolean(value.parallelizable)
  const shardable = Boolean(value.shardable)
  const shardReason = value.shardReason === undefined ? '' : String(value.shardReason).trim()
  const serialReason = value.serialReason === undefined ? '' : String(value.serialReason).trim()
  const deferred = value.resourceDiscovery?.deferred === true
  if (deferred && !options.planning) throw new Error('待查询资源仅用于 pending 计划；执行前必须重新查询')
  const resourceDiscovery = deferred
    ? { deferred: true, reason: requiredText(value.resourceDiscovery.reason, '待查询原因'), servers: [] }
    : normalizeResourceDiscovery(value.resourceDiscovery, settings)
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
    if (!deferred && parallelizable && resources.length < 2) throw new Error('超过30分钟且可并行的阶段必须安排至少2个独立资源分支')
    if (!parallelizable && !serialReason) throw new Error('超过30分钟但不可并行时必须填写 serialReason')
  }
  if (!deferred && parallelizable && resources.length < 2) throw new Error('声明 parallelizable=true 时必须安排至少2个资源分支')
  if (deferred && resources.some(resource => resource.status !== 'planned')) throw new Error('暂不执行的资源分支只能是 planned')
  if (new Set(resources.map(resource => resource.id)).size !== resources.length) throw new Error('资源分支 ID 必须唯一')
  const availableServers = resourceDiscovery.servers.filter(server => server.status === 'available' && server.availableGpus > 0)
  if (shardable && availableServers.length > 1) {
    const missing = availableServers.filter(server => !resources.some(resource => resource.server === server.name))
    if (missing.length) throw new Error('可分片任务必须利用所有已发现的可用服务器；缺少 ' + missing.map(server => server.name).join(', '))
    if (!options.historical && resources.some(resource => availableServers.some(server => server.name === resource.server) && !resource.shard)) throw new Error('多服务器可分片分支必须写明 shard')
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
    checkpointMode: options.replan ? 'remaining' : 'initial',
    checkpoints: options.replan
      ? [{ kind: '50%', minutes: estimatedMinutes * 0.5 }, { kind: '100%', minutes: estimatedMinutes }]
      : [{ kind: '5min', minutes: Math.min(5, estimatedMinutes) }, { kind: '50%', minutes: estimatedMinutes * 0.5 }, { kind: '75%', minutes: estimatedMinutes * 0.75 }, { kind: '100%', minutes: estimatedMinutes }],
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

function applyAuditSupplement(item, supplement, at, settings, options = {}) {
  if (!TERMINAL.has(item.status)) throw new Error('auditSupplement 仅用于 completed/overdue 阶段')
  if (!supplement || typeof supplement !== 'object') throw new Error('必须提供 auditSupplement')
  const next = clone(item)
  const added = []
  if (!next.createdAt && supplement.createdAt !== undefined) { next.createdAt = optionalIso(supplement.createdAt, 'auditSupplement.createdAt'); added.push('createdAt') }
  if (!next.startedAt && supplement.startedAt !== undefined) { next.startedAt = optionalIso(supplement.startedAt, 'auditSupplement.startedAt'); added.push('startedAt') }
  if (!next.deadlineAt && supplement.deadlineAt !== undefined) { next.deadlineAt = optionalIso(supplement.deadlineAt, 'auditSupplement.deadlineAt'); added.push('deadlineAt') }
  if (!next.completedAt && supplement.completedAt !== undefined) { next.completedAt = optionalIso(supplement.completedAt, 'auditSupplement.completedAt'); added.push('completedAt') }
  if ((!Array.isArray(next.metrics) || !next.metrics.length) && supplement.metrics !== undefined) { next.metrics = supplement.metrics.map(metric => normalizeMetric(metric, { v2: options.schemaVersion === 2 })); added.push('metrics') }
  if ((!Array.isArray(next.deliverables) || !next.deliverables.length) && supplement.deliverables !== undefined) { next.deliverables = supplement.deliverables.map(normalizeDeliverable); added.push('deliverables') }
  uniqueItems(next.metrics || [], 'key', 'metrics')
  uniqueItems(next.deliverables || [], 'name', 'deliverables')
  if (!next.executionPlan && supplement.executionPlan !== undefined) { next.executionPlan = normalizeExecutionPlan(supplement.executionPlan, { ...settings, requiredServers: [] }, { historical: true }); added.push('executionPlan') }
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
  if (item.status === 'pending' && (!src.status || src.status === 'pending') && src.startedAt) throw new Error('pending 阶段不能记录执行开始时间')
  if (src.startedAt !== undefined && item.startedAt && src.startedAt !== item.startedAt) throw new Error('已经开始的阶段不能改写 startedAt')
  if (src.status === 'pending' && item.status !== 'pending') throw new Error('进行中的阶段不能回退为 pending')
  if (item.status === 'pending' && ['completed', 'overdue'].includes(src.status)) throw new Error('必须先启动阶段，再提交完成验收')
  if (src.deadlineAt && item.deadlineAt && src.deadlineAt !== item.deadlineAt && item.status === 'in-progress') {
    if (!src.executionPlan || !src.attempt) throw new Error('修改进行中阶段截止时间必须提交重规划和调整原因')
    next.deadlineHistory = [...(item.deadlineHistory || []), {at, previous: item.deadlineAt, next: src.deadlineAt, reason: requiredText(src.attempt.adjustment, 'attempt.adjustment')} ]
  }
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
  uniqueItems(next.metrics, 'key', 'metrics')
  uniqueItems(next.deliverables, 'name', 'deliverables')
  if (options.schemaVersion === 2) {
    if (src.metricResearch !== undefined) next.metricResearch = normalizeMetricResearch(src.metricResearch)
    if (src.objectiveContribution !== undefined) next.objectiveContribution = normalizeObjectiveContribution(src.objectiveContribution, options.finalObjective)
  }
  let suppliedExecutionPlan = null
  if (src.executionPlan !== undefined) {
    suppliedExecutionPlan = normalizeExecutionPlan(src.executionPlan, settings, { replan: item.status === 'in-progress', planning: item.status === 'pending' && (!src.status || src.status === 'pending'), historical: options.historical })
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
  if (requestedStatus !== 'pending' && next.startedAt && Date.parse(next.startedAt) > Date.parse(at))
    throw new Error('startedAt 不能晚于当前时间，禁止在实际开始之前完成阶段')

  if (TERMINAL.has(item.status) && !options.allowTerminalRewrite) {
    throw new Error('已结束阶段不可回退或改写，除非用户明确授权')
  }

  if (options.schemaVersion === 2) {
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
  const next = preparePhaseUpdate(phase, src, at, settings, { previousPhaseCompletedAt: '', schemaVersion: options.schemaVersion, finalObjective: options.finalObjective, historical: options.historical })
  if (!next.metrics.length) throw new Error(id + ' 必须在规划时设置至少一个硬目标 metric')
  if (!next.deliverables.some(item => item.required !== false)) throw new Error(id + ' 必须在规划时设置至少一个必需交付物 deliverable')
  if (!next.executionPlan) throw new Error(id + ' 必须在规划时设置 executionPlan')
  if (!next.deadlineAt) throw new Error(id + ' 必须在规划时设置 deadlineAt')
  if (!next.actionTitle || !next.what || !next.purpose) throw new Error(id + ' 必须填写 actionTitle、what、purpose')
  if (options.schemaVersion === 2) {
    if (!next.metricResearch || !next.objectiveContribution) throw new Error(id + ' 必须在新计划中设置 metricResearch 和 objectiveContribution')
    if (!next.metrics.some(metric => metric.kind === 'quality' || metric.kind === 'final')) throw new Error(id + ' 至少需要一个经调研选择的 quality/final 指标')
  }
  return next
}


export { TERMINAL, beijingIso, nowIso, makePhase, normalizeConfig, requiredText, uniqueItems, optionalIso, normalizeFinalObjective, normalizeMetric, normalizeMetricResearch, normalizeObjectiveContribution, computeGate, normalizeDeliverable, computeDeliverablesReady, normalizeExecutionPlan, validateFreshResourceDiscovery, preparePhaseUpdate, validateInitPhase, applyAuditSupplement, clone };
