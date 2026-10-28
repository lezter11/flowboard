/* Project team preview. Project and board access remain separate; no API writes. */
(function(){
  "use strict";
  const S=window.Screens, P=window.Portfolio, SD=window.SD, FB=window.FB;
  const $=s=>document.querySelector(s), esc=S.escape, icon=S.icon;
  const state={q:"",role:""};
  let draft=null;
  function manageableProjects(){
    const user=S.currentUser();
    if(S.role==="owner")return P.projects().filter(p=>p.ownerId===user.id);
    if(S.role==="manager")return P.projects().filter(p=>SD.project(p.id)&&SD.member(user.id,p.id)?.role==="Manager");
    return [];
  }
  function currentProject(){
    if(!S.projectContext.valid)return null;
    return manageableProjects().find(p=>p.id===S.projectContext.projectId)||null;
  }
  function members(project){
    if(!project)return [];
    return project.memberIds.map(id=>{
      const person=FB.person(id); if(!person)return null;
      const sample=SD.members.find(member=>member.personId===id);
      const role=id===project.ownerId?"Owner":sample?.role||person.role||"Member";
      return {id, name:person.name, role};
    }).filter(Boolean);
  }
  function destination(page, projectId){
    const q=new URLSearchParams({project:projectId});
    if(S.role!=="owner")q.set("role",S.role);
    if(document.documentElement.dataset.theme==="dark")q.set("theme","dark");
    return `${page}.html?${q}`;
  }
  function clear(){state.q=state.role="";$("#peopleSearch").value="";render();}
  function render(){
    const project=currentProject(), content=$("#peopleContent"), unavailable=$("#peopleUnavailable");
    content.hidden=!project;unavailable.hidden=!!project;
    if(!project){
      $("#peopleSub").textContent="";$("#peopleActions").replaceChildren();$("#teamList").replaceChildren();$("#peopleProject").replaceChildren();$("#unavailableProjects").href=S.screenHref("projects");
      for(const id of ["statMembers","statManagers","statMembersOnly","statViewers"])$("#"+id).textContent="0";
      $("#teamCount").textContent="";$("#peopleResultCount").textContent="";
      const crumb=$("#crumbs a");if(crumb){crumb.textContent="Projects";crumb.href=S.screenHref("projects");}
      return;
    }
    const list=members(project), q=state.q.trim().toLowerCase();
    const filtered=list.filter(p=>(!state.role||p.role===state.role)&&(!q||p.name.toLowerCase().includes(q)));
    $("#peopleSub").textContent=project.name;
    const isOwner=S.role==="owner"&&project.ownerId===S.currentUser().id;
    $("#peopleActions").innerHTML=isOwner&&project.status!=="archived"?`${P.boards(project.id).length?`<button class="btn" type="button" data-manage="boards">${icon("lock")}Board access</button>`:""}<button class="btn primary" type="button" data-manage="members">${icon("users")}Manage members</button>`:`<a class="btn" href="${esc(destination("project",project.id))}">${icon("folder")}Project overview</a>`;
    const counts={Manager:0,Member:0,Viewer:0};for(const person of list)if(Object.hasOwn(counts,person.role))counts[person.role]++;
    $("#statMembers").textContent=list.length;$("#statManagers").textContent=counts.Manager;$("#statMembersOnly").textContent=counts.Member;$("#statViewers").textContent=counts.Viewer;
    $("#managerLabel").textContent=counts.Manager===1?"manager":"managers";$("#memberLabel").textContent=counts.Member===1?"member":"members";$("#viewerLabel").textContent=counts.Viewer===1?"viewer":"viewers";
    $("#teamCount").textContent=`${filtered.length} ${filtered.length===1?"person":"people"}`;
    const projects=manageableProjects();$("#peopleProject").innerHTML=projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");$("#peopleProject").value=project.id;
    $("#peopleRole").value=state.role;const active=!!(state.q||state.role);$("#clearPeopleFilters").hidden=!active;
    $("#peopleResultCount").textContent=active?`${filtered.length} matching ${filtered.length===1?"person":"people"}`:"All project members";
    $("#teamList").innerHTML=filtered.length?filtered.map(person=>`<article class="team-row"><span class="person-avatar">${S.avatar(person.id,"lg")}</span><div class="member-name"><strong>${esc(person.name)}</strong>${person.id===S.currentUser().id?'<span class="you-label">You</span>':""}</div><span class="member-role role-${esc(person.role.toLowerCase())}"><span aria-hidden="true" class="role-dot"></span>${esc(person.role)}</span><span class="member-icon" aria-hidden="true">${icon("user-check")}</span></article>`).join(""):`<div class="people-empty">${icon("users")}<strong>${active?"No matching people":"No members yet"}</strong><span>${active?"Try a different search or role.":"Members will appear here."}</span>${active?'<button type="button" data-clear>Clear filters</button>':""}</div>`;
    const crumb=$("#crumbs a");if(crumb){crumb.textContent=project.name;crumb.href=destination("project",project.id);}
  }
  function drawManagement(){
    const project=currentProject(); if(!draft||!project||project.id!==draft.projectId)return;
    const isBoard=draft.kind==="boards";
    $("#peopleManageTitle").textContent=isBoard?"Board access":"Project members";
    $("#peopleManageSubtitle").textContent=project.name+" · local preview";
    $("#peopleManageHelp").textContent=isBoard?"Choose which project members can open this board. Project roles and board access are separate.":"Choose from existing preview people. Adding someone does not grant board access; removing them also removes their board access. Email invitations and role changes are not connected.";
    $("#peopleBoardLabel").hidden=!isBoard;
    if(isBoard){$("#peopleBoardSelect").innerHTML=P.boards(project.id).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");$("#peopleBoardSelect").value=draft.boardId||"";}
    const candidates=isBoard?P.availableMembers(project.id):P.candidateMembers(project.id);
    const focusIndex=candidates.findIndex(person=>person.id!==project.ownerId);
    $("#peopleManageList").innerHTML=candidates.map((person,i)=>`<label class="people-manage-person"><input type="checkbox" data-person="${esc(person.id)}" ${draft.selected.has(person.id)?"checked":""} ${person.id===project.ownerId?"disabled":""} ${i===focusIndex?"data-autofocus":""}><span><strong>${esc(person.name)}</strong>${person.id===project.ownerId?'<small>Owner · always has access</small>':""}</span></label>`).join("")||'<p>No people available.</p>';
    $("#peopleManageSave").disabled=isBoard&&!draft.boardId;
    $("#peopleManageError").hidden=true;
  }
  function openManagement(kind){
    const project=currentProject();if(!project||S.role!=="owner"||project.ownerId!==S.currentUser().id||project.status==="archived")return;
    const boardId=kind==="boards"?P.boards(project.id)[0]?.id:null;if(kind==="boards"&&!boardId)return;
    draft={kind,projectId:project.id,boardId,selected:new Set(kind==="boards"?(boardId?P.boardMembers(boardId):[]):project.memberIds)};
    $("#peopleBoardSelect").disabled=false;
    drawManagement();S.openDialog("peopleManageLayer",document.activeElement);
  }
  function closeManagement(){draft=null;S.closeDialog("peopleManageLayer");}
  function saveManagement(){
    const project=currentProject();if(!draft||!project||draft.projectId!==project.id||S.role!=="owner"||project.ownerId!==S.currentUser().id)return;
    const saved=draft.kind==="boards"?draft.boardId&&P.setBoardMembers(draft.boardId,[...draft.selected]):P.setProjectMembers(project.id,[...draft.selected]);
    if(!saved){$("#peopleManageError").textContent="Changes could not be saved in this preview. Check browser storage and try again.";$("#peopleManageError").hidden=false;return;}
    closeManagement();render();S.toast("Changes saved in this local preview.",{tone:"success"});
  }
  function init(){
    $("#peopleSearch").addEventListener("input",e=>{state.q=e.target.value;render();});
    $("#peopleRole").addEventListener("change",e=>{state.role=e.target.value;render();});
    $("#peopleProject").addEventListener("change",e=>{if(manageableProjects().some(p=>p.id===e.target.value))location.href=destination("people",e.target.value);});
    $("#clearPeopleFilters").addEventListener("click",clear);$("#teamList").addEventListener("click",e=>{if(e.target.closest("[data-clear]"))clear();});
    $("#peopleActions").addEventListener("click",e=>{const button=e.target.closest("[data-manage]");if(button)openManagement(button.dataset.manage);});
    $("#peopleManageLayer").addEventListener("click",e=>{if(e.target.closest("[data-people-close]"))closeManagement();});
    $("#peopleManageList").addEventListener("change",e=>{if(!draft||!e.target.dataset.person)return;e.target.checked?draft.selected.add(e.target.dataset.person):draft.selected.delete(e.target.dataset.person);if(draft.kind==="boards"){$("#peopleBoardSelect").disabled=true;$("#peopleManageHelp").textContent="Save or cancel these changes before choosing another board. Project roles and board access are separate.";}});
    $("#peopleBoardSelect").addEventListener("change",e=>{const project=currentProject();if(!draft||!project||!P.boards(project.id).some(b=>b.id===e.target.value))return;draft.boardId=e.target.value;draft.selected=new Set(P.boardMembers(draft.boardId));drawManagement();});
    $("#peopleManageSave").addEventListener("click",saveManagement);render();
  }
  window.FBPage={init,render,beforeRoleChange(){state.q=state.role="";$("#peopleSearch").value="";return true;}};
})();
