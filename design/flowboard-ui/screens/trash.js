/* Trash design preview: sample data, device-clock countdown, no restore API. */
(function(){
  "use strict";
  const SD=window.SD, FB=window.FB, P=window.Portfolio, S=window.Screens;
  const $=s=>document.querySelector(s), esc=S.escape, icon=S.icon, WINDOW=24*60*60*1000;
  const params=new URLSearchParams(location.search);
  const state={project:params.get("project")||"",q:"", timer:0};
  function manageableProjects(){
    const user=S.currentUser();
    if(S.role==="owner")return P.projects().filter(p=>p.ownerId===user.id);
    if(S.role==="manager")return P.projects().filter(p=>SD.project(p.id) && SD.member(user.id,p.id)?.role==="Manager");
    return [];
  }
  function items(){
    if(!S.can("browseTrash"))return [];
    return SD.trash.filter(item=>{
      const project=P.project(item.projectId),board=P.board(item.boardId);
      return !!project && manageableProjects().some(p=>p.id===project.id) && !!board && board.projectId===project.id && !!state.project && item.projectId===state.project;
    }).map(item=>({...item,deadline:new Date(new Date(item.deletedAt).getTime()+WINDOW).toISOString()})).sort((a,b)=>new Date(a.deadline)-new Date(b.deadline));
  }
  function status(item){
    const remaining=new Date(item.deadline).getTime()-Date.now();
    return {remaining,key:remaining<=0?"expired":remaining<=3600000?"soon":"available"};
  }
  function timeLeft(item){
    const remaining=status(item).remaining;
    if(remaining<=0)return "Recovery window ended";
    const minutes=Math.max(1,Math.ceil(remaining/60000));
    const hours=Math.floor(minutes/60), mins=minutes%60;
    return hours?`${hours}h ${mins}m remaining`:`${mins}m remaining`;
  }
  function row(item){
    const st=status(item), p=P.project(item.projectId),b=P.board(item.boardId),person=FB.person(item.deletedBy);
    const label=st.key==="expired"?"Window ended":st.key==="soon"?"Expiring soon":"Within window";
    const pct=Math.max(0,Math.min(100,st.remaining/WINDOW*100));
    return `<article class="recovery-row" data-trash-id="${esc(item.id)}" data-status="${st.key}"><span class="item-mark" aria-hidden="true">${icon("trash")}</span><div class="item-main"><div class="item-title"><strong>${esc(item.title)}</strong><span class="item-key">${esc(item.key)}</span></div><div class="item-context"><span>${esc(p.name)}</span><span aria-hidden="true">/</span><span>${esc(b.name)}</span><span aria-hidden="true">·</span><span>Deleted by ${esc(person?.name||"Unknown")}</span></div><div class="item-deadline">${icon("calendar")}<span>Deleted ${esc(S.formatDateTime(item.deletedAt))}</span><span aria-hidden="true">·</span><span>Deadline ${esc(S.formatDateTime(item.deadline))}</span></div></div><div class="item-window"><span class="window-status">${icon("clock")}${esc(label)}</span><strong data-countdown="${esc(item.id)}">${esc(timeLeft(item))}</strong><span class="window-track" aria-hidden="true"><span style="width:${pct}%"></span></span></div><button class="restore-preview" type="button" disabled aria-describedby="previewNote">${icon("restore")} Restore</button></article>`;
  }
  function render(){
    const allowed=S.can("browseTrash"), content=$("#trashContent"), denied=$("#trashDenied");
    content.hidden=!allowed;denied.hidden=allowed;
    if(!allowed){denied.innerHTML=S.accessDenied({title:"Trash is unavailable",copy:"Only project owners and managers can view deleted cards.",needed:"Owner or Manager",backHref:"projects.html",backLabel:"Browse projects"});return;}
    const projects=manageableProjects();
    if(state.project&&!projects.some(p=>p.id===state.project))state.project="";
    else if(!state.project&&!params.has("project"))state.project=projects.find(p=>p.id==="website-redesign")?.id||projects[0]?.id||"";
    $("#trashProject").innerHTML=(!state.project?'<option value="">Choose a project</option>':"")+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");$("#trashProject").value=state.project;
    const list=items(),query=state.q.trim().toLowerCase();
    const badge=document.querySelector('[data-nav-badge="trash"]');if(badge){badge.textContent=list.length?String(list.length):"";badge.hidden=!list.length;}
    const filtered=list.filter(item=>!query||[item.title,item.key,P.project(item.projectId)?.name,P.board(item.boardId)?.name].join(" ").toLowerCase().includes(query));
    $("#statTotal").textContent=list.length;$("#statRestorable").textContent=list.filter(i=>status(i).remaining>0).length;$("#statExpiring").textContent=list.filter(i=>status(i).key==="soon").length;
    $("#expiringMetric").classList.toggle("is-active",list.some(i=>status(i).key==="soon"));
    $("#trashCount").textContent=`${filtered.length} ${filtered.length===1?"card":"cards"}`;
    const active=!!query;$("#clearTrashFilters").hidden=!active;$("#filterNote").textContent=active?`${filtered.length} matching ${filtered.length===1?"card":"cards"}`:"All deleted cards";
    $("#trashList").innerHTML=filtered.length?filtered.map(row).join(""):`<div class="recovery-empty">${icon("trash")}<strong>${!projects.length?"No projects available":!state.project?"Choose a project":active?"No matching cards":"Trash is empty"}</strong><span>${!projects.length?"There are no projects available for trash management in this preview.":!state.project?"Select an available project to view its trash.":active?"Try a different search.":"No deleted cards in this preview."}</span>${active?'<button type="button" data-clear>Clear filters</button>':""}</div>`;
    const crumb=$("#crumbs a");if(crumb){crumb.textContent="Projects";crumb.href=S.screenHref("projects");}
  }
  function reset(){state.q="";$("#trashSearch").value="";syncUrl();render();}
  function syncUrl(){const u=new URL(location.href);if(state.project)u.searchParams.set("project",state.project);else u.searchParams.delete("project");u.searchParams.delete("q");if(u.href!==location.href)history.replaceState(null,"",u.pathname+u.search+u.hash);}
  function tick(){
    if($("#trashContent").hidden)return;
    for(const item of items()){
      const row=document.querySelector(`[data-trash-id="${CSS.escape(item.id)}"]`);if(!row)continue;
      if(row.dataset.status!==status(item).key){render();return;}
      const label=row.querySelector("[data-countdown]");if(label)label.textContent=timeLeft(item);
    }
  }
  function init(){
    $("#trashSearch").addEventListener("input",e=>{state.q=e.target.value;render();});
    $("#trashProject").addEventListener("change",e=>{state.project=e.target.value;syncUrl();render();});
    $("#clearTrashFilters").addEventListener("click",reset);$("#trashList").addEventListener("click",e=>{if(e.target.closest("[data-clear]"))reset();});
    render();state.timer=window.setInterval(tick,30000);
  }
  window.FBPage={init,render,beforeRoleChange(){state.q="";state.project="";$("#trashSearch").value="";syncUrl();return true;}};
})();
