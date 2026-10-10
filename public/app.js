import { SparringVoice } from './voice.js';
import { sessionComposer, voiceStatus } from './session-view.js';
import { normalizeReportDetail } from './report-model.js';
import { initialReportUI, reportPage, reportPanel } from './report-view.js';
const D=globalThis.YUCHAI_CURRICULUM;
const paths = {
  keyboard:'M3 5h18v14H3zM6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 15h10',power:'M12 2v10M6 5a9 9 0 1 0 12 0',
  arrow:'M5 12h14m-5-5 5 5-5 5',chevron:'m9 5 7 7-7 7',back:'m15 5-7 7 7 7',
  book:'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15',
  home:'m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  check:'m5 12 4 4L19 6',circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',checkCircle:'M21 12a9 9 0 1 1-3-6.7M8 11l3 3 9-9',
  mic:'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',
  headset:'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h4v-7m14 0h2v7h-4v-7M18 19a3 3 0 0 1-3 3h-3',
  file:'M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6',target:'M21 12a9 9 0 1 1-9-9M17 12a5 5 0 1 1-5-5M12 12l9-9M16 3h5v5',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6',
  lock:'M6 10V7a6 6 0 0 1 12 0v3M4 10h16v12H4zM12 14v4',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6',
  briefcase:'M3 7h18v14H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3',handshake:'m2 10 4-5 5 1 2-1 5 1 4 5-4 7-3 2-3-1-4 1-6-6M8 7l-3 5 3 2 4-4 6 6M7 17l2-2m2 4 2-2',
  light:'M9 18h6m-5 3h4M7 10a5 5 0 1 1 10 0c0 3-2 4-2 6H9c0-2-2-3-2-6',refresh:'M20 7V3l-3 3a8 8 0 1 0 3 9M20 3h-5',
  history:'M4 7a9 9 0 1 1-1 9M4 2v5h5M12 7v5l3 2',info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6m0-10v1',
  layers:'m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',bell:'M6 16V9a6 6 0 0 1 12 0v7l2 3H4zM10 22h4',close:'m5 5 14 14M5 19 19 5',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const main=document.querySelector('#app-main'), header=document.querySelector('#app-header'), nav=document.querySelector('#tabbar'), sheet=document.querySelector('#sheet');
const KEY='yuchai-learning-demo-v2';
const SYNTHETIC_EXERCISE_IDS=new Set(['261']);
const TEXT_VERIFICATION_IDS=new Set(['263','264','265','266','267','268']);
let state; try{state=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
state={completed:[],visited:{},reviewed:[],videos:{},demoReportSeen:false,realReports:[],...state};
let route=[],filter='all',query='',practiceFilter='all',plans=[],liveAvailable=false,session=null,startingLive=false,voice,timer,toastTimer,activeReport,reportPoll=0,selectedAnswer=-1,checkedAnswer=false,activeQuiz='';
let reportUI=initialReportUI();
const completed=id=>state.completed.includes(id);
const course=id=>D.courses.find(c=>c.id===id)||D.courses[0];
const practice=id=>D.practices.find(p=>p.id===id);
const nextCourse=()=>D.courses.find(c=>!completed(c.id))||D.courses[0];
const courseMedia=id=>globalThis.YUCHAI_MEDIA?.courseMedia?.[id]?.video;
const coverByCourse={c1:'dealer-visit.jpg',c2:'factory-robot.jpg',c3:'factory-casting.jpg',c4:'export-buses.jpg',c5:'dealer-group.jpg'};
const coverByPractice={oem:'factory-robot.jpg',overseas:'dealer-group.jpg',demand:'dealer-visit.jpg',price:'factory-casting.jpg',risk:'export-buses.jpg',progress:'singapore-city.jpg',complaint:'dealer-visit.jpg',datacenter:'factory-robot.jpg'};
const cover=c=>`./assets/${coverByCourse[c.id]}`;
const practiceCover=p=>`./assets/${coverByPractice[p.coverKey]}`;
const minutes=s=>`${Math.floor(s/60)} 分 ${Math.round(s%60)} 秒`;
const time=v=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(Math.floor(v%60)).padStart(2,'0')}`;
const published=p=>p.availability==='live';
const textReady=p=>p.textAvailable===true;
const inputLabel=p=>textReady(p)?'文字 / 语音':'语音 · 文字待恢复';
const planDetails=new Map();
const dialogueMode=p=>planDetails.get(p.planId)?.dialogueMode??p.dialogueMode;
const dialogueLabel=mode=>mode==='virtual_streaming_dialogue'?'实时对话':mode==='text'?'消息对话':'';
const dialogueTag=p=>{const mode=dialogueMode(p),label=dialogueLabel(mode);return published(p)&&label?`<span class="dialogue-tag ${mode==='virtual_streaming_dialogue'?'streaming':'message'}">${label}</span>`:'';};
const available=p=>published(p)&&liveAvailable&&plans.some(x=>Number(x.id)===p.planId&&x.status==='active');
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{toast('进度暂时无法保存在此浏览器。');}}
function toast(t){const el=document.querySelector('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500);}
function go(path){if(location.hash.slice(1)===path)render();else location.hash=path;}
async function api(path,options={}){const url=new URL(path.replace(/^\//,''),document.baseURI);const res=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await res.json();}catch{throw Error('服务未返回有效数据，请确认本地服务正在运行。');}if(!res.ok||data.error)throw Object.assign(Error(data.error?.message||data.message||`请求失败（${res.status}）`),{status:res.status});return data;}
function tabs(active){return [['home','home','学习'],['courses','book','课程'],['assessment','target','实战'],['me','user','我的']].map(([p,i,t])=>`<a href="#${p}" class="${active===p?'active':''}" ${active===p?'aria-current="page"':''}>${icon(i)}<span>${t}</span></a>`).join('');}
function top(title,back='',meta=''){header.innerHTML=back?`<a class="back-button" href="#${back}" aria-label="返回">${icon('back')}</a><span class="page-title">${esc(title)}</span><span class="header-meta">${esc(meta)}</span>`:`<a class="brand" href="#home"><img src="./assets/yuchai-logo.png" alt="玉柴 YUCHAI"><span class="brand-title">学习中心</span></a><button class="avatar-button" data-action="settings" aria-label="平台说明">学员</button>`;}
function page(content,klass=''){main.innerHTML=`<section class="page ${klass}">${content}</section>`;}
function resetScroll(){document.querySelector('.app-frame').scrollTop=0;window.scrollTo({top:0,behavior:'instant'});}
function courseCard(c){const m=courseMedia(c.id);return `<a class="media-course" href="#course/${c.id}"><div class="media-cover"><img src="${cover(c)}" alt="玉柴官方业务照片" loading="lazy"><span class="video-label">▷ ${m?time(m.durationSeconds):'示范微课'}</span><span class="cover-number">${c.id.slice(1).padStart(2,'0')}</span></div><div class="media-copy"><span class="eyebrow">${esc(c.subtitle)}</span><h3>${esc(c.title)}</h3><div class="course-meta"><span>视频 · 图文 · 自检</span><span class="${completed(c.id)?'done-text':''}">${completed(c.id)?'已完成':'待学习'}</span></div><div class="related-count">${icon('target')} ${c.practiceIds.length} 项关联实战 ${icon('chevron')}</div></div></a>`;}
function practiceCard(p,from=''){return `<a class="practice-card" href="#prepare/${p.id}${from?`/${from}`:''}"><div class="practice-thumb"><img src="${practiceCover(p)}" alt="业务情境配图" loading="lazy"><span class="tag ${published(p)?'green':'amber'}">${published(p)?'已发布':'待独立配置'}</span></div><div class="practice-copy"><h3>${esc(p.title.replace(/陪练$/,''))}</h3><p>${esc(p.roleName)} · ${esc(p.roleTitle)}</p><div class="practice-mode">${dialogueTag(p)}</div><div class="course-meta"><span>建议 ${p.estimatedMinutes} 分钟</span><span>${published(p)?inputLabel(p):'场景规划'}</span></div></div>${icon('chevron')}</a>`;}
function refreshPracticeCards(){for(const el of main.querySelectorAll('.practice-card')){const parts=el.getAttribute('href').slice(1).split('/'),p=practice(parts[1]);if(p)el.outerHTML=practiceCard(p,parts[2]||'');}}
function home(){top();nav.innerHTML=tabs('home');const c=nextCourse();const count=state.completed.length;page(`<div class="greeting"><div><h2>你好，玉柴伙伴</h2><p>今天，把一个销售动作练扎实。</p></div><span class="tag">销售成长</span></div><a class="story-hero" href="#courses"><img src="./assets/dealer-visit.jpg" alt="玉柴官方经销商参访照片"><div class="hero-content"><span class="hero-kicker">YUCHAI SALES ACADEMY</span><h2>懂客户，讲价值<br>把方法带进实战</h2><p>大客户销售学习计划</p><span class="hero-link">探索学习路径 ${icon('arrow')}</span></div></a><div class="learning-summary"><div><b>${count}<small> / 5</small></b><span>课程已完成</span></div><div><b>${D.practices.length}</b><span>关联实战任务</span></div><div><b>3</b><span>原创视频微课</span></div></div><div class="continue-block"><div class="continue-top"><strong>${count===5?'本期课程已完成':'继续学习'}</strong><small>${count*20}%</small></div><div class="progress"><span style="width:${count*20}%"></span></div><h3>${count===5?'与 AI 客户完成一次实战':esc(c.title)}</h3><p class="caption">${count===5?'文字或语音自由作答，结束后查看证据与改进建议。':`${esc(c.subtitle)} · 视频与图文学习`}</p><a class="button full" href="#${count===5?'assessment':`course/${c.id}`}">${count===5?'选择实战考核':'进入课程'}${icon('arrow')}</a></div><div class="section-title"><h2>客户拜访学习路径</h2><small class="caption">七个关键动作</small></div><div class="route-strip">${D.stages.map((s,i)=>`<a class="route-stage ${s.courseIds.every(completed)?'done':s.courseIds.includes(c.id)?'current':''}" href="#course/${s.courseIds[0]}"><b>${s.courseIds.every(completed)?icon('check'):i+1}</b><span>${esc(s.shortTitle)}</span></a>`).join('')}</div><div class="section-title"><h2>本期精选课程</h2><a class="text-button" href="#courses">全部 ${icon('chevron')}</a></div><div class="course-grid">${D.courses.slice(0,2).map(courseCard).join('')}</div><div class="section-title"><h2>把所学带进客户对话</h2><a class="text-button" href="#assessment">实战中心 ${icon('chevron')}</a></div>${D.practices.filter(published).map(p=>practiceCard(p)).join('')}<div class="home-footer"><a class="home-link" href="#review">${icon('refresh')}<div><strong>我的复练</strong><small>从薄弱项回到课程</small></div></a><a class="home-link" href="#history">${icon('file')}<div><strong>实战报告</strong><small>查看对话与评价依据</small></div></a></div>`);}
function library(){top();nav.innerHTML=tabs('courses');page(`<div class="section-heading"><span class="eyebrow">销售学习路径</span><h2>课程中心</h2><p>五门课，覆盖一次完整客户拜访。</p></div><label class="search">${icon('search')}<input type="search" placeholder="搜索课程、需求、谈判…" aria-label="搜索课程" value="${esc(query)}" id="course-search"></label><div class="pills">${[['all','全部课程'],['todo','待学习'],['done','已完成']].map(([v,t])=>`<button data-action="filter" data-value="${v}" class="${filter===v?'active':''}">${t}</button>`).join('')}</div><div id="course-list" class="course-grid"></div><p class="content-footnote">原创示范内容 · 业务图片来自玉柴官方公开资料</p>`);renderList();}
function renderList(){const list=D.courses.filter(c=>(filter!=='todo'||!completed(c.id))&&(filter!=='done'||completed(c.id))&&`${c.title}${c.subtitle}${c.keypoints.join('')}`.includes(query));document.querySelector('#course-list').innerHTML=list.length?list.map(courseCard).join(''):`<div class="empty">${icon('book')}<h3>没有找到相符课程</h3><p>换个关键词，或查看全部课程。</p><button class="button secondary" data-action="clear-filter">查看全部课程</button></div>`;}
function detail(id){const c=course(id),m=courseMedia(id);top('课程学习','courses',completed(id)?'已完成':'示范微课');nav.innerHTML=tabs('courses');page(`${m?`<div class="video-stage"><video id="lesson-video" controls playsinline preload="metadata" poster="${esc(m.poster||cover(c))}" aria-label="${esc(m.title)}"><source src="${esc(m.src)}" type="video/mp4">${m.captions?`<track kind="captions" src="${esc(m.captions)}" srclang="zh" label="中文字幕" default>`:''}</video></div>`:`<img class="lesson-photo" src="${cover(c)}" alt="玉柴官方业务照片">`}<div class="page lesson-body"><span class="eyebrow">${esc(c.subtitle)}</span><h2 class="lesson-title">${esc(c.title)}</h2><div class="lesson-meta"><span>${m?`视频 ${minutes(m.durationSeconds)}`:'示范微课'} · ${c.sections.length} 节图文</span><span>${c.practiceIds.length} 项实战</span></div>${m?`<p class="media-credit">${esc(m.title)} · 原创课件 / ${m.voiceProvider==='Volcengine Doubao TTS'?'豆包合成配音':'合成配音'}</p><div class="video-progress-copy"><span id="video-progress-text">视频学习 ${Math.min(100,Math.round((state.videos[id]?.watched||0)/m.durationSeconds*100))}%</span><span>${state.videos[id]?.done?'已完成视频':'有效观看达到 90% 后完成'}</span></div><div class="section-title"><h3>视频重点定位</h3><small class="caption">点击跳转</small></div><div class="video-chapters">${(m.chapters||[]).map(x=>`<button data-action="seek-video" data-time="${x.time}">${icon('clock')}<span>${esc(x.title)}</span><b>${time(x.time)}</b></button>`).join('')}</div>`:''}<p class="course-description">${esc(c.summary)}</p><div class="learning-goals"><h3>学完这门课，你可以</h3><ul>${c.keypoints.map(x=>`<li>${icon('check')}${esc(x)}</li>`).join('')}</ul></div><div class="section-title"><h2>图文讲义与要点自检</h2></div><ol class="chapter-list">${c.sections.map((s,i)=>`<li><a href="#reader/${id}/${i}"><b>${i+1}</b><span>${esc(s.title)}</span>${(state.visited[id]||[]).includes(i)?icon('checkCircle'):icon('chevron')}</a></li>`).join('')}<li><a href="#reader/${id}/${c.sections.length}"><b>${c.sections.length+1}</b><span>要点自检</span>${completed(id)?icon('checkCircle'):icon('target')}</a></li></ol><a class="button full" href="#reader/${id}/0">${completed(id)?'回看图文讲义':'学习图文讲义'}${icon('arrow')}</a><div class="section-title"><h2>本课关联实战</h2><span class="tag">1 门课 · ${c.practiceIds.length} 项任务</span></div><p class="caption link-explanation">可直接选择客户情境开始实战，也可先学习本课的方法。</p>${c.practiceIds.map(pid=>practiceCard(practice(pid),id)).join('')}<p class="content-footnote">课程为原创教学示范。产品参数、服务和商务条件以玉柴正式资料为准。</p></div>`,'flush');bindVideo(c,m);}
function bindVideo(c,m){
 const v=document.querySelector('#lesson-video');if(!v||!m)return;
 state.videos[c.id]??={watched:0,done:false,ranges:[]};
 const rec=state.videos[c.id];
 // Only unique, normally played time ranges count; seeking does not earn completion.
 if(!Array.isArray(rec.ranges)){rec.ranges=[];rec.watched=0;rec.done=false;}
 let last=v.currentTime,lastSave=rec.watched;
 v.addEventListener('timeupdate',()=>{
  const start=last,delta=v.currentTime-start;last=v.currentTime;
  if(!v.seeking&&!v.paused&&delta>0&&delta<2){
   const ranges=[...rec.ranges,[Math.max(0,start),Math.min(m.durationSeconds,v.currentTime)]].sort((a,b)=>a[0]-b[0]);
   rec.ranges=[];for(const r of ranges){const previous=rec.ranges.at(-1);if(previous&&r[0]<=previous[1]+.02)previous[1]=Math.max(previous[1],r[1]);else rec.ranges.push([...r]);}
   rec.watched=rec.ranges.reduce((n,r)=>n+Math.max(0,r[1]-r[0]),0);rec.done=rec.watched>=m.durationSeconds*.9;
   const text=document.querySelector('#video-progress-text');if(text){text.textContent=`视频学习 ${Math.min(100,Math.round(rec.watched/m.durationSeconds*100))}%`;text.nextElementSibling.textContent=rec.done?'已完成视频':'有效观看达到 90% 后完成';}
   if(rec.watched-lastSave>4||rec.done&&rec.watched-lastSave>.2){save();lastSave=rec.watched;}
  }
 });
 v.addEventListener('seeking',()=>last=v.currentTime);v.addEventListener('pause',save);
 v.addEventListener('error',()=>toast('视频暂时无法播放，请确认本地服务和媒体文件。'));
}
function reader(id,index){const c=course(id),i=Math.max(0,Math.min(parseInt(index)||0,c.sections.length));top(c.subtitle,`course/${id}`,i===c.sections.length?'要点自检':`${i+1} / ${c.sections.length}`);nav.classList.add('hidden');if(i===c.sections.length){if(activeQuiz!==id){selectedAnswer=-1;checkedAnswer=false;activeQuiz=id;}quiz(c);return;}const s=c.sections[i];page(`<div class="reader-progress"><div class="progress"><span style="width:${i/c.sections.length*100}%"></span></div><small>图文讲义 ${i+1} / ${c.sections.length}</small></div>${i===0?`<img class="reader-photo" src="${cover(c)}" alt="玉柴官方业务照片">`:''}<article class="reader-article"><h2>${esc(s.title)}</h2>${(s.paragraphs||[]).map(x=>`<p>${esc(x)}</p>`).join('')}<ul>${(s.bullets||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="knowledge-note">${icon('light')} ${esc(c.practicePrompt)}</div></article><div class="reader-nav"><a class="text-button" href="#${i?`reader/${id}/${i-1}${location.hash.includes('review=1')?'?review=1':''}`:`course/${id}`}">${icon('back')}${i?'上一节':'课程主页'}</a><button class="button" data-action="read-next" data-course="${id}" data-index="${i}">${i===c.sections.length-1?'要点自检':'已读，下一节'}${icon('arrow')}</button></div>`,'flush');}
function quiz(c){const q=c.quiz,correct=checkedAnswer&&selectedAnswer===q.correctIndex;page(`<article class="reader-article"><span class="eyebrow">要点自检</span><h2 class="quiz-question">${esc(q.question)}</h2><div class="quiz-options" role="group" aria-label="选择答案">${q.options.map((x,i)=>`<button class="quiz-option ${selectedAnswer===i?'selected':''} ${checkedAnswer&&selectedAnswer===i?(correct?'correct':'wrong'):''}" data-action="answer" data-index="${i}" aria-pressed="${selectedAnswer===i}"><b>${String.fromCharCode(65+i)}</b><span>${esc(x)}</span></button>`).join('')}</div>${checkedAnswer?`<div class="quiz-feedback ${correct?'':'wrong'}"><strong>${correct?'判断正确':'再确认客户的真实约束'}</strong>${esc(q.explanation)}</div>`:''}</article><div class="reader-nav"><a class="text-button" href="#course/${c.id}">回看课程</a><button class="button" data-action="${correct?'complete':'check-answer'}" data-course="${c.id}" ${selectedAnswer<0?'disabled':''}>${correct?'完成本课':'确认答案'}${icon('arrow')}</button></div>`,'flush');}
function assessment(){top();nav.innerHTML=tabs('assessment');const list=D.practices.filter(p=>practiceFilter==='all'||(practiceFilter==='live'?published(p):!published(p)));page(`<div class="section-heading"><span class="eyebrow">学方法，练实战</span><h2>实战考核</h2><p>在不同客户情境里，把同一个方法用扎实。</p></div><div class="assessment-banner"><img src="./assets/export-buses.jpg" alt="玉柴官方海外客车交付照片"><div><strong>从动力方案，到客户决策</strong><span>文字 / 语音自由表达 · 对话后查看报告</span></div></div><div class="pills">${[['all','全部任务'],['live','已发布'],['planned','待配置']].map(([v,t])=>`<button data-action="practice-filter" data-value="${v}" class="${practiceFilter===v?'active':''}">${t}</button>`).join('')}</div>${list.map(p=>practiceCard(p)).join('')}<p class="content-footnote">已发布任务可直接开始，关联课程供学习与复练参考。企业正式考试计次、认证与补考规则待配置。</p>`);}
function prepare(id,from=''){const p=practice(id);if(!p){go('assessment');return;}top('实战准备',from?`course/${from}`:'assessment',published(p)?'已发布':'场景规划');nav.classList.add('hidden');page(`<img class="prepare-photo" src="${practiceCover(p)}" alt="业务情境配图"><div class="page"><div class="prepare-tags"><span class="tag ${published(p)?'green':'amber'}">${published(p)?'已发布实战':'待独立配置'}</span>${dialogueTag(p)}</div><h2 class="prepare-title">${esc(p.title.replace(/陪练$/,''))}</h2><div class="prepare-persona"><div class="role-avatar">${esc(p.roleName[0])}</div><div><h3>${esc(p.roleName)}</h3><p>${esc(p.roleTitle)} · AI 客户角色</p></div></div><p class="caption">${esc(p.brief)}</p><div class="section-title"><h2>本次实战目标</h2></div><ul class="prep-goals">${p.goals.map(x=>`<li>${icon('check')}${esc(x)}</li>`).join('')}</ul><div class="section-title"><h2>推荐学习</h2><small class="caption">${published(p)?'可先学后练，也可直接实战':'可提前学习相关方法'}</small></div>${p.courseIds.map(cid=>`<a class="related-lesson" href="#course/${cid}">${icon(completed(cid)?'checkCircle':'book')}<span>${esc(course(cid).subtitle)}</span><small>${completed(cid)?'已完成':'待学习'}</small>${icon('chevron')}</a>`).join('')}${published(p)?`<div class="section-title"><h2>选择表达方式</h2></div><div class="input-choice"><label><input type="radio" name="input-mode" value="text" ${textReady(p)?'checked':'disabled'}><span>${icon('file')}<strong>文字</strong><small>${textReady(p)?'输入并发送，随时切换语音':'当前文字通道待恢复'}</small></span></label><label><input type="radio" name="input-mode" value="voice" ${textReady(p)?'':'checked'}><span>${icon('mic')}<strong>语音</strong><small>开启时申请麦克风权限</small></span></label></div>${!textReady(p)?'<div class="channel-note">当前场景的文字连接受后台配置阻断，恢复后可在同一实战中使用。语音链路已有合成输入验证，真人录音由学员主动授权。</div>':''}<div class="notice">开启将创建真实练习。你的作答传送至陪练服务，结束后按该场景配置生成报告。</div><button class="button full" data-action="start-practice" data-practice="${id}" data-from="${from}" ${!available(p)?'disabled':''}>${!available(p)?'实战服务暂不可用':'开始实战考核'}${icon('arrow')}</button>`:`<div class="notice">此场景为训练任务规划。配置独立客户角色、评分规则并发布后，可从本课直接开启实战。</div><button class="button secondary full" disabled>待独立配置</button>`}</div>`,'flush');}
function bubble(m){return `<div class="chat-bubble ${m.speaker==='learner'?'user':''}"><small>${m.speaker==='learner'?'我的表达':'AI 客户'}${m.partial?' · 语音异常，回复未完整结束':m.interim?' · 生成中':''}</small>${esc(m.text)}</div>`;}
let composerKey='';
function updateComposer(force=false){
 const el=document.querySelector('#session-composer');if(!el||!session)return;
 const key=JSON.stringify([session.inputMode,session.connected,session.connecting,session.voicePhase,session.voiceBusy,session.error,session.playback,session.muted]);
 if(!force&&key===composerKey)return;composerKey=key;
 el.classList.toggle('is-voice',session.inputMode==='voice');
 el.innerHTML=sessionComposer(session,{textAvailable:textReady(practice(session.practiceId)),icon,esc,time});
}
function renderCall(){
 top('实战考核','assessment',dialogueLabel(session.dialogueMode));nav.classList.add('hidden');const p=practice(session.practiceId);
 page(`<div class="session-shell"><div class="session-person"><div class="role-avatar">${esc(p.roleName[0])}</div><div><h3>${esc(p.roleName)}</h3><p>${esc(p.title.replace(/陪练$/,''))}</p></div><span id="call-timer">${time(session.elapsed)}</span></div><div class="session-context">${icon('target')}<span>${esc(p.goals[0])}</span></div><div class="chat-area" id="chat-area" aria-live="polite"></div><div id="session-composer" class="chat-composer"></div></div>`,'flush');
 updateComposer(true);updateChat();
}

function updateChat(){updateComposer();const el=document.querySelector('#chat-area');if(el&&session){el.innerHTML=(session.transcript.length?session.transcript.map(bubble).join(''):`<div class="chat-empty">${icon('handshake')}<h3>用一次专业开场，开启对话</h3><p>介绍身份与来意，问清客户的真实需求。<br>你可以自由输入，或切换语音。</p></div>`)+(session.asr&&session.transcript.at(-1)?.text!==session.asr&&!(session.inputMode==='text'&&(session.sentTexts||[]).includes(session.asr))?bubble({speaker:'learner',text:session.asr,interim:true}):'')+(session.chat?bubble({speaker:'customer',text:session.chat,interim:true}):'');el.scrollTop=el.scrollHeight;}const status=document.querySelector('#call-status');if(status)status.textContent=session.inputMode==='voice'?voiceStatus(session):session.status;const error=document.querySelector('#session-error');if(error){error.textContent=session.error||'';error.classList.toggle('hidden',!session.error);}}
function clock(){clearInterval(timer);timer=setInterval(()=>{if(!session||session.ended)return;session.elapsed++;const el=document.querySelector('#call-timer');if(el)el.textContent=time(session.elapsed);const recording=document.querySelector('.record-duration');if(recording&&session.recordStartedAt)recording.textContent=time(Math.floor((Date.now()-session.recordStartedAt)/1000));},1000);}
async function startPractice(id,from){const p=practice(id);if(startingLive||!published(p)||!available(p))return;const mode=document.querySelector('input[name=input-mode]:checked')?.value||'text';startingLive=true;nav.classList.add('hidden');page(`<div class="busy">${icon('headset')}<h2>正在准备 AI 客户</h2><p>创建实战记录，等待角色就绪。</p><div class="busy-step"><span class="status-dot"></span>请稍候</div></div>`);try{const x=await api('/api/exercises',{method:'POST',body:JSON.stringify({planId:p.planId,roleId:p.roleId})});session={id:x.exerciseId||x.id,practiceId:id,kind:'live',dialogueMode:x.dialogueMode,inputMode:mode,elapsed:0,transcript:[],status:'准备客户中',connected:false,connecting:false,playback:true,soundPreferred:true,voicePhase:'idle'};state.realReports.push({id:session.id,practiceId:id,date:new Date().toISOString()});save();let ready=x.status==='running';for(let i=0;!ready&&i<45;i++){await new Promise(r=>setTimeout(r,1000));const d=await api(`/api/exercises/${session.id}`);ready=d.status==='running';if(['finished','evaluating','evaluated','failed','error'].includes(d.status))throw Error(`角色未进入可对话状态（${d.status}）。`);}if(!ready)throw Error('客户准备超过 45 秒，请结束本条记录后重试。');go(`session/${id}/${session.id}`);await connect();}catch(e){if(session?.id){session.error=e.message;go(`session/${id}/${session.id}`);}else{prepare(id,from);toast(e.message);}}finally{startingLive=false;}}
async function connect(){
 if(!session||session.connected||session.connecting||session.ended)return;
 const current=session;current.connecting=true;current.error='';current.status='正在建立实战连接';renderCall();
 await voice?.stop().catch(()=>{});
 const client=voice=new SparringVoice({
  onStatus:status=>{if(session!==current||current.ended)return;current.status=String(status);updateChat();},
  onError:e=>{if(session!==current||current.ended)return;if(e.kind==='playback'&&current.voicePhase==='error'&&client.inputError){current.playback=false;updateChat();return;}current.error=e.message||String(e);if(!e.recoverable){current.connected=false;current.connecting=false;current.voicePhase='error';}else if(e.kind==='playback'){current.playback=false;}else if(e.kind==='input'){current.voicePhase='error';}updateChat();},
  onEvent:e=>{
   if(session!==current||current.ended)return;const j=e.json||{};
   if(e.event===451)current.asr=j.results?.[0]?.text||'';
   if(e.event===459&&current.asr){const last=current.transcript.at(-1),isTypedEcho=current.inputMode==='text'&&(current.sentTexts||[]).includes(current.asr);if(!isTypedEcho&&(last?.speaker!=='learner'||last.text!==current.asr))current.transcript.push({speaker:'learner',text:current.asr});current.asr='';}
   if(e.event===550){current.chat=(current.chat||'')+(j.content||'');if(!current.voiceBusy&&current.voicePhase!=='recording')current.voicePhase='replying';}
   if(e.event===559){if(current.chat)current.transcript.push({speaker:'customer',text:current.chat});current.chat='';if(!current.voiceBusy&&current.voicePhase!=='recording')current.voicePhase=client.inputMode==='voice'?'listening':'idle';}
   if(e.event===560){if(current.chat)current.transcript.push({speaker:'customer',text:current.chat,partial:true});current.chat='';current.playback=false;current.error='客户朗读异常，本条回复未完整结束。';}
   if(e.event===999){current.playback=false;current.muted=true;toast(j.show_label||'请注意业务表达边界。');}
   if(e.event===139){current.connected=false;current.status='客户对话已终止，请结束并提交评估';}
   updateChat();
  }
 });
 try{
  // Establish the dialogue first. The large voice button starts microphone
  // capture directly from a user gesture, independently of socket latency.
  await client.start(current.id,{inputMode:'text',dialogueMode:current.dialogueMode,playbackEnabled:current.soundPreferred!==false});
  if(current.ended||session!==current){await client.stop();return;}
  current.connected=true;current.connecting=false;current.voicePhase='idle';current.muted=false;current.status='客户已就绪，请主动开场';clock();renderCall();
 }catch(e){await client.stop().catch(()=>{});current.connected=false;current.connecting=false;current.error=e.message;renderCall();}
}
async function setInputMode(mode){
 if(!session||session.ended||session.voiceBusy)return;
 if(mode==='text'&&!textReady(practice(session.practiceId))){toast('此场景的文字通道待恢复。');return;}
 session.draft=document.querySelector('#chat-input')?.value||session.draft||'';
 try{if(voice?.ready)await voice.setInputMode('text');session.inputMode=mode;session.voicePhase='idle';session.muted=false;session.recordStartedAt=null;session.error='';renderCall();}catch(e){session.error=e.message;updateChat();}
}
async function toggleVoice(){
 if(!session||session.ended||session.voiceBusy||!session.connected)return;
 const current=session,client=voice;
 if(client.inputMode==='voice'){
  if(current.dialogueMode==='text'){current.voiceBusy=true;current.voicePhase='sending';updateComposer();try{await client.finishVoiceTurn();current.recordStartedAt=null;current.voicePhase='waiting';}catch(e){current.error=e.message;current.voicePhase=client.inputMode==='voice'?'recording':'error';}finally{current.voiceBusy=false;updateChat();}return;}
  current.muted=!current.muted;client.setMuted(current.muted);current.voicePhase=current.muted?'paused':'listening';updateChat();return;
 }
 current.voiceBusy=true;current.voicePhase='requesting';current.error='';updateComposer();
 // Both audio resumes begin inside this explicit click, before any await.
 if(current.soundPreferred!==false)void client.setPlaybackEnabled(true).then(()=>{if(session===current){current.playback=client.playbackEnabled;updateComposer();}}).catch(()=>{});
 try{await client.setInputMode('voice');if(session!==current||current.ended)return;current.recordStartedAt=Date.now();current.muted=false;current.voicePhase=current.dialogueMode==='text'?'recording':'listening';}
 catch(e){current.error=e.message;current.voicePhase='error';}
 finally{current.voiceBusy=false;updateChat();}
}

async function sendText(){
 const input=document.querySelector('#chat-input'),text=input?.value.trim();if(!text||!session?.connected||session.ended||session.sending)return;
 const message={speaker:'learner',text};session.sending=true;session.transcript.push(message);session.sentTexts??=[];session.sentTexts.push(text);
 try{await voice.sendText(text);session.draft='';input.value='';session.status='已发送，等待客户回应';updateChat();}
 catch(e){const index=session.transcript.indexOf(message);if(index>=0)session.transcript.splice(index,1);const sentIndex=session.sentTexts.lastIndexOf(text);if(sentIndex>=0)session.sentTexts.splice(sentIndex,1);updateChat();toast(e.message||'发送失败，请重试。');}
 finally{session.sending=false;}
}
function modal(title,body,buttons){sheet.innerHTML=`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="button-row">${buttons.map(b=>`<button class="button ${b.secondary?'secondary':''}" data-action="${b.action}">${esc(b.label)}</button>`).join('')}</div>`;sheet.showModal();}
async function endLive(){sheet.close();if(!session?.id||session.ending)return;session.ending=true;clearInterval(timer);await voice?.stop().catch(()=>{});session.connected=false;page(`<div class="busy">${icon('file')}<h2>正在提交实战评估</h2><p>按本次实际对话生成报告。</p></div>`);try{await api(`/api/exercises/${session.id}/end`,{method:'POST',body:'{}'});session.ended=true;go(`report/live/${session.id}`);}catch(e){session.error=`结束请求未成功：${e.message}`;renderCall();}finally{session.ending=false;}}

function normalizeLive(raw,id,meta={}) {
 const p=D.practices.find(p=>p.planId===meta.planId);
 const normalized=normalizeReportDetail(raw);
 const detail=raw.report_detail||{};
 const dimensions=normalized.dimensions.map(d=>({...d,items:d.items.map(item=>({...item,courseId:matchCourse(item.title)}))}));
 return {...normalized,id,isMock:false,
  isSyntheticVerification:SYNTHETIC_EXERCISE_IDS.has(String(id))||TEXT_VERIFICATION_IDS.has(String(id)),
  verificationLabel:TEXT_VERIFICATION_IDS.has(String(id))?'文字联调验证':'合成语音验证',
  practiceId:p?.id,scenarioTitle:p?.title.replace(/陪练$/,'')||meta.name||'实战报告',
  durationLabel:typeof detail.time_spent==='number'&&Number.isFinite(detail.time_spent)&&detail.time_spent>=0?`对话 ${minutes(detail.time_spent)}`:'未返回对话时长',
  dimensions,reviewRecommendations:liveRecommendations(detail.evaluation_rule||[]),dataOrigin:'真实接口报告'};
}
function matchCourse(text=''){
 if(/开场|身份|礼貌/.test(text))return 'c1';
 if(/谈判|成交|跟进|独家|准入|下一步|决策推动|商务|试销|收尾|结束语/.test(text))return 'c5';
 if(/需求|痛点|决策链|复述|信息确认|工况|经营影响|经营现状/.test(text))return 'c2';
 if(/异议|风险|顾虑|客诉|投诉|根因|调查|临时处置|证据保全|事实核查/.test(text))return 'c4';
 if(/技术|产品|服务保障|方案|价值|售后|运营|备件|适配|规范偏差|负载|验证|测试|并机|冗余|成本|TCO|可靠性证据|性能边界/.test(text))return 'c3';
 if(/信任|态度|表达/.test(text))return 'c1';
 return null;
}
function liveRecommendations(rules){
 const out=[];const seen=new Set();
 for(const x of rules){
  if(typeof x.eval_total_score!=='number'||x.eval_total_score<=0||typeof x.eval_score!=='number'||x.eval_score/x.eval_total_score>=.8)continue;
  const topics=(x.related_scene||[]).flatMap(sc=>sc.topics||[]).filter(t=>t.suggestion&&!/^无需/.test(t.suggestion));
  const candidates=[...topics,...(x.eval_suggestion?[{name:x.name,suggestion:x.eval_suggestion}]:[])];
  for(const t of candidates){const cid=matchCourse(t.name)||matchCourse(t.suggestion);if(!cid||seen.has(cid))continue;seen.add(cid);out.push({courseId:cid,title:`建议回看：${course(cid).subtitle}`,reason:t.suggestion});if(out.length===3)return out;}
 }
 return out;
}
async function liveReport(id){const token=++reportPoll;top('考核报告','history','真实报告');nav.innerHTML=tabs('assessment');activeReport=null;page(`<div class="busy">${icon('file')}<h2>正在查询本次练习</h2><p>评估完成前，不显示分数或通过结论。<br>你可以稍后从“我的报告”再次查看。</p><div class="busy-step"><span class="status-dot"></span>正在检查评估状态</div><button class="button secondary" data-action="refresh-report" data-id="${esc(id)}">刷新评估状态</button></div>`);try{for(let i=0;i<90;i++){if(token!==reportPoll||route[0]!=='report')return;const d=await api(`/api/exercises/${encodeURIComponent(id)}`);if(d.status==='evaluated'){const raw=await api(`/api/exercises/${encodeURIComponent(id)}/report`);if(token!==reportPoll)return;activeReport=normalizeLive(raw,id,d);if(!state.realReports.some(r=>String(r.id)===String(id))){state.realReports.push({id,date:new Date().toISOString(),isSyntheticVerification:activeReport.isSyntheticVerification});save();}reportView(activeReport);return;}if(['preparing','initializing','running'].includes(d.status)){page(`<div class="busy">${icon('headset')}<h2>这次练习尚未结束</h2><p>练习处于${d.status==='running'?'对话进行中':'准备中'}状态。<br>请在原对话页面主动结束，再查看评估报告。</p>${session?.id&&String(session.id)===String(id)?`<a class="button" href="#session/${session?.practiceId}/${esc(id)}">返回本次对话</a>`:''}<a class="text-button" style="display:block;margin-top:14px" href="#history">返回报告列表</a></div>`);return;}if(['failed','error','invalid'].includes(d.status))throw new Error(`评估未形成有效报告（${d.status}）。请联系课程管理员。`);await new Promise(resolve=>setTimeout(resolve,2000));}if(token===reportPoll)page(`<div class="busy">${icon('clock')}<h2>评估仍在进行</h2><p>尚未收到有效报告，请稍后刷新。<br>等待不会被记作零分或未通过。</p><button class="button" data-action="refresh-report" data-id="${esc(id)}">再次查看</button><a class="text-button" style="display:block;margin-top:14px" href="#history">返回报告列表</a></div>`);}catch(e){if(token===reportPoll)page(`<div class="busy">${icon('info')}<h2>暂时无法读取报告</h2><p>${esc(e.message)}</p><button class="button" data-action="refresh-report" data-id="${esc(id)}">重新查询</button><a class="text-button" style="display:block;margin-top:14px" href="#history">返回报告列表</a></div>`);}}
function reportView(r) {
 reportUI=initialReportUI();
 top(r.isMock?'报告参考样例':r.isSyntheticVerification?'接口验证报告':'考核报告','history',r.isMock?'报告参考':r.isSyntheticVerification?r.verificationLabel:'真实报告');
 nav.innerHTML=tabs('assessment');
 page(reportPage(r,{esc,icon,course},reportUI),'flush report-page');
}
function refreshReportPanel(focusSelector='',scroll=false) {
 const panel=document.querySelector('#report-panel');
 if(!panel||!activeReport)return;
 panel.innerHTML=reportPanel(activeReport,{esc,icon,course},reportUI);
 document.querySelectorAll('.report-tabs button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===reportUI.tab)));
 const target=focusSelector?panel.querySelector(focusSelector):null;
 if(target){target.focus({preventScroll:true});if(scroll)target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
function demoReport(){clearInterval(timer);activeReport=D.demoReport;state.demoReportSeen=true;save();reportView(activeReport);}
function review(){top('我的复练','home','按薄弱项学习');nav.innerHTML=tabs('home');const r=activeReport||(state.demoReportSeen?D.demoReport:null);page(`<h2>把建议变成下一次行动</h2><p class="caption" style="margin:9px 0 23px">${r?'从报告里的薄弱项，回看对应方法，再进入客户对话。':'完成一次实战考核后，报告会带你回到需要练习的课程。'}</p>${r?`<span class="tag ${r.isMock?'red':'green'}">${r.isMock?'根据参考样例':'根据当前真实报告'}</span><div style="margin-top:18px">${(r.reviewRecommendations||[]).map(x=>`<a class="review-reco" href="#reader/${x.courseId}/0?review=1">${icon(state.reviewed.includes(x.courseId)?'checkCircle':'refresh')}<div><strong>${esc(x.title)}</strong><p>${esc(x.reason)}</p></div>${icon('chevron')}</a>`).join('')}</div><div class="section-title"><h2>复练前，带走一句话</h2></div><div class="learning-goals"><p class="caption">${esc(course('c5').practicePrompt)}</p></div><a class="button full" style="margin-top:22px" href="#${r.isMock?'assessment':`prepare/${r.practiceId||'p-overseas'}`}">再与客户练一次 ${icon('arrow')}</a>`:`<div class="empty">${icon('target')}<h3>还没有考核反馈</h3><p>选择已发布任务，直接开始一次实战考核。</p><a class="button" href="#assessment">查看考核任务 ${icon('arrow')}</a></div>`}`);}

async function history(){top('我的实战报告','me','真实记录');nav.innerHTML=tabs('me');page(`<h2>每次实战，都留下依据</h2><p class="caption history-intro">已发布实战的实际练习记录。</p><div id="history-list"><div class="skeleton"></div></div><a class="reference-report" href="#report/sample">${icon('file')}<div><strong>报告参考样例</strong><small>完整拜访 · 75 分固定样例 · 不计成绩</small></div>${icon('chevron')}</a>`);try{const d=await api('/api/history?pageSize=20');if(route[0]!=='history')return;const labels={preparing:'准备中',initializing:'准备中',running:'对话未结束',evaluating:'评估中',finished:'等待评估',evaluated:'评估完成',failed:'评估失败',error:'异常'};document.querySelector('#history-list').innerHTML=d.list?.length?d.list.map(x=>`<a class="history-row" href="#report/live/${x.exercise_id}"><strong>${esc(x.plan_name||'实战练习')}</strong><p>${esc(x.role_name||'AI客户')} · 记录 ${x.exercise_id}${SYNTHETIC_EXERCISE_IDS.has(String(x.exercise_id))?' · 合成语音接口验证':TEXT_VERIFICATION_IDS.has(String(x.exercise_id))?' · 文字联调验证':''}</p><div class="stat-row"><small>${esc(labels[x.status]||x.status)}</small><span class="tag ${x.status==='evaluated'?'green':'amber'}">${x.status==='evaluated'&&typeof x.report?.final_score==='number'?`${x.report.final_score} 分`:'尚无有效评分'}</span></div></a>`).join(''):'<div class="empty"><h3>还没有实战记录</h3><p>选择已发布任务，开启第一次客户对话。</p><a class="button" href="#assessment">进入实战中心</a></div>';}catch(e){if(route[0]==='history')document.querySelector('#history-list').innerHTML=`<div class="empty"><h3>暂时无法查询真实记录</h3><p>${esc(e.message)}</p><button class="button secondary" data-action="reload-history">重试</button></div>`;}}
function me(){top();nav.innerHTML=tabs('me');page(`<div class="profile"><div class="role-avatar">学</div><div><h2>玉柴销售学员</h2><p>销售成长计划 · 本地学习进度</p></div></div><div class="profile-stats"><div><strong>${state.completed.length}</strong><small>课程完成</small></div><div><strong>${Object.values(state.videos).filter(x=>x.done).length}</strong><small>视频学习完成</small></div><div><strong>${state.reviewed.length}</strong><small>复习课程</small></div></div><a class="menu-item" href="#courses">${icon('book')}<span>我的课程</span>${icon('chevron')}</a><a class="menu-item" href="#history">${icon('file')}<span>我的实战报告</span>${icon('chevron')}</a><a class="menu-item" href="#review">${icon('refresh')}<span>我的复练</span>${icon('chevron')}</a><button class="menu-item" data-action="settings">${icon('info')}<span>平台与内容说明</span>${icon('chevron')}</button><button class="menu-item" data-action="reset">${icon('history')}<span>重置本地学习进度</span>${icon('chevron')}</button>`);}
function render(){const requested=location.hash.slice(1).split('?')[0].split('/').filter(Boolean);if(session?.id&&!session.ended&&route[0]==='session'&&requested[0]!=='session'){location.hash=`session/${session.practiceId}/${session.id}`;modal('实战仍在进行','请先结束本次对话并提交评估，再离开实战页面。',[{label:'继续对话',action:'close',secondary:true},{label:'结束并评估',action:'end-live'}]);return;}route=requested;reportPoll++;nav.classList.remove('hidden');main.classList.toggle('in-session',route[0]==='session');switch(route[0]){case 'courses':library();break;case 'course':detail(route[1]);break;case 'reader':reader(route[1],route[2]);break;case 'assessment':assessment();break;case 'prepare':prepare(route[1],route[2]);break;case 'session':if(session&&String(session.id)===route[2])renderCall();else{top('实战记录','assessment');nav.classList.add('hidden');page(`<div class="empty"><h3>当前连接已离开</h3><p>会话连接只保留在开启它的页面中。请到原页面结束对话，或查询记录状态。</p><a class="button" href="#report/live/${esc(route[2]||'')}">查询记录</a></div>`);}break;case 'report':route[1]==='live'?liveReport(route[2]):route[1]==='sample'?demoReport():history();break;case 'history':history();break;case 'review':review();break;case 'me':me();break;default:home();}resetScroll();}
document.addEventListener('input',e=>{if(e.target.id==='course-search'){query=e.target.value;renderList();}if(e.target.id==='chat-input'&&session)session.draft=e.target.value;});
document.addEventListener('submit',e=>{if(e.target.id==='chat-form'){e.preventDefault();sendText();}});
document.addEventListener('keydown',e=>{if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendText();}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const a=el.dataset.action;if(startingLive&&!['close'].includes(a)){toast('正在准备实战，请稍候。');return;}
if(a==='filter'){filter=el.dataset.value;library();}
else if(a==='practice-filter'){practiceFilter=el.dataset.value;assessment();}
else if(a==='clear-filter'){filter='all';query='';library();}
else if(a==='seek-video'){const v=document.querySelector('#lesson-video');if(v){v.currentTime=Number(el.dataset.time);v.scrollIntoView({block:'center',behavior:'smooth'});}}
else if(a==='read-next'){const id=el.dataset.course;state.visited[id]??=[];if(!state.visited[id].includes(Number(el.dataset.index)))state.visited[id].push(Number(el.dataset.index));save();go(`reader/${id}/${Number(el.dataset.index)+1}${location.hash.includes('review=1')?'?review=1':''}`);}
else if(a==='answer'){selectedAnswer=Number(el.dataset.index);checkedAnswer=false;quiz(course(route[1]));}
else if(a==='check-answer'){checkedAnswer=true;quiz(course(el.dataset.course));}
else if(a==='complete'){const c=course(el.dataset.course);if((state.visited[c.id]||[]).length<c.sections.length){toast('请先读完各节图文讲义。');go(`reader/${c.id}/${c.sections.findIndex((_,i)=>!(state.visited[c.id]||[]).includes(i))}`);return;}if(courseMedia(c.id)&&!state.videos[c.id]?.done){toast('自检回答正确，请完成视频学习后再次确认本课。');go(`course/${c.id}`);return;}if(!completed(c.id))state.completed.push(c.id);if(location.hash.includes('review=1')&&!state.reviewed.includes(c.id))state.reviewed.push(c.id);save();go(`course/${c.id}`);toast(`本课学习进度已记录。`);}
else if(a==='start-practice')startPractice(el.dataset.practice,el.dataset.from);
else if(a==='input-mode')setInputMode(el.dataset.mode);
else if(a==='voice-toggle')toggleVoice();

else if(a==='playback'){if(!voice?.ready)return;try{session.soundPreferred=!session.playback;await voice.setPlaybackEnabled(session.soundPreferred);session.playback=voice.playbackEnabled;session.error='';updateChat();}catch(err){toast(err.message||'无法开启声音。');}}
else if(a==='reconnect')connect();
else if(a==='end-session')modal('结束本次实战？','结束后提交实际对话进行评估，报告生成需要一段时间。',[{label:'继续对话',action:'close',secondary:true},{label:'结束并评估',action:'end-live'}]);
else if(a==='end-live')endLive();
else if(a==='refresh-report')liveReport(el.dataset.id);
else if(a==='reload-history')history();
else if(a==='report-tab'){
 if(!['overview','scoring','replay'].includes(el.dataset.tab))return;
 reportUI.tab=el.dataset.tab;refreshReportPanel();
 document.querySelector('#report-panel')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 if(!el.closest('.report-tabs')){const heading=document.querySelector('#report-panel h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}}
}
else if(a==='report-dimension'){
 const index=Number(el.dataset.index);if(!Number.isInteger(index)||!activeReport?.dimensions?.[index])return;
 reportUI.tab='scoring';reportUI.dimension=index;reportUI.topic=null;
 refreshReportPanel(`#report-dimension-${index} summary`,true);
}
else if(a==='report-filter'){
 if(!['all','learner','feedback'].includes(el.dataset.filter))return;
 reportUI.filter=el.dataset.filter;refreshReportPanel(`[data-action="report-filter"][data-filter="${reportUI.filter}"]`);
}
else if(a==='report-jump'){
 const available=new Set((activeReport?.transcript||[]).map(turn=>turn.id));
 const ids=(el.dataset.turns||'').split(',').filter(id=>available.has(id));if(!ids.length)return;
 reportUI.tab='replay';reportUI.filter='all';reportUI.highlighted=ids;
 refreshReportPanel(`#report-turn-${CSS.escape(ids[0])}`,true);
}
else if(a==='report-topic'){
 const index=Number(el.dataset.index),itemId=el.dataset.topic;
 const items=activeReport?.dimensions?.[index]?.items||[];if(!items.some(item=>(item.itemId||item.id)===itemId))return;
 reportUI.tab='scoring';reportUI.dimension=index;reportUI.topic=itemId;
 refreshReportPanel(`#report-topic-${CSS.escape(itemId)}`,true);
}
else if(a==='settings')modal('学习平台说明',`五门原创示范课程包含三段可播放微课、图文讲义和自检。课程关联 ${D.practices.length} 项实战，当前 ${D.practices.filter(published).length} 项已发布${D.practices.some(p=>!published(p))?'，其余待配置':''}。可直接实战，也可先学习；准备页标记各场景可用的表达方式。学习进度保存在当前浏览器；企业正式考试、认证与课件管理待接入。`,[{label:'知道了',action:'close'}]);
else if(a==='reset')modal('重置本地学习进度？','清除此浏览器的课程和视频学习进度，远端实战记录仍保留。',[{label:'保留进度',action:'close',secondary:true},{label:'重置进度',action:'confirm-reset'}]);
else if(a==='confirm-reset'){sheet.close();state={completed:[],visited:{},reviewed:[],videos:{},demoReportSeen:false,realReports:[]};save();go('home');toast('本地学习进度已重置。');}
else if(a==='story-start')go('courses');
else if(a==='story-exam')go('assessment');
else if(a==='story-report')go('history');
else if(a==='close')sheet.close();});
document.addEventListener('click',e=>{const anchor=e.target.closest('a[href^="#"]');if(anchor&&startingLive){e.preventDefault();toast('正在准备实战，请稍候。');return;}if(anchor&&session?.id&&!session.ended&&route[0]==='session'&&anchor.hash!==location.hash){e.preventDefault();modal('实战仍在进行','结束本次对话并提交评估后，再继续浏览。',[{label:'继续对话',action:'close',secondary:true},{label:'结束并评估',action:'end-live'}]);}},true);
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',e=>{if(session?.id&&!session.ended){e.preventDefault();e.returnValue='';}});
render();
Promise.allSettled([api('/api/health'),api('/api/plans'),...D.practices.filter(published).map(p=>api(`/api/plans/${p.planId}`))]).then(([h,p,...details])=>{for(const result of details)if(result.status==='fulfilled')planDetails.set(result.value.id,result.value);plans=p.status==='fulfilled'?p.value.plans:[];liveAvailable=h.status==='fulfilled'&&h.value.mode==='live';document.querySelector('#connection-status').textContent=p.status==='fulfilled'?`真实计划已读取 · ${plans.length} 项`:'真实计划暂不可用';if(route[0]==='assessment')assessment();if(route[0]==='prepare')prepare(route[1],route[2]);if(route[0]==='home'||!route[0])home();if(route[0]==='course')refreshPracticeCards();});
