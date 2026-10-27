const DEEDS=[
  {l:"מ",t:"מחמאה כנה",d:"להגיד למישהו משהו טוב ואמיתי שראיתם בו. לא על הבגדים, על מי שהוא."},
  {l:"ט",t:"טלפון למי שמזמן לא דיברנו",d:"להרים טלפון (לא הודעה!) לחבר, לבן משפחה או לקולגה ששקטו מזמן. רק לשאול מה שלומם."},
  {l:"ת",t:"תרומה למי שצריך",d:"כסף, שקית מצרכים, בגדים שכבר לא לובשים. משהו שעובר למי שזקוק לו."},
  {l:"ש",t:"שכן מבוגר",d:"לדפוק בדלת של שכן או שכנה מבוגרים ולשאול אם צריך משהו, או סתם לשבת איתם לקפה."},
  {l:"פ",t:"תודה למי שלא רואים",d:"להגיד תודה אמיתית, או להשאיר פתק, למי שעושה בשבילנו משהו בשקט: השליח, המנקה, השומר, הנהג."},
  {l:"ה",t:"הקשבה בלי טלפון",d:"שיחה אחת היום עם הטלפון בכיס. רק להקשיב, עד הסוף, בלי לקטוע."},
  {l:"ס",t:"סליחה",d:"לבקש סליחה ממישהו שפגענו בו, גם אם זה היה מזמן. או לסלוח למישהו, בלב."},
  {l:"כ",t:"פתק פתוח",d:"מעשה טוב שבוחרים לבד. כותבים אותו כאן, וזה הפתק שנכנס לקלפי.",open:true}
];
const RZ=[-3,2,-1,3,1,-3,2,-2];
const $=id=>document.getElementById(id);
const pad=n=>String(n+1).padStart(2,"0");
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- one vote per day ---- */
/* ---- the ballot is open on one day only ---- */
const POLL_DAY="2026-10-27";
const dayKey=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const pollStatus=()=>dayKey()<POLL_DAY?"soon":dayKey()>POLL_DAY?"closed":"open";
const KEY="tut_vote_v1";
function load(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){return {}}}
function save(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
function countDone(){try{return +(localStorage.getItem("tut_done_count")||0)}catch(e){return 0}}
let state=load();

/* ---- header bits ---- */
const pollDate=new Intl.DateTimeFormat("he-IL",{weekday:"long",day:"numeric",month:"long"}).format(new Date(POLL_DAY+"T12:00:00"));
$("today").innerHTML={open:"<b>הקלפי פתוחה היום</b>",soon:"<b>הקלפי תיפתח</b>",closed:"<b>הקלפי נסגרה</b>"}[pollStatus()]+pollDate;
const words=["בוחרים בטוב","ONE SLIP","מעשה טוב אחד","TOUTE LA VIE","קלפי תות","תות."];
$("marq").innerHTML=Array(6).fill(words.map((w,i)=>`<span${i%2?' class="r"':''}>${w}</span><span>●</span>`).join("")).join("");

/* ---- tray ---- */
function renderTray(){
  const tray=$("tray");tray.innerHTML="";
  DEEDS.forEach((d,i)=>{
    const b=document.createElement("button");
    b.type="button";b.className="slip";b.id="slip-"+i;
    b.style.setProperty("--rz",RZ[i]+"deg");
    b.innerHTML=`<span class="no">/ ${pad(i)}</span><span class="lt" aria-hidden="true">${d.l}</span><span class="tt">${d.t}</span>`;
    b.setAttribute("aria-label",`פתק ${d.l}: ${d.t}`);
    b.onclick=()=>openSlip(i);
    tray.append(b);
  });
}

let cur=null;
function openSlip(i){
  cur=i;const d=DEEDS[i];
  $("dlgNo").textContent="/ פתק "+pad(i);
  $("dlgLt").textContent=d.l;$("dlgTitle").textContent=d.t;$("dlgText").textContent=d.d;
  $("free").classList.toggle("hidden",!d.open);$("freeErr").classList.add("hidden");
  $("dlg").showModal();
  if(d.open)$("freeText").focus();
}
$("dlgClose").onclick=$("back").onclick=()=>$("dlg").close();
$("dlg").addEventListener("click",e=>{if(e.target===$("dlg"))$("dlg").close()});
$("vote").onclick=()=>{
  const i=cur,text=$("freeText").value.trim();
  if(DEEDS[i].open&&!text){$("freeErr").classList.remove("hidden");$("freeText").focus();return}
  $("dlg").close();
  state={day:POLL_DAY,pick:i,done:false};if(DEEDS[i].open)state.text=text;save(state);
  fly(i,()=>applyState(true));
};

/* slip flies into the ballot box */
function fly(i,then){
  const from=$("slip-"+i).getBoundingClientRect(),box=$("ballot").getBoundingClientRect();
  if(RM||!from.width){then();return}
  const f=document.createElement("div");f.className="flyer";f.textContent=DEEDS[i].l;
  Object.assign(f.style,{left:from.left+"px",top:from.top+"px",width:from.width+"px",height:from.height+"px"});
  document.body.append(f);$("slip-"+i).classList.add("away");
  const tx=box.left+box.width/2-(from.left+from.width/2),ty=box.top+30-(from.top+from.height/2);
  f.animate([
    {transform:"translate(0,0) rotate(0) scale(1)"},
    {transform:`translate(${tx*.6}px,${ty*.6-80}px) rotate(-8deg) scale(.7)`,offset:.6},
    {transform:`translate(${tx}px,${ty}px) rotate(0) scale(.35,.05)`,opacity:.6}
  ],{duration:850,easing:"cubic-bezier(.5,0,.4,1)"}).onfinish=()=>{
    f.remove();const b=$("ballot");b.classList.remove("bump");void b.offsetWidth;b.classList.add("bump");then();
  };
}

/* ---- render by state ---- */
function applyState(scroll){
  const has=state.pick!=null,status=pollStatus(),shut=status!=="open";
  $("tray").classList.toggle("locked",has||shut);
  document.querySelectorAll(".slip").forEach((s,i)=>{s.classList.toggle("chosen",i===state.pick);s.classList.toggle("away",has&&i===state.pick);s.disabled=has||shut});
  $("boothHint").textContent=has?"הפתק שלך בקלפי. תודה שבחרת בטוב!":status==="closed"?"הקלפי נסגרה. תודה לכל מי שבחר בטוב!":status==="soon"?"הקלפי עוד לא נפתחה.":"לוחצים על פתק כדי לקרוא אותו.";
  $("boxNote").textContent=has?(state.done?"הפתק בקלפי, והמעשה נעשה. כל הכבוד!":"הפתק שלך בקלפי. עכשיו לעשות!"):status==="closed"?"הקלפי נסגרה.":"הקלפי ריקה. מחכה לפתק שלך.";
  $("mine").classList.toggle("hidden",!has);
  if(!has)return;
  const d=DEEDS[state.pick];
  $("cardLt").textContent=d.l;$("cardNo").textContent="/ פתק "+pad(state.pick);
  $("cardTitle").textContent=d.open?state.text:d.t;$("cardText").textContent=d.open?"המעשה הטוב שבחרת לבד.":d.d;
  $("card").classList.toggle("done",!!state.done);
  $("didIt").classList.toggle("hidden",!!state.done);
  $("share").classList.toggle("hidden",!state.done);
  const n=countDone();
  $("thanks").classList.toggle("hidden",!state.done);
  $("thanks").innerHTML=state.done?`העולם קצת יותר טוב בזכותך. <b>${n}</b> ${n===1?"מעשה טוב":"מעשים טובים"} עד היום.`:"";
  if(scroll)$("mine").scrollIntoView({behavior:RM?"auto":"smooth",block:"start"});
}
$("didIt").onclick=()=>{
  state.done=true;save(state);
  try{localStorage.setItem("tut_done_count",countDone()+1)}catch(e){}
  applyState(false);
};
$("share").onclick=async()=>{
  const d=DEEDS[state.pick],text=`בחרתי היום בפתק ״${d.open?state.text:d.t}״ ועשיתי אותו! בואו לבחור גם: `,url=location.href.split("#")[0];
  if(navigator.share){try{await navigator.share({title:"בוחרים בטוב · תות",text,url})}catch(e){}}
  else{try{await navigator.clipboard.writeText(text+url);$("share").textContent="הקישור הועתק ✓"}catch(e){}}
};

renderTray();applyState(false);
