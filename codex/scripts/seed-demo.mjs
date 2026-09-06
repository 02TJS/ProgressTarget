import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService } from '../plugins/progress-target/core/operations.js';
import { phase, execution, iso, attempt } from '../tests/fixtures.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function seedDemo(projectHome = root) {
const store=new PlanStore(join(projectHome,'runtime/data'));
const existing=await store.list();
let demo=existing.find(p=>p.id==='demo-research');
if(!demo){
  const base=Date.now()-90*60000;let at=base;
  const service=new PlanService(store,{},()=>new Date(at));
  const specs=[
    ['data-quality','数据准备与质量验证','清理数据，验证标签一致性与样本覆盖','标签一致率',99.2,99,'%'],
    ['train-baseline','基线训练与验证','训练基线模型，交付可加载的模型权重','NDCG@10',0.247,0.26,''],
    ['full-evaluation','全量评估与结果汇总','执行评估分片，核对输出覆盖与结果一致性','评估覆盖率',72,100,'%'],
    ['report','报告整理与最终交付','整理实验结论、限制与最终可用成果','报告验收通过率',0,100,'%'],
  ];
  const timeline=specs.map(([id,title,what,key,value,target,unit],i)=>{
    const p=phase(id,base,{actionTitle:title,what,purpose:'通过可测的阶段质量，支撑最终推荐效果与可用交付。',deadlineAt:iso(base+[20,35,150,210][i]*60000)});
    p.metrics[0]={...p.metrics[0],key,value:0,targetValue:target,unit,measurement:what+'，按阶段验收口径测量',thresholdBasis:{type:'expert-judgment',evidence:'界面演示设定',reason:'仅展示阈值与实测值的比较，不代表真实实验要求'}};
    p.metricResearch.candidateMetrics[0].key=key;p.metricResearch.selectedMetrics=[key];
    p.metricResearch.sources=[{title:'界面演示数据说明',location:'examples/demo-notes.md',finding:'这些数值是合成示例，仅用于观察界面状态。'}];
    p.objectiveContribution.finalObjectiveKeys=['NDCG@10'];
    p.deliverables[0].name=['清洗后的数据集','基线模型权重','全量评估结果','最终实验报告'][i];
    return p;
  });
  demo=await service.create({planId:'demo-research',executionState:'active',title:'推荐模型实验 · 质量与交付',introduction:'演示数据，用于展示阶段门控和实时看板。',workspaceRoot:projectHome,
    finalObjective:{description:'完成推荐模型训练与全量评估，交付可复用的模型、结果和实验报告。',metrics:[{key:'NDCG@10',operator:'>=',targetValue:0.26,unit:''}],deliverables:[{name:'模型与实验报告',acceptance:'模型可加载、评估结果可读取、报告清楚说明质量边界'}]},timeline});
  for(let i=0;i<3;i++){
    at=base+[1,21,80][i]*60000;
    demo=await service.updatePhase({planId:demo.id,expectedRevision:demo.revision,phaseId:timeline[i].id,patch:{status:'in-progress',executionPlan:execution(at),attempt}});
    at=base+[15,45,85][i]*60000;
    const patch={status:['completed','overdue','in-progress'][i],progress:[100,90,72][i],metrics:[{key:specs[i][3],value:specs[i][4]}],result:['演示：数据验收通过，下游可以开始训练。','演示：质量指标低于目标；已过截止时间且权重可用，按 overdue 合法交付。','演示：评估覆盖率为72%，继续完成剩余分片。'][i]};
    if(i<2)patch.deliverables=[{name:timeline[i].deliverables[0].name,status:'ready',evidence:'demo://synthetic-output/'+timeline[i].id}];
    else patch.attempt={summary:'演示：已覆盖72%的评估样本',findings:'剩余分片仍在运行',adjustment:'收获剩余评估分片，检查覆盖率与结果一致性'};
    demo=await service.updatePhase({planId:demo.id,expectedRevision:demo.revision,phaseId:timeline[i].id,patch});
  }
  demo=await store.update(demo.id,demo.revision,p=>({...p,isDemo:true}));
}
return demo;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = await seedDemo();
  console.log(JSON.stringify({ planId: demo.id, isDemo: demo.isDemo }));
}
