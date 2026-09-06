const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (value, short = false) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(short ? {} : { year: 'numeric', second: '2-digit' }), hour12: false }).format(new Date(value)) : '尚未记录';
const phaseNames = { pending: '待开始', 'in-progress': '进行中', completed: '已完成', overdue: '逾期交付' };
const breached = phase => phase.status === 'in-progress' && (phase.deadlineBreached || Date.parse(phase.deadlineAt) < Date.now());
const phaseLabel = phase => breached(phase) ? '逾期执行中' : phaseNames[phase.status];
const runNames = { active: '推进中', waiting: '等待结果', paused: '已暂停', blocked: '遇到阻塞', finished: '已收尾' };
const pass = m => typeof m.value === 'number' && Number.isFinite(m.value) && ({ '>=': (a,b)=>a>=b, '>':(a,b)=>a>b, '<=':(a,b)=>a<=b, '<':(a,b)=>a<b, '==':(a,b)=>a===b }[m.operator] || (()=>false))(m.value,m.targetValue);
const badge = (text, tone = '') => '<span class="badge ' + tone + '">' + esc(text) + '</span>';
const params = new URL(location.href).searchParams;
const state = { plans: [], plan: null, threadId: params.get('thread'), demo: params.get('demo') === '1' && !params.get('thread'), planId: params.get('plan'), phaseId: null, tab: 'acceptance', query: '', request: 0, disclosures: new Set() };
const disclosure = key => ' data-disclosure="' + esc(key) + '"' + (state.disclosures.has(key) ? ' open' : '');
function scopedUrl(path, extra = {}) {
  const url = new URL(path, location.origin);
  if (state.threadId) url.searchParams.set('thread', state.threadId);
  else if (state.demo) url.searchParams.set('demo', '1');
  for (const [key, value] of Object.entries(extra)) if (value) url.searchParams.set(key, value);
  return url.pathname + url.search;
}
async function get(path) { const response = await fetch(scopedUrl(path), { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '读取失败'); return data; }

function renderList() {
  $('#plan-count').textContent = state.plans.length;
  const visible = state.plans.filter(p => p.title.toLowerCase().includes(state.query.toLowerCase()));
  $('#plan-list').innerHTML = visible.length ? visible.map(p =>
    '<button class="plan-item ' + (p.id === state.planId ? 'active' : '') + '" data-plan="' + esc(p.id) + '"><i class="plan-dot ' + (p.execution.state === 'active' ? 'active' : '') + '"></i><span><b>' + esc(p.title) + '</b><small>' + (p.isDemo ? '演示数据' : '任务计划') + ' · ' + p.closed + '/' + p.total + ' 阶段已结束</small></span></button>').join('') : '<div class="no-results">没有匹配的任务</div>';
}
function metricHtml(m) {
  return '<div class="metric"><div class="metric-top"><span>' + esc(m.key) + '</span>' + badge(pass(m) ? '已达标' : '待达标', pass(m) ? 'green' : 'amber') + '</div><div class="metric-values"><b>' + esc(m.value ?? '尚未测量') + '</b><span>' + esc(m.value == null ? '' : m.unit) + '</span><span> / 目标 ' + esc(m.operator) + ' ' + esc(m.targetValue) + esc(m.unit) + '</span></div><div class="metric-note">' + esc(m.measurement || '按阶段约定测量') + (m.thresholdBasis ? '<br>阈值依据：' + esc(m.thresholdBasis.reason) : '') + '</div></div>';
}
function acceptanceHtml(phase) {
  const ds = phase.deliverables || [];
  const attempts = phase.attempts || [];
  const last = attempts.at(-1);
  const required = ds.filter(d => d.required !== false);
  const ready = required.filter(d => d.status === 'ready' && d.evidence).length;
  const delivered = required.length > 0 && ready === required.length;
  return '<div class="section-label">质量指标 ' + badge(phase.gatePassed ? '质量门通过' : '继续验证', phase.gatePassed ? 'green' : 'amber') + '</div><div class="metrics">' + (phase.metrics || []).map(metricHtml).join('') + '</div>' + (phase.status === 'completed' && !phase.metrics?.length ? '<div class="callout">历史阶段已结束，但未记录结构化质量指标，不能据此认定质量通过。</div>' : '') + '<div class="divider"></div><div class="section-label">必需交付物 ' + badge(delivered ? '交付物门通过' : '缺失 · 不得推进', delivered ? 'green' : 'amber') + '</div><p class="muted">' + ready + ' / ' + required.length + ' 必需项已就绪</p>' +
    ds.map(d=>'<div class="deliverable"><span class="check ' + (d.status==='ready'&&d.evidence?'ready':'') + '">' + (d.status==='ready'&&d.evidence?'✓':'') + '</span><div><b>' + esc(d.name) + '</b> ' + badge(d.required === false ? '可选' : '必需') + '<p>' + esc(d.acceptance) + '</p>' + (d.evidence?'<div class="evidence">' + esc(d.evidence) + '</div>':'') + '</div></div>').join('') + '<p class="muted">尝试次数：' + attempts.length + '</p>' +
    (last?'<div class="divider"></div><div class="callout"><strong>最近调整 · 第 ' + attempts.length + ' 次记录</strong>' + esc(last.adjustment) + '<div class="muted">' + esc(last.summary) + '</div><p>发现：' + esc(last.findings) + '</p></div>':'') +
    (phase.result?'<div class="divider"></div><div class="section-label">阶段结论</div><div class="detail-purpose">' + esc(phase.result) + '</div>':'') +
    '<details' + disclosure(state.plan.id + ':' + phase.id + ':research') + '><summary>指标依据与最终目标关联</summary>' + (phase.metricResearch?'<p>选用指标：' + esc(phase.metricResearch.selectedMetrics.join('、')) + '</p><p>' + esc(phase.metricResearch.selectionReason) + '</p>' + phase.metricResearch.sources.map(s=>'<p><b>' + esc(s.title) + '</b> · ' + esc(s.finding) + '<br>' + esc(s.location) + '</p>').join('') + (phase.metricResearch.candidateMetrics||[]).map(c=>'<p>候选：' + esc(typeof c === 'string' ? c : c.key + '：' + c.rationale + '；测量：' + c.measurement + '；局限：' + c.limitations) + '</p>').join(''):'<p>v1 兼容计划未记录指标调研。</p>') + (phase.objectiveContribution?'<p>关联最终指标：' + esc(phase.objectiveContribution.finalObjectiveKeys.join('、')) + '<br>' + esc(phase.objectiveContribution.mechanism) + '<br>证据等级：' + esc(({hypothesis:'假设','literature-supported':'文献支持','pilot-supported':'预实验支持',validated:'已验证'})[phase.objectiveContribution.evidenceLevel]) + '<br>验证安排：' + esc(phase.objectiveContribution.validationPlan) + '<br>不确定性：' + esc(phase.objectiveContribution.uncertainty) + '</p>':'') + '</details>';
}
function resourcesHtml(phase) {
  const exec = phase.executionPlan;
  if (!exec) return '<div class="detail-purpose">尚未记录执行资源。</div>';
  const checkpoints = [...(exec.checkpoints || [])];
  if (!checkpoints.some(c => c.kind === '100%') && exec.harvestAtMinutes != null) checkpoints.push({ kind: '100%', minutes: exec.harvestAtMinutes });
  return '<div class="section-label">执行安排 ' + badge(exec.parallelizable?'并行':'串行', 'green') + ' ' + badge(exec.shardable ? '可跨服务器分片' : '不可分片') + '</div><div class="time-row"><span>预计耗时</span><b>' + exec.estimatedMinutes + ' 分钟</b></div><div class="time-row"><span>资源刷新时间</span><b>' + (exec.resourceDiscovery?.deferred ? '待执行前查询' : time(exec.resourceDiscovery?.queriedAt, true)) + '</b></div><div class="time-row"><span>资源刷新次数</span><b>' + (phase.resourceDiscoveryHistory?.length || 0) + '</b></div><div class="divider"></div><div class="section-label">资源快照</div>' +
    ((exec.resourceDiscovery?.servers || []).map(s=>'<div class="resource"><div class="resource-top"><b>' + esc(s.name) + '</b>' + badge(({available:'可用',busy:'繁忙',unreachable:'不可达',unknown:'未知'})[s.status],s.status==='available'?'green':'amber') + '</div><small>可用 GPU · ' + s.availableGpus + '</small><div class="evidence">' + esc(s.evidence) + '</div></div>').join('') || '<div class="callout">' + esc(exec.resourceDiscovery?.deferred ? exec.resourceDiscovery.reason : '未配置固定服务器；按本阶段执行安排使用资源。') + '</div>') +
    '<div class="divider"></div><div class="section-label">' + (exec.checkpointMode==='remaining'?'剩余时间检查点':'初始检查点') + '</div><div class="objective-targets">' + checkpoints.map(c=>'<span class="objective-target">' + esc(c.kind === '100%' ? '结果收获点' : c.kind) + ' · ' + c.minutes + ' 分钟</span>').join('') + '</div>' +
    ((exec.resources||[]).length?'<div class="divider"></div><div class="section-label">执行分支</div>' + exec.resources.map(r=>'<div class="resource"><b>' + esc(r.work) + '</b><br><small>' + esc(r.resource) + ' · ' + esc(({planned:'待执行',running:'执行中',completed:'已完成',blocked:'遇到阻塞'})[r.status] || r.status) + '</small>' + (r.server?'<p>服务器：' + esc(r.server) + (r.shard?' · 分片：' + esc(r.shard):'') + '</p>':'') + '<p>' + esc(r.expectedDeliverable) + '</p></div>').join(''):'') + (exec.serialReason?'<p>串行原因：' + esc(exec.serialReason) + '</p>':'') + (exec.shardReason?'<p>分片说明：' + esc(exec.shardReason) + '</p>':'');
}
function activityHtml(phase) {
  const events = (state.plan.events||[]).filter(e=>!e.phaseId||e.phaseId===phase.id).slice().reverse();
  return '<div class="section-label">阶段时间 <span class="muted">北京时间</span></div>' + [['创建',phase.createdAt],['开始',phase.startedAt],['截止',phase.deadlineAt],['结束',phase.completedAt]].map(([label,date])=>'<div class="time-row"><span>' + label + '</span><b>' + time(date) + '</b></div>').join('') + '<div class="divider"></div><div class="section-label">活动记录</div>' +
    (events.length?events.map(e=>'<div class="timeline-event">' + esc(e.message) + '<small>' + time(e.at) + '</small></div>').join(''):'<p class="detail-purpose">尚未记录活动。</p>');
}
function detailHtml(phase) {
  if (!phase) return '<div class="empty">选择一个阶段查看验收详情。</div>';
  return '<div class="detail-head"><div class="eyebrow">阶段详情 · ' + esc(phase.pLabel || phase.id) + '</div><h2 class="detail-title">' + esc(phase.actionTitle) + '</h2><p class="detail-purpose">' + esc(phase.purpose) + '</p>' + (phase.timeline ? '<p class="detail-purpose">时间安排：' + esc(phase.timeline) + '</p>' : '') + '<div class="detail-meta">' + badge(phaseLabel(phase),phase.status==='overdue'||breached(phase)?'amber':phase.status==='pending'?'':'green') + '<span class="muted">截止 ' + time(phase.deadlineAt,true) + '</span></div></div><div class="tabs" role="tablist">' +
    [['acceptance','验收'],['resources','资源'],['activity','活动']].map(([id,name])=>'<button class="tab ' + (state.tab===id?'active':'') + '" data-tab="' + id + '" role="tab" aria-selected="' + (state.tab===id) + '">' + name + '</button>').join('') + '</div><div class="detail-body" role="tabpanel">' + ({acceptance:acceptanceHtml,resources:resourcesHtml,activity:activityHtml})[state.tab](phase) + '</div>';
}
function render() {
  renderList();
  const p=state.plan;
  if(!p){ $('#updated-at').textContent=''; $('#app').innerHTML='<div class="empty"><h2>' + (state.threadId?'当前对话还没有计划':'从当前 Codex 对话打开计划') + '</h2><p>' + (state.threadId?'在这个对话里说“制作新计划”，制定后保持暂停，确认后再执行。':'在需要查看的 Codex 对话里说“查看我的 ProgressTarget 计划”。每个对话有自己的入口。') + '</p>' + (!state.threadId?'<a class="button" href="/?demo=1">查看界面演示</a>':'') + '</div>'; return; }
  const phases=p.timeline||[],closed=phases.filter(x=>['completed','overdue'].includes(x.status)).length,quality=phases.filter(x=>x.gatePassed).length,overdue=phases.filter(x=>x.status==='overdue').length;
  const allDeliverables=phases.flatMap(x=>x.deliverables||[]).filter(d=>d.required!==false),ready=allDeliverables.filter(d=>d.status==='ready'&&d.evidence).length;
  const selected=phases.find(x=>x.id===state.phaseId)||phases.find(x=>x.status==='in-progress')||phases[0];
  if(selected)state.phaseId=selected.id;
  const pct=phases.length?Math.round(closed/phases.length*100):0;
  $('#updated-at').textContent='更新于 ' + time(p.updatedAt,true);
  $('#app').innerHTML='<div class="eyebrow">' + (state.demo ? '界面演示' : '当前对话 · 独立计划') + '</div><div class="hero-row"><div><h1>' + esc(p.title) + '</h1><p class="subtitle">' + esc(p.finalObjective?.description||p.introduction) + '</p></div><div class="hero-actions"><button class="button" id="copy-link">复制链接 ↗</button><a class="button primary" href="' + esc(scopedUrl('/api/plans/' + encodeURIComponent(p.id), {download:'1'})) + '" download>导出计划 ↓</a></div></div>' +
    (p.isDemo?'<div class="demo-banner"><b>演示数据</b><span>用于展示界面与状态语义，指标不代表真实实验结果。</span></div>':'') +
    ((p.schemaVersion || 1) === 1 ? '<div class="callout"><strong>v1 兼容模式</strong>按旧计划的指标与交付物门控继续；收尾不代表已经验证 v2 最终目标。</div>' : '') +
    (p.introduction ? '<details class="plan-introduction"' + disclosure(p.id + ':introduction') + '><summary>完整计划说明</summary><p class="detail-purpose">' + esc(p.introduction) + '</p></details>' : '') +
    '<div class="stats"><div class="stat"><div class="stat-label">阶段结束率 <span>' + closed + ' / ' + phases.length + '</span></div><div class="stat-value">' + pct + '<small>%</small></div><div class="stat-caption">已完成与合法逾期均计入</div><progress value="' + pct + '" max="100"></progress></div><div class="stat"><div class="stat-label">质量门通过</div><div class="stat-value">' + quality + '<small>/ ' + phases.length + ' 阶段</small></div><div class="stat-caption">' + (overdue?overdue+' 个阶段逾期交付':'按实际质量指标判断') + '</div></div><div class="stat"><div class="stat-label">必需交付物</div><div class="stat-value">' + ready + '<small>/ ' + allDeliverables.length + ' 已就绪</small></div><div class="stat-caption">可供下一阶段使用且有证据</div></div><div class="stat"><div class="stat-label">当前执行状态</div><div class="stat-value status-value">' + esc(runNames[p.execution.state]) + '</div><div class="stat-caption">' + esc(p.finalAcceptance?(p.finalAcceptance.met?'最终目标已验收':'部分交付 · 目标未全部达成'):p.execution.state==='active'?'按计划持续推进':p.execution.reason) + '</div></div></div>' +
    '<div class="content-grid"><div><section class="panel"><div class="panel-heading"><h2>执行阶段</h2><span>按依赖顺序推进</span></div><div class="phase-list">' +
    phases.map((ph,i)=>'<button class="phase ' + (ph.id===state.phaseId?'selected':'') + '" data-phase="' + esc(ph.id) + '"><span class="phase-marker ' + ph.status + '">' + (ph.status==='completed'?'✓':String(i+1).padStart(2,'0')) + '</span><span><div class="phase-title">' + esc(ph.actionTitle) + '</div><div class="phase-desc">' + esc(ph.what) + '</div><div class="phase-info"><span>截止 ' + time(ph.deadlineAt,true) + '</span><span>' + (ph.deliverables||[]).filter(d=>d.status==='ready'&&d.evidence).length + '/' + (ph.deliverables||[]).length + ' 交付物</span></div></span><span class="phase-status">' + badge(phaseLabel(ph),ph.status==='overdue'||breached(ph)?'amber':ph.status==='completed'||ph.status==='in-progress'?'green':'') + '<strong>' + (ph.progress||0) + '%</strong></span></button>').join('') +
    '</div></section><section class="panel objective"><div class="panel-heading"><h2>最终目标</h2>' + badge(p.finalAcceptance?(p.finalAcceptance.met?'已验收':'部分交付'):(p.schemaVersion||1)===1?'未定义 v2 最终契约':'待最终验收',p.finalAcceptance?.met?'green':'') + '</div><div class="objective-body"><p>' + esc(p.finalObjective?.description||'v1 兼容模式；最终契约可通过迁移补充。') + '</p><div class="objective-targets">' + (p.finalObjective?.metrics||[]).map(m=>'<span class="objective-target">' + esc(m.key)+' '+esc(m.operator)+' '+esc(m.targetValue)+esc(m.unit) + '</span>').join('') + '</div></div></section></div><section class="panel" id="detail">' + detailHtml(selected) + '</section></div>';
}
async function reload() {
  const ticket=++state.request;
  try{
    const data=await get('/api/plans'); if(ticket!==state.request)return;
    state.plans=data.plans;
    if (state.planId && !state.plans.length) { state.planId=null; state.phaseId=null; }
    if(state.planId && !state.plans.some(p=>p.id===state.planId)) { state.plan = null; render(); throw new Error('此链接的计划不属于当前看板，或已被删除。请从当前 Codex 对话重新打开。'); }
    if(!state.planId)state.planId=data.currentPlanId||(state.demo?state.plans[0]?.id:null)||null;
    const plan=state.planId?await get('/api/plans/'+encodeURIComponent(state.planId)):null;
    if(ticket!==state.request)return;
    state.plan=plan;
    const warnings=(data.warnings||[]).map(w=>w.message).join(' ');
    $('#error').hidden=!warnings;$('#error').textContent=warnings;render();
  }catch(error){if(ticket!==state.request)return;$('#error').hidden=false;$('#error').textContent=error.message;}
}
$('#plan-list').addEventListener('click',event=>{const item=event.target.closest('[data-plan]');if(!item)return;state.planId=item.dataset.plan;state.phaseId=null;history.replaceState(null,'',scopedUrl('/', {plan:state.planId}));reload();});
$('#search').addEventListener('input',event=>{state.query=event.target.value;renderList();});
$('#refresh').addEventListener('click',reload);
document.addEventListener('toggle', event => {
  const detail = event.target;
  if (!detail.matches?.('details[data-disclosure]')) return;
  if (detail.open) state.disclosures.add(detail.dataset.disclosure);
  else state.disclosures.delete(detail.dataset.disclosure);
}, true);
$('#app').addEventListener('click',async event=>{
  const phase=event.target.closest('[data-phase]');if(phase){state.phaseId=phase.dataset.phase;render();return;}
  const tab=event.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;render();return;}
  if(event.target.closest('#copy-link')){try{await navigator.clipboard.writeText(location.origin+scopedUrl('/', {plan:state.planId}));$('#toast').textContent='看板链接已复制';$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,2000);}catch{$('#error').textContent='请复制浏览器地址栏中的看板链接';$('#error').hidden=false;}}
});
if (state.threadId || state.demo) {
const stream=new EventSource(scopedUrl('/api/events'));
stream.addEventListener('connected',()=>{$('#connection').textContent='已连接 · 自动更新';$('#connection-dot').classList.add('live');reload();});
stream.addEventListener('change',reload);
stream.onerror=()=>{$('#connection').textContent='连接中断 · 正在重连';$('#connection-dot').classList.remove('live');};
// Local read-only fallback also catches missed events and binding writes after plan creation.
setInterval(() => { if (!document.hidden) reload(); }, 10000);
} else $('#connection').textContent='请选择对话入口';
document.querySelectorAll('a[href="/"]').forEach(link => { link.href = scopedUrl('/'); });
reload();
