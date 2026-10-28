/* Activity UI: synthetic read-only project and board events, no server audit log. */
(function () {
  "use strict";
  const SD=window.SD, FB=window.FB, P=window.Portfolio, S=window.Screens;
  const $=s=>document.querySelector(s), esc=S.escape, icon=S.icon;
  const CATEGORY={cards:"Cards",comments:"Comments",moves:"Moves",assignments:"Assignments",images:"Images",status:"Status",due:"Due dates",access:"Access",trash:"Trash",import:"Import",settings:"Settings"};
  const ICON={cards:"board",comments:"comment",moves:"move",assignments:"users",images:"image",status:"check-circle",due:"calendar",access:"lock",trash:"trash",import:"upload",settings:"settings"};
  const params=new URLSearchParams(location.search);
  const state={project:params.get("project")||"all",actor:"all",category:"all",date:"all",q:"",limit:10};
  const admins=()=>S.can("manageProject");
  function eventCategory(event) { return ({plus:"cards",user:"assignments",calendar:"due",comment:"comments",move:"moves",image:"images",check:"status"})[event.icon]||"cards"; }
  function accessibleEvents() {
    const projects=P.projects(), events=[];
    for (const p of projects) for (const b of P.boards(p.id)) {
      const data=P.fullBoardData(b.id); if (!data) continue;
      for (const card of data.cards) for (const e of (Array.isArray(card.activity)?card.activity:[])) {
        events.push({id:e.id,scope:"card",category:eventCategory(e),actorId:e.actorId,text:e.text,at:e.at,projectId:p.id,boardId:b.id,cardId:card.id,cardKey:card.key,cardTitle:card.title});
      }
    }
    if (admins()) for (const e of SD.accessEvents) {
      const p=P.project(e.projectId); if (!p) continue;
      const boardScoped=["trash","import","settings"].includes(e.category) || !!e.boardId;
      const boardId=e.boardId || (SD.project(e.projectId)?.boardIds?.length===1 ? SD.project(e.projectId).boardIds[0] : "");
      if (boardScoped && (!boardId || !P.board(boardId) || P.board(boardId).projectId!==p.id)) continue;
      events.push({...e,boardId:boardScoped?boardId:""});
    }
    return events;
  }
  function filteredEvents() {
    const q=state.q.trim().toLowerCase(), cutoff=state.date==="all"?0:Date.now()-Number(state.date)*86400000;
    return accessibleEvents().filter(e=>{
      if(state.project!=="all"&&e.projectId!==state.project) return false;
      if(state.actor!=="all"&&e.actorId!==state.actor) return false;
      if(state.category!=="all"&&e.category!==state.category) return false;
      if(cutoff && new Date(e.at).getTime()<cutoff) return false;
      const p=P.project(e.projectId), b=e.boardId?P.board(e.boardId):null;
      return !q || [e.text,e.cardKey,e.cardTitle,p?.name,b?.name,S.personName(e.actorId),CATEGORY[e.category]].join(" ").toLowerCase().includes(q);
    }).sort((a,b)=>new Date(b.at)-new Date(a.at));
  }
  function dayKey(iso) {
    const d=new Date(iso),today=new Date(),yesterday=new Date(); yesterday.setDate(today.getDate()-1);
    const same=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
    if(same(d,today))return "Today"; if(same(d,yesterday))return "Yesterday";
    return new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",year:d.getFullYear()===today.getFullYear()?undefined:"numeric"}).format(d);
  }
  function item(e) {
    const p=P.project(e.projectId), b=e.boardId?P.board(e.boardId):null, label=CATEGORY[e.category]||"Activity", actor=FB.person(e.actorId);
    const href=e.scope==="card"&&b&&e.cardId?P.boardHref(b.id,e.cardId):"";
    const card=href?`<a class="event-card" href="${esc(href)}">${esc(e.cardKey||"Card")} <span>${esc(e.cardTitle||"")}</span>${icon("arrow-right")}</a>`:"";
    return `<article class="activity-event" data-category="${esc(e.category)}"><span class="event-icon" aria-hidden="true">${icon(ICON[e.category]||"activity")}</span><div class="event-body"><p class="event-title"><strong>${esc(actor?.name||"Someone")}</strong> ${esc(e.text||"")}</p>${card}<div class="event-context"><span>${esc(p?.name||"")}</span>${b?`<span aria-hidden="true">/</span><span>${esc(b.name)}</span>`:""}<span class="event-category">${esc(label)}</span></div></div><time class="event-time" datetime="${esc(e.at)}">${esc(S.relativeTime(e.at))}</time></article>`;
  }
  function option(v,label) {return `<option value="${esc(v)}">${esc(label)}</option>`;}
  function render() {
    const crumb=document.querySelector("#crumbs a"); if(crumb){crumb.textContent="Projects";crumb.href=S.screenHref("projects");}
    const projects=P.projects(); if(state.project!=="all"&&!projects.some(p=>p.id===state.project))state.project="all";
    const base=accessibleEvents(), actors=[...new Set(base.map(e=>e.actorId))].filter(id=>FB.person(id));
    if(state.actor!=="all"&&!actors.includes(state.actor))state.actor="all";
    const categories=[...new Set(base.map(e=>e.category))].filter(k=>CATEGORY[k]);
    if(state.category!=="all"&&!categories.includes(state.category))state.category="all";
    $("#activityProject").innerHTML=option("all","All projects")+projects.map(p=>option(p.id,p.name)).join(""); $("#activityProject").value=state.project;
    $("#activityActor").innerHTML=option("all","Everyone")+actors.map(id=>option(id,FB.person(id).name)).join(""); $("#activityActor").value=state.actor;
    $("#activityAction").innerHTML=option("all","All actions")+categories.map(k=>option(k,CATEGORY[k])).join(""); $("#activityAction").value=state.category; $("#activityDate").value=state.date;
    const events=filteredEvents(), shown=events.slice(0,state.limit), active=state.project!=="all"||state.actor!=="all"||state.category!=="all"||state.date!=="all"||!!state.q.trim();
    $("#eventTotal").textContent=base.length; $("#projectTotal").textContent=new Set(base.map(e=>e.projectId)).size; $("#peopleTotal").textContent=new Set(base.map(e=>e.actorId)).size;
    $("#feedCount").textContent=`${events.length} ${events.length===1?"event":"events"}`; $("#filterNote").textContent=active?`${events.length} matching ${events.length===1?"event":"events"}`:"All activity"; $("#resetFilters").hidden=!active;
    $("#loadNote").textContent=events.length?`Showing ${shown.length} of ${events.length}`:""; $("#loadMoreBtn").hidden=shown.length>=events.length;
    const groups=[]; for(const e of shown){const key=dayKey(e.at); let g=groups.find(x=>x.key===key); if(!g){g={key,events:[]};groups.push(g);} g.events.push(e);}
    $("#feedPanel").innerHTML=groups.length?groups.map(g=>`<section class="activity-day"><h3>${esc(g.key)}</h3>${g.events.map(item).join("")}</section>`).join(""):`<div class="activity-empty">${icon("activity")}<strong>${active?"No matching activity":"No recorded activity"}</strong><span>${active?"Try a different filter or search.":"This preview has no recorded events here."}</span>${active?'<button type="button" data-clear>Clear filters</button>':""}</div>`;
  }
  function reset(){state.project=state.actor=state.category=state.date="all";state.q="";state.limit=10;$("#activitySearch").value="";render();}
  function init(){
    for(const [id,key] of [["activityProject","project"],["activityActor","actor"],["activityAction","category"],["activityDate","date"]]) $("#"+id).addEventListener("change",e=>{state[key]=e.target.value;state.limit=10;render();});
    $("#activitySearch").addEventListener("input",e=>{state.q=e.target.value;state.limit=10;render();});
    $("#resetFilters").addEventListener("click",reset); $("#feedPanel").addEventListener("click",e=>{if(e.target.closest("[data-clear]"))reset();});
    $("#loadMoreBtn").addEventListener("click",()=>{state.limit+=10;render();}); render();
  }
  window.FBPage={init,render,beforeRoleChange(){state.project=state.actor=state.category=state.date="all";state.q="";state.limit=10;$("#activitySearch").value="";return true;}};
})();
