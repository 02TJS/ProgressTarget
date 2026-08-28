// Persistent built client bundle; reload behavior is verified per running DSH process.
window.__ModuleLoader__.load({
  id: 'dsh-progress-target',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var CSS = [
      '.pt-page{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.pt-board{display:grid;gap:12px;padding:12px;max-width:1180px;margin:0 auto}',
      '.pt-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 2px 6px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.pt-summary strong{color:var(--dsw-alias-label-primary);font-size:13px}',
      '.pt-box{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;overflow:hidden}',
      '.pt-box.is-overdue{border-color:var(--dsw-alias-state-error-primary)}',
      '.pt-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.pt-group{font-size:11px;font-weight:700;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);padding:2px 7px;border-radius:999px}',
      '.pt-title{font-size:15px;font-weight:750;overflow-wrap:anywhere}',
      '.pt-intro{font-size:11px;color:var(--dsw-alias-label-secondary);padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);line-height:1.6}',
      '.pt-intro strong{color:var(--dsw-alias-label-primary);font-weight:700}',
      '.pt-status{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary)}',
      '.pt-status.is-running{color:var(--dsw-alias-brand-primary)}',
      '.pt-status.is-done{color:var(--dsw-alias-state-success-primary)}',
      '.pt-status.is-failed,.pt-late{color:var(--dsw-alias-state-error-primary)}',
      '.pt-progress{height:7px;background:var(--dsw-alias-bg-layer-2);border-radius:999px;overflow:hidden;margin-top:10px}',
      '.pt-progress>i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}',
      '.pt-meta{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px;margin-top:9px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.pt-percent{font-size:18px;font-weight:800;white-space:nowrap}',
      '.pt-task{display:grid;grid-template-columns:44px minmax(0,1fr) 96px;gap:10px;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.pt-task:first-child{border-top:0}',
      '.pt-task-id{font-size:11px;font-weight:800;color:var(--dsw-alias-brand-primary)}',
      '.pt-task-title{font-size:13px;font-weight:700;overflow-wrap:anywhere}',
      '.pt-task-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px;overflow-wrap:anywhere}',
      '.pt-note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin-top:4px;overflow-wrap:anywhere}',
      '.pt-note.is-result{color:var(--dsw-alias-label-primary);padding:6px 8px;background:var(--dsw-alias-bg-layer-2);border-radius:4px;border-left:3px solid var(--dsw-alias-state-success-primary)}',
      '.pt-note.is-warn{color:var(--dsw-alias-state-error-primary);background:rgba(231,76,60,0.1);padding:4px 8px;border-radius:4px;margin-top:6px}',
      '.pt-task-side{text-align:right;font-size:11px;white-space:nowrap}',
      '.pt-task-side strong{display:block;font-size:12px}',
      '.pt-task-progress{height:4px;background:var(--dsw-alias-bg-layer-2);border-radius:999px;overflow:hidden;margin-top:8px;max-width:200px}',
      '.pt-task-progress>i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px}',
      '.pt-empty{padding:22px 14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;color:var(--dsw-alias-label-secondary)}',
      '.pt-noplan{padding:60px 20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:2}',
      '.pt-noplan strong{color:var(--dsw-alias-label-primary);font-size:15px;display:block;margin-bottom:8px}',
      // Metrics chips
      '.pt-metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
      '.pt-metric{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 10px;font-size:11px;display:flex;gap:6px;align-items:baseline}',
      '.pt-metric-key{color:var(--dsw-alias-label-secondary)}',
      '.pt-metric-val{font-weight:700;color:var(--dsw-alias-state-success-primary)}',
      '.pt-metric-tgt{color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.pt-metric.is-pass{border-color:var(--dsw-alias-state-success-primary)}',
      '.pt-metric.is-miss{border-color:var(--dsw-alias-state-error-primary)}',
      '.pt-time-grid{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:6px;margin-top:6px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.pt-gate{display:inline-flex;align-items:center;margin-top:6px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;background:var(--dsw-alias-bg-layer-2)}',
      '.pt-gate.is-pass{color:var(--dsw-alias-state-success-primary)}',
      '.pt-gate.is-miss{color:var(--dsw-alias-state-error-primary)}',
      '.pt-attempt{margin-top:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.pt-attempt strong{color:var(--dsw-alias-label-primary)}',
      '.pt-deliverables{display:grid;gap:5px;margin-top:6px}',
      '.pt-deliverable{padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.pt-deliverable.is-ready{border-color:var(--dsw-alias-state-success-primary)}',
      '.pt-deliverable.is-missing{border-color:var(--dsw-alias-state-error-primary)}',
      '.pt-resources{display:grid;gap:5px;margin-top:6px}',
      '.pt-resource{padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      // Responsive
      '@media(max-width:760px){.pt-task{grid-template-columns:38px minmax(0,1fr)}.pt-task-side{grid-column:2;text-align:left}.pt-meta{grid-template-columns:1fr}.pt-summary{align-items:flex-start;flex-direction:column}}'
    ].join('')

    function statusClass(status) {
      if (status === 'in-progress') return 'is-running'
      if (status === 'completed') return 'is-done'
      if (status === 'overdue') return 'is-failed'
      return ''
    }

    function statusLabel(status) {
      return { pending: '待开始', 'in-progress': '进行中', completed: '已完成', overdue: '已逾期' }[status] || status
    }

    function progressPercent(items) {
      var terminal = items.filter(function(i) { return i.status === 'completed' || i.status === 'overdue' }).length
      return Math.round(terminal / items.length * 100)
    }

    function metricPassed(metric) {
      if (!metric || metric.operator === undefined || metric.targetValue === undefined) return false
      var value = Number(metric.value)
      var target = Number(metric.targetValue)
      if (metric.operator === '>=') return value >= target
      if (metric.operator === '>') return value > target
      if (metric.operator === '<=') return value <= target
      if (metric.operator === '<') return value < target
      return value === target
    }

    function displayTime(value) {
      if (!value) return '未记录'
      var date = new Date(value)
      return isNaN(date.getTime()) ? value : date.toLocaleString()
    }

    function Task(props) {
      var item = props.value
      var hasMetrics = item.metrics && item.metrics.length > 0
      var hasEmptyMetrics = item.status === 'completed' && (!item.metrics || item.metrics.length === 0)
      var attempts = Array.isArray(item.attempts) ? item.attempts : []
      var deliverables = Array.isArray(item.deliverables) ? item.deliverables : []
      var lastAttempt = attempts.length ? attempts[attempts.length - 1] : null
      var gatePassed = item.gatePassed === true || (hasMetrics && item.metrics.every(metricPassed))
      var deliverablesReady = item.deliverablesReady === true || (deliverables.length > 0 && deliverables.filter(function(d) { return d.required !== false }).every(function(d) { return d.status === 'ready' && Boolean(d.evidence) }))
      var st = item.deadlineBreached && item.status === 'in-progress' ? '逾期执行中' : statusLabel(item.status)
      var sc = statusClass(item.status)
      var pct = item.progress !== undefined ? item.progress : (item.status === 'completed' ? 100 : item.status === 'in-progress' ? 50 : 0)

      return React.createElement('div', { className: 'pt-task' },
        // Left: phase ID
        React.createElement('div', { className: 'pt-task-id' }, item.pLabel || item.id),
        // Center: content
        React.createElement('div', null,
          // Title
          React.createElement('div', { className: 'pt-task-title' }, item.actionTitle || item.phase),
          // Timeline meta
          item.timeline
            ? React.createElement('div', { className: 'pt-task-meta' }, '串行 · ' + item.timeline)
            : null,
          // What (做什么)
          item.what
            ? React.createElement('div', { className: 'pt-note' }, React.createElement('strong', null, '做什么：'), item.what)
            : null,
          // Purpose (目的)
          item.purpose
            ? React.createElement('div', { className: 'pt-note' }, React.createElement('strong', null, '目的：'), item.purpose)
            : null,
          React.createElement('div', { className: 'pt-time-grid' },
            React.createElement('span', null, '创建：' + displayTime(item.createdAt)),
            React.createElement('span', null, '开始：' + displayTime(item.startedAt)),
            React.createElement('span', null, '截止：' + displayTime(item.deadlineAt))
          ),
          item.executionPlan
            ? React.createElement('div', { className: 'pt-attempt' },
                React.createElement('strong', null, '执行计划：'),
                '预计' + item.executionPlan.estimatedMinutes + '分钟 · ' + (item.executionPlan.parallelizable ? '并行' : '串行') +
                ' · ' + (item.executionPlan.shardable ? '可跨服务器分片' : '不可分片') +
                ' · 巡检5min/' + item.executionPlan.checkpoints[1].minutes + 'min/' + item.executionPlan.checkpoints[2].minutes + 'min · 收获点' + item.executionPlan.harvestAtMinutes + 'min',
                item.executionPlan.resourceDiscovery
                  ? React.createElement('div', { className: 'pt-resources' },
                      React.createElement('div', { className: 'pt-note' }, '资源快照：' + displayTime(item.executionPlan.resourceDiscovery.queriedAt) + ' · 刷新代数 ' + ((item.resourceDiscoveryHistory && item.resourceDiscoveryHistory.length) || 1)),
                      (item.executionPlan.resourceDiscovery.servers || []).map(function(s, i) {
                        return React.createElement('div', { key: 'server-' + i, className: 'pt-resource' }, '服务器 ' + s.name + ' · ' + s.status + ' · 可用GPU ' + s.availableGpus + ' · 证据：' + s.evidence)
                      })
                    )
                  : React.createElement('div', { className: 'pt-note is-warn' }, '⚠️ 未记录当前部署的资源发现结果'),
                React.createElement('div', { className: 'pt-resources' }, (item.executionPlan.resources || []).map(function(r, i) {
                  return React.createElement('div', { key: i, className: 'pt-resource' }, (r.server ? r.server + ' · ' : '') + r.resource + (r.shard ? ' · 分片 ' + r.shard : '') + ' · ' + r.work + ' · ' + r.status + ' · 产物：' + r.expectedDeliverable)
                }))
              )
            : React.createElement('div', { className: 'pt-note is-warn' }, '⚠️ 未规划执行资源与并行策略'),
          hasMetrics
            ? React.createElement('div', { className: 'pt-metrics' },
                item.metrics.map(function(m, i) {
                  var pass = metricPassed(m)
                  var targetText = m.operator !== undefined && m.targetValue !== undefined
                    ? String(m.operator) + String(m.targetValue) + (m.unit || '')
                    : (m.target || '未结构化')
                  return React.createElement('span', { key: i, className: 'pt-metric ' + (pass ? 'is-pass' : 'is-miss') },
                    React.createElement('span', { className: 'pt-metric-key' }, m.key),
                    React.createElement('span', { className: 'pt-metric-val' }, String(m.value) + (m.unit || '')),
                    React.createElement('span', { className: 'pt-metric-tgt' }, '硬目标' + targetText)
                  )
                })
              )
            : null,
          React.createElement('div', { className: 'pt-gate ' + (gatePassed ? 'is-pass' : 'is-miss') }, gatePassed ? '质量门已通过' : '质量门未通过 · 继续改进'),
          React.createElement('div', { className: 'pt-gate ' + (deliverablesReady ? 'is-pass' : 'is-miss') }, deliverablesReady ? '交付物门已通过 · 可供下一阶段使用' : '交付物缺失 · 不得结束或推进下一阶段'),
          deliverables.length
            ? React.createElement('div', { className: 'pt-deliverables' }, deliverables.map(function(d, i) {
                var ready = d.status === 'ready' && Boolean(d.evidence)
                return React.createElement('div', { key: i, className: 'pt-deliverable ' + (ready ? 'is-ready' : 'is-missing') },
                  (ready ? '✓ ' : '✗ ') + d.name + ' · 验收：' + d.acceptance + ' · 证据：' + (d.evidence || '缺失'))
              }))
            : React.createElement('div', { className: 'pt-note is-warn' }, '⚠️ 未规划交付物，阶段不能结束'),
          React.createElement('div', { className: 'pt-note' }, '尝试次数：' + attempts.length),
          lastAttempt
            ? React.createElement('div', { className: 'pt-attempt' },
                React.createElement('strong', null, '最近调整：'), lastAttempt.summary + '；调研：' + lastAttempt.findings + '；下一轮：' + lastAttempt.adjustment)
            : null,
          item.objectiveContribution
            ? React.createElement('div', { className: 'pt-attempt' },
                React.createElement('strong', null, '最终目标贡献：'), item.objectiveContribution.finalObjectiveKeys.join('、') + ' · ' + item.objectiveContribution.mechanism,
                React.createElement('div', null, '证据等级：' + item.objectiveContribution.evidenceLevel + '；不确定性：' + item.objectiveContribution.uncertainty),
                React.createElement('div', null, '验证方案：' + item.objectiveContribution.validationPlan))
            : null,
          item.metricResearch
            ? React.createElement('div', { className: 'pt-attempt' }, React.createElement('strong', null, '指标调研：'), '已比较 ' + item.metricResearch.candidateMetrics.length + ' 个候选指标；选择 ' + item.metricResearch.selectedMetrics.join('、') + '。' + item.metricResearch.selectionReason)
            : null,
          // Warning for empty metrics
          hasEmptyMetrics
            ? React.createElement('div', { className: 'pt-note is-warn' }, '⚠️ 已完成但未填写具体指标（如HR@10、NDCG@10、MRR）')
            : null,
          // Result with conclusion boundary
          item.result
            ? React.createElement('div', { className: 'pt-note is-result' }, 
                React.createElement('strong', null, '结论：'), item.result)
            : null
        ),
        // Right: status badge + progress
        React.createElement('div', { className: 'pt-task-side' },
          React.createElement('strong', { className: 'pt-status ' + sc }, st + ' ' + pct + '%'),
          item.overdue ? React.createElement('span', { className: 'pt-late' }, '逾期') : null,
          React.createElement('div', { className: 'pt-task-progress' }, React.createElement('i', { style: { width: pct + '%' } }))
        )
      )
    }

    function Dashboard(props) {
      var sessionId = props.sessionId
      var pair = React.useState({ status: 'loading', plan: null, error: '' })
      var state = pair[0]
      var setState = pair[1]

      React.useEffect(function() {
        if (!sessionId) {
          setState({ status: 'noid', plan: null, error: '' })
          return
        }
        var alive = true
        var load = async function() {
          try {
            var response = await fetch('/api/progress-target?sessionId=' + encodeURIComponent(sessionId), { cache: 'no-store' })
            var value = await response.json()
            if (!response.ok) throw new Error('HTTP ' + response.status)
            if (alive) {
              if (value && value.timeline) {
                setState({ status: 'loaded', plan: value, error: '' })
              } else {
                setState({ status: 'noplan', plan: null, error: '' })
              }
            }
          } catch (error) {
            if (alive) setState({ status: 'error', plan: null, error: String(error && error.message ? error.message : error) })
          }
        }
        load()
        var timer = window.setInterval(load, 10000)
        return function() { alive = false; window.clearInterval(timer) }
      }, [sessionId])

      // No session ID
      if (state.status === 'noid' || !sessionId) {
        return React.createElement('div', { className: 'pt-empty' }, '未选择会话')
      }
      // Loading
      if (state.status === 'loading') {
        return React.createElement('div', { className: 'pt-empty' }, '加载中...')
      }
      // Error
      if (state.status === 'error') {
        return React.createElement('div', { className: 'pt-empty' }, '失败: ' + state.error)
      }
      // No plan - show empty state
      if (state.status === 'noplan' || !state.plan || !state.plan.timeline || !state.plan.timeline.length) {
        return React.createElement('div', { className: 'pt-page' },
          React.createElement('div', { className: 'pt-board' },
            React.createElement('div', { className: 'pt-noplan' },
              React.createElement('strong', null, '未制定目标计划表'),
              '当前会话尚未创建进程目标计划。\nAI 进程可通过 update-progress-target 工具初始化计划。'
            )
          )
        )
      }

      // Loaded - render plan
      var plan = state.plan
      var total = plan.timeline.length
      var done = plan.timeline.filter(function(i) { return i.status === 'completed' }).length
      var overdueCount = plan.timeline.filter(function(i) { return i.status === 'overdue' }).length
      var terminal = done + overdueCount
      var running = plan.timeline.filter(function(i) { return i.status === 'in-progress' }).length
      var pending = plan.timeline.filter(function(i) { return i.status === 'pending' }).length
      var qualityPassed = plan.timeline.filter(function(i) { return i.gatePassed === true }).length
      var pct = progressPercent(plan.timeline)
      var overdue = overdueCount > 0
      var overallStatus = running > 0 ? '进行中' : pending > 0 ? '待开始 ' + pending : overdueCount > 0 ? '已结束（含逾期）' : '全部完成'

      return React.createElement('div', { className: 'pt-page' },
        React.createElement('div', { className: 'pt-board' },
          // Summary bar
          React.createElement('div', { className: 'pt-summary' },
            React.createElement('span', null, '进程目标 ', React.createElement('strong', null, 'v' + (plan.schemaVersion || 1) + ' · ' + total + '阶段 · 已结束 ' + terminal + '（完成' + done + ' / 逾期' + overdueCount + '）')),
            React.createElement('span', null, '终态进度 ' + pct + '% · 质量达标 ' + qualityPassed + '/' + total + ' · ' + overallStatus)
          ),
          // Main box
          React.createElement('section', { className: 'pt-box' + (overdue ? ' is-overdue' : '') },
            // Header: title + progress
            React.createElement('div', { className: 'pt-head' },
              React.createElement('div', null,
                React.createElement('div', { className: 'pt-row' },
                  React.createElement('span', { className: 'pt-group' }, '计划'),
                  React.createElement('span', { className: 'pt-title' }, '进程目标'),
                  overdue ? React.createElement('span', { className: 'pt-late' }, '有逾期') : null
                ),
                React.createElement('div', { className: 'pt-progress' }, React.createElement('i', { style: { width: pct + '%' } })),
                React.createElement('div', { className: 'pt-meta' },
                  React.createElement('span', null, '阶段: ' + total + ' · 待开始: ' + pending),
                  React.createElement('span', null, '进行中: ' + running),
                  React.createElement('span', null, '已结束: ' + terminal + ' · 质量达标: ' + qualityPassed)
                )
              ),
              React.createElement('div', { className: 'pt-percent' }, pct + '%')
            ),
            plan.schemaVersion === 2 && plan.finalObjective
              ? React.createElement('div', { className: 'pt-intro' },
                  React.createElement('strong', null, '最终目标 · '), plan.finalObjective.description,
                  React.createElement('div', { className: 'pt-metrics' }, (plan.finalObjective.metrics || []).map(function(m, i) {
                    return React.createElement('span', { key: i, className: 'pt-metric' }, m.key + ' ' + m.operator + ' ' + m.targetValue + (m.unit || ''))
                  })))
              : React.createElement('div', { className: 'pt-intro' }, React.createElement('strong', null, '兼容模式 · '), '这是v1旧计划，继续按原规则执行；新建计划使用v2质量贡献契约。'),
            // Introduction as full contract
            plan.introduction
              ? React.createElement('div', { className: 'pt-intro' }, React.createElement('strong', null, 'full contract · '), plan.introduction)
              : null,
            // Phase tasks
            React.createElement('div', null,
              plan.timeline.map(function(item) {
                return React.createElement(Task, { key: item.id, value: item })
              })
            )
          )
        )
      )
    }

    exports.inject = ['slots']
    exports.apply = function(ctx) {
      ctx.effect(function() {
        var style = document.createElement('style')
        style.setAttribute('data-progress-target', '1')
        style.textContent = CSS
        document.head.appendChild(style)
        return function() { style.remove() }
      }, 'progress-target: styles')
      ctx.slots.inject('conversation.view', function() {
        return ctx.slots.register({
          name: 'conversation.view',
          id: 'research-goal',
          order: 30,
          label: '进程目标'
        }, Dashboard)
      })
    }

    return module.exports
  }
})