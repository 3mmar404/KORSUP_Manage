'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let activeTab='dashboard',currentOrder=null;
const DRIVE='https://drive.google.com/drive/folders/1kD5qRzQPojxsbuqxE3tk2T-Zazxxtp1w?usp=sharing';
const statuses={pending:'بانتظار الدفع',paid:'مدفوع — ينتظر التفعيل',active:'تم التفعيل',canceled:'ملغي'};
const walletKinds={sale:'عملية بيع',opening:'رصيد افتتاحي',adjustment_in:'تسوية داخلة',adjustment_out:'تسوية خارجة',withdrawal:'سحب',expense:'مصروف'};
const money=n=>new Intl.NumberFormat('en-US').format(n||0);
const date=s=>s?new Date(s).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const showNotice=(msg,err=false)=>{let e=$('#notice');e.textContent=msg;e.style.borderRight='4px solid '+(err?'#f66':'#58c991');e.classList.add('show');setTimeout(()=>e.classList.remove('show'),4200)};
const now=()=>new Date().toISOString();
const blank=()=>({version:1,nextId:1,nextActivation:1,orders:[],entries:[],events:[]});
let state=blank(),db;
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('korsup_manage_static_v3',1);r.onupgradeneeded=()=>{r.result.createObjectStore('data')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function dbRead(){return new Promise((resolve,reject)=>{let t=db.transaction('data','readonly');let r=t.objectStore('data').get('state');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
function dbWrite(value){return new Promise((resolve,reject)=>{let t=db.transaction('data','readwrite');t.objectStore('data').put(value,'state');t.oncomplete=resolve;t.onerror=()=>reject(t.error)})}
async function save(){await dbWrite(state)}
function event(id,name,details=''){state.events.push({order_id:id,event:name,details,created_at:now()})}
function orderById(id){let o=state.orders.find(x=>x.id===Number(id));if(!o)throw Error('الطلب غير موجود');return o}
function number(v){let n=Number(v);if(!Number.isFinite(n)||n<=0||n>10000000)throw Error('المبلغ غير صحيح');return Math.round(n*100)/100}
function signed(x){return ['sale','opening','adjustment_in'].includes(x.kind)?x.amount:-x.amount}
function reportData(){let paid=state.orders.filter(x=>['paid','active'].includes(x.status));return {gross_sales:paid.reduce((n,o)=>n+o.amount,0),sales_count:paid.length,counts:{pending:state.orders.filter(x=>x.status==='pending').length,active:state.orders.filter(x=>x.status==='active').length},estimated_balance:state.entries.reduce((n,x)=>n+signed(x),0),recent:[...state.orders].reverse().slice(0,7)}}
async function api(path,opts={}){
  let data=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET';
  if(method==='GET'){
    if(path==='/dashboard')return reportData();
    if(path.startsWith('/orders?')){let p=new URLSearchParams(path.split('?')[1]),q=(p.get('q')||'').toLowerCase(),s=p.get('status')||'all';return {orders:[...state.orders].reverse().filter(o=>(s==='all'||o.status===s)&&[o.customer_name,o.email,o.whatsapp,o.activation_code||'',o.payment_reference||''].some(v=>String(v||'').toLowerCase().includes(q)))}}
    if(path==='/wallet')return {balance:state.entries.reduce((n,x)=>n+signed(x),0),entries:[...state.entries].reverse()};
    let m=path.match(/^\/orders\/(\d+)$/);if(m){let o=orderById(m[1]);return {order:structuredClone(o),events:state.events.filter(e=>e.order_id===o.id).reverse()}}
    throw Error('عنوان غير معروف');
  }
  if(method!=='POST')throw Error('عملية غير مدعومة');
  if(path==='/orders'){
    let name=String(data.customer_name||'').trim(),email=String(data.email||'').trim().toLowerCase(),whatsapp=String(data.whatsapp||'').trim();
    if(!name||!/^\S+@\S+\.\S+$/.test(email)||!whatsapp)throw Error('الاسم وإيميل Google وواتساب مطلوبين');
    let o={id:state.nextId++,customer_name:name,email,whatsapp,sender_wallet:String(data.sender_wallet||'').trim(),amount:number(data.amount),note:String(data.note||'').slice(0,1500),status:'pending',created_at:now(),payment_reference:'',verified_at:null,activated_at:null,confirmed_at:null,activation_code:null,proof_filename:null,proof_data:null};
    state.orders.push(o);event(o.id,'إنشاء الطلب');await save();return {id:o.id};
  }
  if(path==='/wallet'){
    if(!['opening','adjustment_in','withdrawal','expense','adjustment_out'].includes(data.kind))throw Error('نوع الحركة غير معروف');
    if(!String(data.description||'').trim())throw Error('اكتب وصف الحركة');
    state.entries.push({id:state.entries.length+1,kind:data.kind,amount:number(data.amount),description:String(data.description).slice(0,250),created_at:now()});await save();return {ok:true};
  }
  let m=path.match(/^\/orders\/(\d+)\/(verify|activate|cancel|confirm|note|receipt)$/);
  if(!m)throw Error('عملية غير معروفة');let o=orderById(m[1]),action=m[2];
  if(action==='verify'){
    if(o.status!=='pending')throw Error('الطلب مش بانتظار الدفع');let ref=String(data.payment_reference||'').trim();if(!ref)throw Error('رقم مرجع التحويل مطلوب');
    if(state.orders.some(x=>x.id!==o.id&&x.payment_reference===ref&&x.status!=='canceled'))throw Error('مرجع التحويل مستخدم في طلب آخر');
    o.payment_reference=ref;o.status='paid';o.verified_at=now();state.entries.push({id:state.entries.length+1,kind:'sale',amount:o.amount,description:'بيع مؤكد - طلب #'+o.id,order_id:o.id,created_at:now()});event(o.id,'تأكيد الدفع',ref);
  }else if(action==='activate'){
    if(o.status!=='paid'||data.viewer_granted!==true)throw Error('تأكد من منح صلاحية Viewer بعد تأكيد الدفع');
    o.status='active';o.activated_at=now();o.activation_code='KOR-'+new Date().getFullYear()+'-'+String(state.nextActivation++).padStart(6,'0');event(o.id,'تفعيل الوصول',o.activation_code);
  }else if(action==='cancel'){
    if(o.status!=='pending')throw Error('الإلغاء متاح للطلبات غير المدفوعة فقط');o.status='canceled';event(o.id,'إلغاء الطلب',String(data.reason||''));
  }else if(action==='confirm'){
    if(o.status!=='active')throw Error('الطلب لم يُفعّل بعد');if(!o.confirmed_at){o.confirmed_at=now();event(o.id,'إرسال تأكيد واتساب')}
  }else if(action==='note'){
    o.note=String(data.note||'').slice(0,1500);event(o.id,'تحديث الملاحظات');
  }else if(action==='receipt'){
    if(!['jpg','jpeg','png','webp','pdf'].includes(data.ext)||!data.data||data.data.length>9*1024*1024)throw Error('ملف الإيصال غير مدعوم أو كبير جدًا');
    const mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'}[data.ext];o.proof_filename='receipt_'+o.id+'.'+data.ext;o.proof_data='data:'+mime+';base64,'+data.data;event(o.id,'حفظ الإيصال');
  }
  await save();return {ok:true,activation_code:o.activation_code};
}
const post=(path,obj)=>api(path,{method:'POST',body:JSON.stringify(obj)});
async function init(){try{db=await openDb();let stored=await dbRead();if(stored)state=stored;await dashboard()}catch(e){showNotice('تعذر فتح التخزين المحلي: '+e.message,true)}}
const tabs={dashboard:'OVERVIEW',orders:'ORDERS',wallet:'WALLET',guide:'GUIDE'};
function switchTab(tab){activeTab=tab;$$('.page').forEach(e=>e.classList.toggle('hidden',e.id!==tab));$$('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab));$('#crumb').textContent=tabs[tab];if(tab==='dashboard')dashboard();if(tab==='orders')orders();if(tab==='wallet')wallet();window.scrollTo({top:0,behavior:'smooth'})}
$$('[data-tab]').forEach(e=>e.onclick=()=>switchTab(e.dataset.tab));$$('[data-switch]').forEach(e=>e.onclick=()=>switchTab(e.dataset.switch));
$('#refreshBtn').onclick=()=>dashboard();$('#newOrderBtn').onclick=newOrder;$$('[data-new]').forEach(e=>e.onclick=newOrder);
function statusTag(s){return `<span class="pill ${esc(s)}">${statuses[s]||esc(s)}</span>`}
function tableOrders(rows){if(!rows.length)return '<div class="empty">مفيش طلبات هنا لسه.</div>';return `<table class="data-table"><thead><tr><th>العميل</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th>الإجراء</th></tr></thead><tbody>${rows.map(o=>`<tr><td class="name-cell"><strong>${esc(o.customer_name)}</strong><small>${esc(o.email)}</small></td><td><b>${money(o.amount)} ج</b></td><td>${statusTag(o.status)}</td><td>${date(o.created_at)}</td><td><button class="action-link" data-order="${o.id}">فتح ←</button></td></tr>`).join('')}</tbody></table>`}
function wireOrderButtons(){ $$('[data-order]').forEach(b=>b.onclick=()=>openOrder(+b.dataset.order)) }
async function dashboard(){try{let d=await api('/dashboard');$('#gross').textContent=money(d.gross_sales);$('#salesCount').textContent=money(d.sales_count);$('#pendingCount').textContent=money(d.counts.pending||0);$('#activeCount').textContent=money(d.counts.active||0);$('#walletBalance').textContent=money(d.estimated_balance);$('#recentOrders').innerHTML=tableOrders(d.recent);wireOrderButtons()}catch(e){showNotice(e.message,true)}}
async function orders(){try{let s=$('#statusFilter').value,q=$('#search').value;let d=await api('/orders?status='+encodeURIComponent(s)+'&q='+encodeURIComponent(q));$('#ordersTable').innerHTML=tableOrders(d.orders);wireOrderButtons()}catch(e){showNotice(e.message,true)}}
$('#statusFilter').onchange=orders;let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(orders,250)};
async function wallet(){try{let d=await api('/wallet');$('#walletBalance2').textContent=money(d.balance);$('#walletTable').innerHTML=d.entries.length?`<table class="data-table"><thead><tr><th>الحركة</th><th>الوصف</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${d.entries.map(x=>`<tr><td>${walletKinds[x.kind]}</td><td>${esc(x.description)}</td><td class="${['sale','opening','adjustment_in'].includes(x.kind)?'positive':'negative'}"><b>${['sale','opening','adjustment_in'].includes(x.kind)?'+':'−'}${money(x.amount)} ج</b></td><td>${date(x.created_at)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">مفيش حركات مسجلة لسه.</div>'}catch(e){showNotice(e.message,true)}}
$('#walletForm').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.currentTarget);try{await post('/wallet',{kind:f.get('kind'),amount:Number(f.get('amount')),description:f.get('description')});e.currentTarget.reset();showNotice('تم تسجيل حركة المحفظة');wallet()}catch(err){showNotice(err.message,true)}};
function modal(title,html){$('#modalTitle').textContent=title;$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden');currentOrder=null}$('#closeModal').onclick=closeModal;$('#modalBackdrop').onclick=closeModal;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function newOrder(){modal('تسجيل طلب جديد',`<form id="createOrder" class="form-grid"><label>اسم العميل<input name="customer_name" required maxlength="120" placeholder="الاسم بالكامل"></label><label>إيميل Google<input name="email" required type="email" dir="ltr" placeholder="name@gmail.com"></label><label>رقم واتساب<input name="whatsapp" required dir="ltr" placeholder="010xxxxxxxx"></label><label>المحفظة المحوّل منها<input name="sender_wallet" dir="ltr" placeholder="010xxxxxxxx"></label><label>المبلغ بالجنيه<input name="amount" type="number" min="1" max="1000000" required value="499"></label><label class="wide">ملاحظات (اختياري)<textarea name="note" rows="3" maxlength="1500" placeholder="مثال: مصدر الطلب / تفاصيل خاصة"></textarea></label><button class="btn primary" type="submit">حفظ الطلب ←</button></form><p class="smallnote">تسجيل الطلب لا يعني استلام التحويل. التحقق من الدفع والتفعيل خطوتان منفصلتان.</p>`);$('#createOrder').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.currentTarget);try{let d=await post('/orders',Object.fromEntries(f.entries()));showNotice('تم تسجيل الطلب رقم #'+d.id);await openOrder(d.id);await dashboard()}catch(err){showNotice(err.message,true)}}}
function whatsappUrl(phone,message){let p=String(phone||'').replace(/\D/g,'');if(p.startsWith('01')&&p.length===11)p='2'+p;return /^20?1\d{9}$/.test(p)?'https://wa.me/'+p+'?text='+encodeURIComponent(message):'https://wa.me/?text='+encodeURIComponent(message)}
function customerMsg(o){return `أهلًا ${o.customer_name} 👋\nتم تفعيل وصولك لمكتبة KORSUP على إيميل Google: ${o.email}\nرقم التفعيل الخاص بطلبك: ${o.activation_code}\nرابط المكتبة: ${DRIVE}\nافتح الرابط بنفس الإيميل المفعّل.\nلو واجهتك أي مشكلة، ابعتلنا هنا.\nKORSUP — Learn smarter. Live easier.`}
async function copy(t){try{await navigator.clipboard.writeText(t);showNotice('تم نسخ النص')}catch{showNotice('النسخ مش متاح في المتصفح ده',true)}}
async function openOrder(id){try{let {order:o,events}=await api('/orders/'+id);currentOrder=o;const paid=o.status==='paid',active=o.status==='active';const html=`<div class="detail-grid"><div><small>اسم العميل</small><strong>${esc(o.customer_name)}</strong></div><div><small>الحالة</small>${statusTag(o.status)}</div><div><small>إيميل Google</small><strong dir="ltr">${esc(o.email)}</strong></div><div><small>رقم واتساب</small><strong dir="ltr">${esc(o.whatsapp)}</strong></div><div><small>المحفظة المحوّل منها</small><strong dir="ltr">${esc(o.sender_wallet||'—')}</strong></div><div><small>المبلغ</small><strong>${money(o.amount)} جنيه</strong></div><div><small>تاريخ الطلب</small><strong>${date(o.created_at)}</strong></div><div><small>مرجع التحويل</small><strong>${esc(o.payment_reference||'—')}</strong></div></div>
<div class="steps-actions">
<div class="action-box"><h3>إثبات التحويل</h3><p>${o.proof_filename?'الإيصال محفوظ ضمن بيانات الطلب.':'ارفع صورة أو PDF للإيصال (حتى 6MB).'} احتفظ بالملف محليًا فقط.</p><div class="inline"><input id="receiptInput" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf"><button class="btn outline" id="receiptUpload">حفظ الإيصال</button>${o.proof_filename?`<a class="btn outline" href="${esc(o.proof_data||'#')}" download="${esc(o.proof_filename||'receipt')}" target="_blank" rel="noopener">عرض الإيصال</a>`:''}</div></div>
${o.status==='pending'?`<div class="action-box"><h3>01 / تأكيد وصول المبلغ</h3><p>اتأكد من وصول ${money(o.amount)} جنيه فعليًا في Vodafone Cash، ثم اكتب رقم مرجع العملية كما يظهر عندك.</p><div class="inline"><input id="paymentRef" placeholder="مرجع التحويل الفعلي" maxlength="100"><button class="btn primary" id="verifyBtn">تأكيد الدفع</button></div></div><div class="action-box"><button class="btn danger" id="cancelBtn">إلغاء الطلب غير المدفوع</button></div>`:''}
${paid?`<div class="action-box"><h3>02 / منح الوصول للمكتبة</h3><p>افتح Google Drive من حساب الإدارة، وأضف <b>${esc(o.email)}</b> بصلاحية Viewer على المجلد الصحيح. بعد ما تتأكد فعليًا، علّم على المربع.</p><div class="inline"><button class="btn outline" id="copyEmail">نسخ إيميل العميل</button><a class="btn outline" href="${DRIVE}" target="_blank" rel="noopener">فتح Google Drive ↗</a></div><label class="check"><input type="checkbox" id="viewerCheck"> أنا بالفعل منحت الإيميل صلاحية Viewer وتأكدت من صحة الإيميل</label><button class="btn primary" id="activateBtn" disabled>تأكيد التفعيل وإصدار رقم التفعيل</button></div>`:''}
${active?`<div class="action-box"><h3>تم التفعيل بنجاح ✓</h3><p>رقم التفعيل الإداري: <b dir="ltr">${esc(o.activation_code)}</b></p><div class="inline"><button class="btn primary" id="reportBtn">عرض تقرير التفعيل</button><button class="btn outline" id="copyMessage">نسخ رسالة العميل</button><a class="btn outline" id="whatsappCustomer" href="${esc(whatsappUrl(o.whatsapp,customerMsg(o)))}" target="_blank" rel="noopener">متابعة على واتساب ↗</a></div><p>${o.confirmed_at?'✓ تم تسجيل إرسال تأكيد الوصول في '+date(o.confirmed_at):'بعد إرسال الرسالة على واتساب، سجّل التأكيد هنا.'}</p>${!o.confirmed_at?'<button class="btn dark" id="confirmBtn">سجّلت إرسال رسالة التأكيد</button>':''}</div>`:''}
<div class="action-box"><h3>ملاحظات داخلية</h3><textarea id="orderNote" rows="3" maxlength="1500">${esc(o.note)}</textarea><div style="margin-top:10px"><button class="btn outline" id="saveNote">حفظ الملاحظة</button></div></div>
<div class="action-box"><h3>سجل الإجراءات</h3>${events.map(ev=>`<div class="event"><b>${esc(ev.event)}</b> — ${date(ev.created_at)}<br>${esc(ev.details)}</div>`).join('')}</div>
</div>`;modal('تفاصيل الطلب #'+o.id,html);
$('#receiptUpload').onclick=async()=>{let f=$('#receiptInput').files[0];if(!f)return showNotice('اختار ملف الإيصال الأول',true);if(f.size>6*1024*1024)return showNotice('حجم الملف أكبر من 6MB',true);let ext=f.name.split('.').pop().toLowerCase();let reader=new FileReader();reader.onload=async()=>{try{await post('/orders/'+id+'/receipt',{ext,data:String(reader.result).split(',')[1]});showNotice('تم حفظ الإيصال');openOrder(id)}catch(e){showNotice(e.message,true)}};reader.readAsDataURL(f)};
if($('#verifyBtn'))$('#verifyBtn').onclick=async()=>{if(!confirm('هل راجعت المحفظة بنفسك وتأكدت من استلام المبلغ؟'))return;try{await post('/orders/'+id+'/verify',{payment_reference:$('#paymentRef').value.trim()});showNotice('تم تسجيل الدفع وإضافة عملية بيع للمحفظة');await openOrder(id);dashboard()}catch(e){showNotice(e.message,true)}};
if($('#cancelBtn'))$('#cancelBtn').onclick=async()=>{if(!confirm('إلغاء الطلب غير المدفوع؟'))return;try{await post('/orders/'+id+'/cancel',{reason:'إلغاء يدوي'});showNotice('تم الإلغاء');openOrder(id);dashboard()}catch(e){showNotice(e.message,true)}};
if($('#viewerCheck'))$('#viewerCheck').onchange=e=>$('#activateBtn').disabled=!e.target.checked;
if($('#copyEmail'))$('#copyEmail').onclick=()=>copy(o.email);
if($('#activateBtn'))$('#activateBtn').onclick=async()=>{if(!confirm('تأكيد أنك أضفت الإيميل الصحيح بصلاحية Viewer على Google Drive؟'))return;try{let d=await post('/orders/'+id+'/activate',{viewer_granted:true});showNotice('تم التفعيل: '+d.activation_code);await openOrder(id);dashboard()}catch(e){showNotice(e.message,true)}};
if($('#confirmBtn'))$('#confirmBtn').onclick=async()=>{if(!confirm('هل أرسلت رسالة التأكيد فعلًا؟'))return;try{await post('/orders/'+id+'/confirm',{});showNotice('تم تسجيل إرسال التأكيد');openOrder(id)}catch(e){showNotice(e.message,true)}};
if($('#copyMessage'))$('#copyMessage').onclick=()=>copy(customerMsg(o));
if($('#reportBtn'))$('#reportBtn').onclick=()=>report(o);
$('#saveNote').onclick=async()=>{try{await post('/orders/'+id+'/note',{note:$('#orderNote').value});showNotice('تم حفظ الملاحظات');openOrder(id)}catch(e){showNotice(e.message,true)}};
}catch(e){showNotice(e.message,true)}}
function report(o){modal('تقرير تفعيل — '+o.activation_code,`<div class="report" id="printReport"><p class="eyebrow">KORSUP / ACTIVATION RECORD</p><h3>تقرير تفعيل الوصول</h3><p class="muted">سجل إداري داخلي — ليس إيصالًا مصرفيًا أو شهادة اعتماد</p><span class="report-code">${esc(o.activation_code)}</span><table><tr><td>رقم الطلب</td><td>#${o.id}</td></tr><tr><td>اسم العميل</td><td>${esc(o.customer_name)}</td></tr><tr><td>إيميل الوصول</td><td dir="ltr">${esc(o.email)}</td></tr><tr><td>واتساب</td><td dir="ltr">${esc(o.whatsapp)}</td></tr><tr><td>قيمة العملية</td><td>${money(o.amount)} جنيه مصري</td></tr><tr><td>مرجع الدفع المسجل</td><td>${esc(o.payment_reference)}</td></tr><tr><td>تاريخ تأكيد الدفع</td><td>${date(o.verified_at)}</td></tr><tr><td>تاريخ التفعيل</td><td>${date(o.activated_at)}</td></tr><tr><td>صلاحية Google Drive</td><td>Viewer — تم تأكيد منحها يدويًا</td></tr><tr><td>تأكيد العميل</td><td>${o.confirmed_at?date(o.confirmed_at):'لم يتم تسجيل إرسال التأكيد بعد'}</td></tr></table><p class="smallnote">تم إنشاء هذا التقرير من البيانات التي سجلها المدير داخل KORSUP Manage. رقم التفعيل معرف إداري فقط، ولا يمنح وصولًا بذاته.</p></div><div class="report-actions"><button class="btn primary" id="printBtn">طباعة / حفظ PDF</button><button class="btn outline" id="backOrder">العودة للطلب</button></div>`);$('#printBtn').onclick=()=>window.print();$('#backOrder').onclick=()=>openOrder(o.id)}
$('#clock').textContent=new Date().toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});
init();

function download(name,content,type='application/octet-stream'){
  let blob=new Blob([content],{type});let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
function csv(rows,headers){let q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';return '\uFEFF'+[headers.map(q).join(','),...rows.map(row=>row.map(q).join(','))].join('\r\n')}
$('#exportOrders').onclick=()=>download('korsup-orders-'+new Date().toISOString().slice(0,10)+'.csv',csv(state.orders.map(o=>[o.id,o.customer_name,o.email,o.whatsapp,o.sender_wallet,o.amount,o.status,o.payment_reference,o.activation_code,o.created_at,o.verified_at,o.activated_at]),['ID','Name','Google Email','WhatsApp','Sender Wallet','EGP','Status','Payment Reference','Activation Code','Created','Paid','Activated']),'text/csv;charset=utf-8');
$('#exportWallet').onclick=()=>download('korsup-wallet-'+new Date().toISOString().slice(0,10)+'.csv',csv(state.entries.map(x=>[x.id,x.kind,x.description,x.amount,signed(x),x.created_at]),['ID','Type','Description','Amount','Signed Amount','Date']),'text/csv;charset=utf-8');
function backup(){download('KORSUP-Manage-Backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({app:'KORSUP Manage Static',exported_at:now(),data:state},null,2),'application/json;charset=utf-8');showNotice('تم تجهيز النسخة الاحتياطية — احفظها في مكان آمن')}
$('#backupBtn').onclick=backup;$('#quickBackup').onclick=backup;
$('#restoreInput').onchange=async e=>{
  let f=e.target.files[0];if(!f)return;
  try{
    if(f.size>40*1024*1024)throw Error('النسخة الاحتياطية كبيرة جدًا');
    let json=JSON.parse(await f.text()),v=json.data;
    if(json.app!=='KORSUP Manage Static'||!v||!Array.isArray(v.orders)||!Array.isArray(v.entries)||!Array.isArray(v.events)||!Number.isInteger(v.nextId)||!Number.isInteger(v.nextActivation))throw Error('ملف النسخة الاحتياطية غير صالح');
    if(!confirm('استرجاع النسخة هيستبدل كل البيانات الحالية في هذا المتصفح. هل احتفظت بنسخة احتياطية منها؟'))return;
    state=v;await save();showNotice('تم استرجاع البيانات بنجاح');switchTab('dashboard');
  }catch(err){showNotice('تعذر الاسترجاع: '+err.message,true)}finally{e.target.value=''}
};
