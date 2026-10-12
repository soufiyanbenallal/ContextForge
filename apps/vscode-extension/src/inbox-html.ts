/** HTML shell + client script for the Review Inbox webview. */

export function inboxHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style nonce="${nonce}">
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--vscode-panel-border)}
header h1{font-size:1.05em;margin:0;flex:1;min-width:160px}
header .sub{color:var(--vscode-descriptionForeground);font-weight:normal;margin-left:8px}
nav{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--vscode-panel-border)}
nav button{background:none;color:var(--vscode-foreground);border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 12px;opacity:.75}
nav button.on{border-bottom-color:var(--vscode-focusBorder);opacity:1}
.badge{display:inline-block;min-width:18px;padding:0 5px;margin-left:6px;border-radius:9px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.8em;text-align:center}
.badge.warn{background:var(--vscode-editorWarning-foreground);color:#000}
button{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:3px;padding:4px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.danger{background:transparent;color:var(--vscode-errorForeground);border-color:var(--vscode-errorForeground)}
button:focus-visible,input:focus-visible,textarea:focus-visible,.row:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
input[type=text],textarea{width:100%;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;padding:5px 7px}
textarea{min-height:90px;resize:vertical}
main{padding:12px 16px}
.split{display:grid;grid-template-columns:minmax(220px,340px) 1fr;gap:16px;min-height:60vh}
@media(max-width:700px){.split{grid-template-columns:1fr}}
.list{border:1px solid var(--vscode-panel-border);border-radius:4px;overflow:auto;max-height:70vh}
.row{display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border);cursor:pointer}
.row:last-child{border-bottom:0}
.row.sel{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.row:hover:not(.sel){background:var(--vscode-list-hoverBackground)}
.row .t{flex:1;min-width:0}
.row .t b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.muted{color:var(--vscode-descriptionForeground);font-size:.9em}
.detail{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:14px 16px}
.detail h2{margin:0 0 6px;font-size:1.1em}
.quote{border-left:3px solid var(--vscode-textBlockQuote-border);background:var(--vscode-textBlockQuote-background);padding:6px 10px;margin:10px 0;white-space:pre-wrap}
.content{white-space:pre-wrap;margin:10px 0}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.chip{padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.85em;border:0}
.card{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:12px;margin-bottom:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0}
@media(max-width:700px){.pair{grid-template-columns:1fr}}
.pair>div{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px}
.empty{padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground)}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.toolbar input[type=text]{max-width:320px}
#toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--vscode-notifications-background);color:var(--vscode-notifications-foreground);border:1px solid var(--vscode-notifications-border,var(--vscode-panel-border));padding:8px 14px;border-radius:4px;display:none;gap:12px;align-items:center;z-index:5}
.kbd{font-size:.8em;opacity:.7;margin-left:4px}
label.lbl{display:block;margin:10px 0 3px;font-size:.9em;color:var(--vscode-descriptionForeground)}
</style></head>
<body>
<header>
  <h1 id="title">ContextForge<span class="sub"></span></h1>
  <button class="sec" data-cmd="teach" title="Record what an agent got wrong">Teach…</button>
  <button class="sec" data-cmd="checkConflicts">Check conflicts</button>
  <button class="sec" data-cmd="export">Export…</button>
  <button class="sec" data-cmd="connect">Connect agents…</button>
</header>
<nav id="tabs" role="tablist"></nav>
<main id="main"></main>
<div id="toast" role="status" aria-live="polite"><span id="toastMsg"></span><button class="sec" id="undo" hidden>Undo</button></div>
<script nonce="${nonce}">
(function(){
var vscode = acquireVsCodeApi();
var S = null;
var ui = (vscode.getState && vscode.getState()) || {};
ui.tab = ui.tab || 'inbox'; ui.sel = ui.sel || null; ui.checked = {}; ui.editing = false; ui.filter = ''; ui.superseding = null; ui.rejecting = false;
var lastUndo = null, toastTimer = null;

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function $(id){return document.getElementById(id);}
function send(m){vscode.postMessage(m);}
function act(a){send({type:'action',action:a});}
function persist(){ if(vscode.setState) vscode.setState({tab:ui.tab, sel:ui.sel}); }

function toast(msg, undo){
  $('toastMsg').textContent = msg; lastUndo = undo || null;
  $('undo').hidden = !undo; $('toast').style.display = 'flex';
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ $('toast').style.display='none'; }, undo ? 8000 : 3000);
}
$('undo').onclick = function(){ if(lastUndo) act(lastUndo); lastUndo = null; $('toast').style.display='none'; };

function meta(r){ return esc(r.scope)+' · '+esc(r.category)+' · p'+r.priority+(r.appliesTo?' · '+esc(r.appliesTo):''); }

function renderTabs(){
  var items = [
    ['inbox','Inbox', S.proposed.length, false],
    ['rules','Rules', S.approved.length, false],
    ['conflicts','Conflicts', S.conflicts.length, S.conflicts.length>0],
    ['caps','Skills & MCPs', S.capabilities.length, false],
    ['activity','Activity', S.faults.length, false]
  ];
  $('tabs').innerHTML = items.map(function(t){
    return '<button role="tab" class="'+(ui.tab===t[0]?'on':'')+'" data-tab="'+t[0]+'">'+t[1]+'<span class="badge'+(t[3]?' warn':'')+'">'+t[2]+'</span></button>';
  }).join('');
  document.querySelector('#title .sub').textContent = S.projectName;
}

function renderInbox(){
  var list = S.proposed;
  if(!list.length){
    return '<div class="empty"><p><b>Inbox zero.</b></p><p>Nothing waiting for review. Lessons appear here when an agent reports feedback through MCP, or when you use <b>Teach…</b> (also in the editor right-click menu).</p></div>';
  }
  if(!ui.sel || !list.some(function(r){return r.id===ui.sel;})) ui.sel = list[0].id;
  var checkedIds = Object.keys(ui.checked).filter(function(k){return ui.checked[k] && list.some(function(r){return r.id===k;});});
  var rows = list.map(function(r){
    return '<div class="row'+(r.id===ui.sel?' sel':'')+'" tabindex="0" data-sel="'+r.id+'">'
      +'<input type="checkbox" aria-label="Select" data-chk="'+r.id+'"'+(ui.checked[r.id]?' checked':'')+' />'
      +'<div class="t"><b>'+esc(r.title)+'</b><span class="muted">'+meta(r)+'</span></div>'
      +(r.conflictIds.length?'<span class="badge warn" title="Has open conflicts">!</span>':'')+'</div>';
  }).join('');
  var r = list.filter(function(x){return x.id===ui.sel;})[0];
  var d;
  if(ui.editing){
    d = '<h2>Edit lesson</h2>'
      +'<label class="lbl" for="eContent">Rule</label><textarea id="eContent">'+esc(r.content)+'</textarea>'
      +'<label class="lbl" for="eApplies">Applies to (comma-separated globs, empty = whole project)</label><input type="text" id="eApplies" value="'+esc(r.appliesTo||'')+'" placeholder="src/**, app/Models/**" />'
      +'<div class="actions"><button data-do="saveApprove">Save &amp; approve</button><button class="sec" data-do="save">Save</button><button class="sec" data-do="cancelEdit">Cancel</button></div>';
  } else {
    d = '<h2>'+esc(r.title)+'</h2><div class="muted">'+meta(r)+' · confidence '+Math.round(r.confidence*100)+'%</div>'
      +'<div class="content">'+esc(r.content)+'</div>'
      +(r.sourceMessage?'<div class="muted">Learned from feedback:</div><div class="quote">'+esc(r.sourceMessage)+'</div>':'')
      +(r.conflictIds.length?'<p class="muted">⚠ Conflicts with an approved rule — see the <a href="#" data-tab="conflicts">Conflicts</a> tab before approving.</p>':'')
      +(ui.rejecting
        ? '<label class="lbl" for="rReason">Why reject? (helps future lessons)</label>'
          +'<div class="chips">'+['Too broad','Already covered','Wrong','Not a project rule'].map(function(c){return '<button class="chip" data-reason="'+c+'">'+c+'</button>';}).join('')+'</div>'
          +'<input type="text" id="rReason" placeholder="Reason (optional)" />'
          +'<div class="actions"><button class="danger" data-do="confirmReject">Reject</button><button class="sec" data-do="cancelReject">Cancel</button></div>'
        : '<div class="actions"><button data-do="approve">Approve<span class="kbd">A</span></button>'
          +'<button class="sec" data-do="edit">Edit<span class="kbd">E</span></button>'
          +'<button class="danger" data-do="reject">Reject<span class="kbd">R</span></button></div>');
  }
  var batch = checkedIds.length
    ? '<div class="toolbar"><span>'+checkedIds.length+' selected</span><button data-do="approveSel">Approve selected</button><button class="danger" data-do="rejectSel">Reject selected</button></div>' : '';
  return batch+'<div class="split"><div class="list" role="listbox" aria-label="Proposed lessons">'+rows+'</div><div class="detail">'+d+'</div></div>'
    +'<p class="muted">Keys: <b>J/K</b> move · <b>A</b> approve · <b>E</b> edit · <b>R</b> reject</p>';
}

function ruleCard(r, historyView){
  var body = '<b>'+esc(r.title)+'</b><div class="muted">'+meta(r)+(r.status!=='approved'?' · '+esc(r.status)+(r.rejectedReason?': '+esc(r.rejectedReason):''):'')+'</div><div class="content">'+esc(r.content)+'</div>';
  if(!historyView){
    if(ui.superseding===r.id){
      body += '<label class="lbl" for="sContent">Replacement rule</label><textarea id="sContent">'+esc(r.content)+'</textarea>'
        +'<div class="actions"><button data-do="confirmSupersede" data-id="'+r.id+'">Replace rule</button><button class="sec" data-do="cancelSupersede">Cancel</button></div>';
    } else {
      body += '<div class="actions"><button class="sec" data-do="supersede" data-id="'+r.id+'">Replace…</button><button class="sec" data-do="demote" data-id="'+r.id+'">Move back to Inbox</button></div>';
    }
  } else if(r.status==='rejected'){
    body += '<div class="actions"><button class="sec" data-do="restore" data-id="'+r.id+'">Restore to Inbox</button></div>';
  }
  return '<div class="card">'+body+'</div>';
}

function renderRules(){
  var f = ui.filter.toLowerCase();
  var match = function(r){return !f || (r.title+' '+r.content+' '+(r.appliesTo||'')).toLowerCase().indexOf(f)>=0;};
  var a = S.approved.filter(match), h = S.history.filter(match);
  return '<div class="toolbar"><input type="text" id="filter" placeholder="Filter rules…" value="'+esc(ui.filter)+'" aria-label="Filter rules" /></div>'
    +(a.length?a.map(function(r){return ruleCard(r,false);}).join(''):'<div class="empty">'+(S.approved.length?'No rules match.':'No approved rules yet. Approve lessons from the Inbox.')+'</div>')
    +(h.length?'<h3>Rejected &amp; replaced</h3>'+h.map(function(r){return ruleCard(r,true);}).join(''):'');
}

function side(label, r){
  if(!r) return '<div><span class="muted">'+label+'</span><p>(missing)</p></div>';
  return '<div><span class="muted">'+label+' · '+esc(r.status)+'</span><div class="content">'+esc(r.content)+'</div><div class="muted">'+meta(r)+'</div></div>';
}
function renderConflicts(){
  if(!S.conflicts.length) return '<div class="empty">No open conflicts. Use <b>Check conflicts</b> to scan your approved rules.</div>';
  return S.conflicts.map(function(c){
    return '<div class="card"><b>'+esc(c.type)+' conflict</b><div class="muted">'+esc(c.explanation||'')+'</div>'
      +'<div class="pair">'+side('Rule A',c.left)+side('Rule B',c.right)+'</div>'
      +'<div class="actions"><button data-do="keep" data-id="'+c.id+'" data-w="left">Keep A</button><button data-do="keep" data-id="'+c.id+'" data-w="right">Keep B</button>'
      +'<button class="sec" data-do="keep" data-id="'+c.id+'" data-w="both">Keep both</button><button class="sec" data-do="keep" data-id="'+c.id+'" data-w="dismiss">Not a conflict</button>'
      +'<button class="sec" data-do="diff" data-id="'+c.id+'">Open diff</button></div></div>';
  }).join('');
}
function renderCaps(){
  if(!S.capabilities.length) return '<div class="empty">No skills or MCP servers discovered in this project.</div>';
  return S.capabilities.map(function(c){
    var rate = c.successRate!=null ? Math.round(c.successRate*100)+'% success' : 'no usage yet';
    return '<div class="card"><b>'+esc(c.type)+': '+esc(c.name)+'</b> <span class="muted">· '+rate+'</span>'
      +(c.missing.length?'<div class="muted">⚠ missing config: '+esc(c.missing.join(', '))+'</div>':'')
      +'<div class="actions"><button class="sec" data-do="cap" data-id="'+c.id+'" data-on="'+(c.enabled?'0':'1')+'">'+(c.enabled?'Disable':'Enable')+'</button></div></div>';
  }).join('');
}
function renderActivity(){
  if(!S.faults.length) return '<div class="empty">No feedback recorded yet.</div>';
  return S.faults.map(function(f){
    return '<div class="card"><span class="muted">'+esc(f.type)+' · '+esc(f.severity)+' · '+esc(f.createdAt)+'</span><div class="content">'+esc(f.message.slice(0,400))+'</div>'
      +'<div class="actions"><button class="sec" data-do="extract" data-id="'+f.id+'">Propose lesson</button></div></div>';
  }).join('');
}

function render(){
  if(!S) return;
  var focus = document.activeElement && document.activeElement.id;
  renderTabs();
  var html = ui.tab==='inbox'?renderInbox(): ui.tab==='rules'?renderRules(): ui.tab==='conflicts'?renderConflicts(): ui.tab==='caps'?renderCaps(): renderActivity();
  $('main').innerHTML = html;
  if(focus && $(focus)) { try{ $(focus).focus(); }catch(e){} }
  persist();
}

function selected(){ return S && S.proposed.filter(function(r){return r.id===ui.sel;})[0]; }
function move(d){
  if(!S||!S.proposed.length) return;
  var i = S.proposed.findIndex(function(r){return r.id===ui.sel;});
  i = Math.max(0, Math.min(S.proposed.length-1, i+d)); ui.sel = S.proposed[i].id; ui.editing=false; ui.rejecting=false; render();
}
function checkedList(){ return Object.keys(ui.checked).filter(function(k){return ui.checked[k];}); }

document.addEventListener('click', function(e){
  var t = e.target;
  var cmd = t.closest('[data-cmd]'); if(cmd){ send({type:'command',command:cmd.getAttribute('data-cmd')}); return; }
  var tab = t.closest('[data-tab]'); if(tab){ e.preventDefault(); ui.tab = tab.getAttribute('data-tab'); ui.editing=false; ui.rejecting=false; render(); return; }
  var reason = t.closest('[data-reason]'); if(reason){ var i=$('rReason'); if(i){ i.value = reason.getAttribute('data-reason'); i.focus(); } return; }
  if(t.getAttribute && t.getAttribute('data-chk')){ ui.checked[t.getAttribute('data-chk')] = t.checked; render(); return; }
  var row = t.closest('[data-sel]'); if(row){ ui.sel = row.getAttribute('data-sel'); ui.editing=false; ui.rejecting=false; render(); return; }
  var b = t.closest('[data-do]'); if(!b) return;
  var id = b.getAttribute('data-id'), what = b.getAttribute('data-do'), r = selected();
  switch(what){
    case 'approve': if(r) act({act:'approve',ids:[r.id]}); break;
    case 'edit': ui.editing=true; render(); if($('eContent')) $('eContent').focus(); break;
    case 'cancelEdit': ui.editing=false; render(); break;
    case 'save': case 'saveApprove': if(r) act({act:'edit',id:r.id,content:$('eContent').value,appliesTo:$('eApplies').value,approve:what==='saveApprove'}); ui.editing=false; break;
    case 'reject': ui.rejecting=true; render(); if($('rReason')) $('rReason').focus(); break;
    case 'cancelReject': ui.rejecting=false; render(); break;
    case 'confirmReject': if(r) act({act:'reject',ids:[r.id],reason:$('rReason').value}); ui.rejecting=false; break;
    case 'approveSel': act({act:'approve',ids:checkedList()}); ui.checked={}; break;
    case 'rejectSel': act({act:'reject',ids:checkedList(),reason:'Rejected in bulk'}); ui.checked={}; break;
    case 'supersede': ui.superseding=id; render(); break;
    case 'cancelSupersede': ui.superseding=null; render(); break;
    case 'confirmSupersede': act({act:'supersede',id:id,content:$('sContent').value}); ui.superseding=null; break;
    case 'demote': case 'restore': act({act:'setStatus',ids:[id],status:'proposed'}); break;
    case 'keep': act({act:'resolve',id:id,winner:b.getAttribute('data-w')}); break;
    case 'diff': send({type:'openDiff',id:id}); break;
    case 'cap': act({act:'capability',id:id,enabled:b.getAttribute('data-on')==='1'}); break;
    case 'extract': act({act:'extract',id:id}); break;
  }
});
document.addEventListener('input', function(e){ if(e.target.id==='filter'){ ui.filter = e.target.value; var pos=e.target.selectionStart; render(); var f=$('filter'); if(f){ f.focus(); f.setSelectionRange(pos,pos);} } });
document.addEventListener('keydown', function(e){
  var tag = (e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||e.ctrlKey||e.metaKey||e.altKey||ui.tab!=='inbox') return;
  var r = selected();
  if(e.key==='j'||e.key==='ArrowDown'){ e.preventDefault(); move(1); }
  else if(e.key==='k'||e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
  else if(e.key==='a'&&r&&!ui.editing){ act({act:'approve',ids:[r.id]}); }
  else if(e.key==='e'&&r){ e.preventDefault(); ui.editing=true; render(); if($('eContent')) $('eContent').focus(); }
  else if(e.key==='r'&&r&&!ui.editing){ e.preventDefault(); ui.rejecting=true; render(); if($('rReason')) $('rReason').focus(); }
});

window.addEventListener('message', function(e){
  var m = e.data;
  if(m.type==='state'){ S = m.state; render(); }
  else if(m.type==='toast'){ toast(m.message, m.undo); }
  else if(m.type==='error'){ toast('⚠ '+m.message); }
});
send({type:'ready'});
})();
</script></body></html>`;
}
