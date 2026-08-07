document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  const dataState = { operations: [], transactions: [], users: [], kyc: [], methods: [], rates: null, activeTab: 'operations' };
  try {
    await PF.requireAuth({ admin: true });
    PF.initShell('إدارة المنصة', 'الطلبات والعملاء والإعدادات');
    bindEvents();
    await loadAll();
  } catch (error) { if (!String(error.message).includes('auth_required')) console.error(error); }

  function bindEvents() {
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.adminTab));
    document.getElementById('refreshAdmin').onclick = loadAll;
    document.getElementById('adminSearchButton').onclick = runSearch;
    document.getElementById('adminSearch').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });
    document.getElementById('ratesForm').addEventListener('submit', saveRates);
    document.getElementById('addMethod').onclick = () => methodModal();
  }

  function switchTab(tab) {
    dataState.activeTab = tab;
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('active', s.id === `section-${tab}`));
    runSearch();
  }

  async function loadAll() {
    const button = document.getElementById('refreshAdmin');
    PF.setButtonLoading(button, true, 'تحديث...');
    try {
      await Promise.all([loadOperations(), loadTransactions(), loadUsers(), loadKyc(), loadSettings(), loadStats()]);
      PF.toast('تم تحديث بيانات لوحة الإدارة.');
    } catch (error) { PF.toast(PF.normalizeError(error), 'error'); }
    finally { PF.setButtonLoading(button, false); }
  }

  async function loadStats() {
    const start = new Date(); start.setHours(0,0,0,0);
    const [users, dep, wit, kyc, today] = await Promise.all([
      PF.sb.from('users').select('user_id', { count: 'exact', head: true }).is('deleted_at', null),
      PF.sb.from('deposit_requests').select('deposit_id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      PF.sb.from('withdraw_requests').select('withdraw_id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      PF.sb.from('kyc_requests').select('kyc_id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      PF.sb.from('transactions').select('transaction_id', { count: 'exact', head: true }).gte('created_at', start.toISOString())
    ]);
    document.getElementById('usersStat').textContent = users.count || 0;
    document.getElementById('pendingStat').textContent = (dep.count || 0) + (wit.count || 0);
    document.getElementById('kycStat').textContent = kyc.count || 0;
    document.getElementById('todayStat').textContent = today.count || 0;
  }

  async function loadOperations() {
    const [depRes, witRes] = await Promise.all([
      PF.sb.from('deposit_requests').select('*,users(full_name,email,phone_number)').eq('status','PENDING').order('created_at',{ascending:false}),
      PF.sb.from('withdraw_requests').select('*,users(full_name,email,phone_number),payment_methods(name)').eq('status','PENDING').order('created_at',{ascending:false})
    ]);
    if (depRes.error) throw depRes.error; if (witRes.error) throw witRes.error;
    dataState.operations = [
      ...(depRes.data || []).map(x => ({ ...x, request_type: 'DEPOSIT' })),
      ...(witRes.data || []).map(x => ({ ...x, request_type: 'WITHDRAW' }))
    ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    renderOperations(dataState.operations);
  }

  function renderOperations(rows) {
    const body = document.getElementById('operationsBody');
    if (!rows.length) return body.innerHTML = '<tr><td class="table-empty" colspan="7">لا توجد طلبات معلقة الآن.</td></tr>';
    body.innerHTML = rows.map(row => {
      const deposit = row.request_type === 'DEPOSIT';
      const reference = row.reference;
      const amount = deposit ? PF.money(row.net_usdt, 'USDT') : PF.money(row.amount_usdt, 'USDT');
      const detail = deposit ? (row.payment_method || 'إيداع بالريال') : (row.payout_type === 'YER_PAYOUT' ? `${row.payment_methods?.name || 'استلام بالريال'} • ${row.beneficiary_name || ''} • ${row.destination || ''}` : `${row.network || 'TRC20'} • ${row.destination || ''}`);
      const id = deposit ? row.deposit_id : row.withdraw_id;
      return `<tr><td><div class="tx-type"><span class="type-icon ${deposit ? 'text-primary' : 'text-danger'}"><i class="fa-solid ${deposit ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></span><div><strong>${deposit ? 'طلب إيداع' : 'طلب سحب'}</strong><span class="ref">${PF.escapeHtml(reference)}</span></div></div></td><td><strong>${PF.escapeHtml(row.users?.full_name || '—')}</strong><div class="muted ltr" style="font-size:10px">${PF.escapeHtml(row.users?.email || '')}</div></td><td class="mono nowrap">${amount}</td><td>${PF.escapeHtml(detail)} ${deposit && row.proof_path ? `<button class="btn btn-secondary btn-sm" onclick="Admin.viewProof('deposit-proofs','${PF.escapeHtml(row.proof_path)}')"><i class="fa-regular fa-image"></i></button>` : ''}</td><td class="nowrap">${PF.dateTime(row.created_at)}</td><td>${PF.statusBadge(row.status)}</td><td><div class="table-actions"><button class="btn btn-primary btn-sm" onclick="Admin.reviewOperation('${row.request_type}',${id},'APPROVED')">قبول</button><button class="btn btn-danger btn-sm" onclick="Admin.reviewOperation('${row.request_type}',${id},'REJECTED')">رفض</button></div></td></tr>`;
    }).join('');
  }

  async function loadTransactions(query = '') {
    const { data, error } = await PF.sb.rpc('admin_search_transactions', { p_query: query || null, p_limit: 200 });
    if (error) throw error;
    dataState.transactions = data || [];
    renderTransactions(dataState.transactions);
  }
  function renderTransactions(rows) {
    const body = document.getElementById('adminTransactionsBody');
    if (!rows.length) return body.innerHTML = '<tr><td class="table-empty" colspan="6">لا توجد نتائج.</td></tr>';
    body.innerHTML = rows.map(tx => { const meta = PF.transactionType(tx.type); const amount = tx.currency === 'YER' ? tx.amount_yer : tx.amount_usdt; return `<tr><td><div class="tx-type"><span class="type-icon ${meta.color}"><i class="fa-solid ${meta.icon}"></i></span><strong>${meta.label}</strong></div></td><td><strong>${PF.escapeHtml(tx.full_name || '—')}</strong><div class="muted ltr" style="font-size:10px">${PF.escapeHtml(tx.email || '')}</div></td><td><span class="ref">${PF.escapeHtml(tx.reference)}</span></td><td class="mono nowrap">${PF.money(amount, tx.currency || 'USDT')}</td><td class="nowrap">${PF.dateTime(tx.created_at)}</td><td>${PF.statusBadge(tx.status)}</td></tr>`; }).join('');
  }

  async function loadUsers() {
    const { data, error } = await PF.sb.from('users').select('*').order('created_at',{ascending:false}).limit(500);
    if (error) throw error; dataState.users = data || []; renderUsers(dataState.users);
  }
  function renderUsers(rows) {
    const body = document.getElementById('usersBody');
    if (!rows.length) return body.innerHTML = '<tr><td class="table-empty" colspan="7">لا توجد حسابات.</td></tr>';
    body.innerHTML = rows.map(u => { const active = Number(u.is_active) === 1 && !u.deleted_at; return `<tr><td><strong>${PF.escapeHtml(u.full_name || '—')}</strong><div class="muted mono" style="font-size:10px">#${u.user_id} • ${PF.escapeHtml(u.role || 'USER')}</div></td><td><div class="ltr">${PF.escapeHtml(u.email || '')}</div><div class="muted ltr" style="font-size:10px">${PF.escapeHtml(u.phone_number || '')}</div></td><td class="mono text-primary">${PF.money(u.balance_usdt,'USDT')}</td><td>${PF.statusBadge(String(u.kyc_status).toUpperCase() === 'APPROVED' ? 'APPROVED' : 'PENDING')}</td><td>${active ? '<span class="status status-completed">نشط</span>' : '<span class="status status-rejected">مجمد/مؤرشف</span>'}</td><td class="nowrap">${PF.dateTime(u.created_at)}</td><td><div class="table-actions"><button class="btn ${active ? 'btn-warning' : 'btn-primary'} btn-sm" onclick="Admin.toggleUser(${u.user_id},${active})">${active ? 'تجميد' : 'تفعيل'}</button>${!u.deleted_at ? `<button class="btn btn-danger btn-sm" onclick="Admin.archiveUser(${u.user_id})">حذف</button>` : ''}</div></td></tr>`; }).join('');
  }

  async function loadKyc() {
    const { data, error } = await PF.sb.from('kyc_requests').select('*,users(full_name,email,phone_number)').order('created_at',{ascending:false}).limit(300);
    if (error) throw error; dataState.kyc = data || []; renderKyc(dataState.kyc);
  }
  function renderKyc(rows) {
    const body = document.getElementById('kycBody');
    if (!rows.length) return body.innerHTML = '<tr><td class="table-empty" colspan="7">لا توجد طلبات توثيق.</td></tr>';
    body.innerHTML = rows.map(k => `<tr><td><span class="ref">KYC-${k.kyc_id}</span></td><td><strong>${PF.escapeHtml(k.users?.full_name || '—')}</strong><div class="muted ltr" style="font-size:10px">${PF.escapeHtml(k.users?.email || '')}</div></td><td><strong>${PF.escapeHtml(k.document_type)}</strong><div class="muted mono" style="font-size:10px">${PF.escapeHtml(k.document_number)}</div></td><td><div class="table-actions"><button class="btn btn-secondary btn-sm" onclick="Admin.viewProof('kyc-documents','${PF.escapeHtml(k.document_front_path || '')}')">الأمام</button>${k.document_back_path ? `<button class="btn btn-secondary btn-sm" onclick="Admin.viewProof('kyc-documents','${PF.escapeHtml(k.document_back_path)}')">الخلف</button>` : ''}<button class="btn btn-secondary btn-sm" onclick="Admin.viewProof('kyc-documents','${PF.escapeHtml(k.selfie_path || '')}')">الشخصية</button></div></td><td class="nowrap">${PF.dateTime(k.created_at)}</td><td>${PF.statusBadge(k.status)}</td><td>${String(k.status).toUpperCase()==='PENDING' ? `<div class="table-actions"><button class="btn btn-primary btn-sm" onclick="Admin.reviewKyc(${k.kyc_id},'APPROVED')">قبول</button><button class="btn btn-danger btn-sm" onclick="Admin.reviewKyc(${k.kyc_id},'REJECTED')">رفض</button></div>` : '—'}</td></tr>`).join('');
  }

  async function loadSettings() {
    const [ratesRes, methodsRes] = await Promise.all([
      PF.sb.from('exchange_rates').select('*').order('rate_id').limit(1).single(),
      PF.sb.from('payment_methods').select('*').order('sort_order')
    ]);
    if (ratesRes.error) throw ratesRes.error; if (methodsRes.error) throw methodsRes.error;
    dataState.rates = ratesRes.data; dataState.methods = methodsRes.data || [];
    document.getElementById('adminBuyRate').value = dataState.rates.buy_rate;
    document.getElementById('adminSellRate').value = dataState.rates.sell_rate;
    document.getElementById('adminFee').value = dataState.rates.fee_percentage;
    document.getElementById('adminWithdrawFee').value = dataState.rates.withdrawal_fee_usdt;
    renderMethods();
  }
  function renderMethods() {
    const holder = document.getElementById('paymentMethodsList');
    if (!dataState.methods.length) return holder.innerHTML = '<div class="table-empty">لا توجد طرق دفع.</div>';
    holder.innerHTML = dataState.methods.map(m => `<div class="method-admin"><div><strong>${PF.escapeHtml(m.name)}</strong><span>${PF.escapeHtml(m.category)} • ${PF.escapeHtml(m.account_number || 'بدون رقم')} • ${m.is_active ? 'نشطة' : 'مجمدة'}</span></div><div class="table-actions"><button class="btn btn-secondary btn-sm" onclick="Admin.editMethod(${m.method_id})">تعديل</button><button class="btn ${m.is_active ? 'btn-warning' : 'btn-primary'} btn-sm" onclick="Admin.toggleMethod(${m.method_id},${m.is_active})">${m.is_active ? 'تجميد' : 'تفعيل'}</button></div></div>`).join('');
  }

  async function saveRates(event) {
    event.preventDefault(); const button = document.getElementById('saveRates'); PF.setButtonLoading(button,true,'جاري الحفظ...');
    try {
      const payload = { buy_rate:Number(document.getElementById('adminBuyRate').value), sell_rate:Number(document.getElementById('adminSellRate').value), fee_percentage:Number(document.getElementById('adminFee').value), withdrawal_fee_usdt:Number(document.getElementById('adminWithdrawFee').value), updated_at:new Date().toISOString() };
      const { error } = await PF.sb.from('exchange_rates').update(payload).eq('rate_id',dataState.rates.rate_id); if (error) throw error;
      PF.toast('تم تحديث الأسعار والعمولات.'); await loadSettings();
    } catch(error){ PF.toast(PF.normalizeError(error),'error'); } finally { PF.setButtonLoading(button,false); }
  }

  function runSearch() {
    const q = document.getElementById('adminSearch').value.trim().toLowerCase();
    if (dataState.activeTab === 'transactions') return loadTransactions(q).catch(e => PF.toast(PF.normalizeError(e),'error'));
    const includes = (...values) => values.some(v => String(v || '').toLowerCase().includes(q));
    if (dataState.activeTab === 'operations') renderOperations(dataState.operations.filter(x => includes(x.reference,x.users?.email,x.users?.phone_number,x.users?.full_name)));
    if (dataState.activeTab === 'users') renderUsers(dataState.users.filter(x => includes(x.email,x.phone_number,x.full_name,x.user_id)));
    if (dataState.activeTab === 'kyc') renderKyc(dataState.kyc.filter(x => includes(x.kyc_id,x.document_number,x.users?.email,x.users?.phone_number,x.users?.full_name)));
  }

  async function reviewOperation(type, id, decision) {
    reviewModal(`${decision === 'APPROVED' ? 'قبول' : 'رفض'} طلب ${type === 'DEPOSIT' ? 'الإيداع' : 'السحب'}`, async note => {
      const fn = type === 'DEPOSIT' ? 'admin_review_deposit' : 'admin_review_withdraw';
      const argId = type === 'DEPOSIT' ? 'p_deposit_id' : 'p_withdraw_id';
      const { error } = await PF.sb.rpc(fn,{ [argId]:id, p_decision:decision, p_note:note || null }); if(error) throw error;
      PF.toast('تمت معالجة الطلب بنجاح.'); await loadAll();
    }, decision === 'REJECTED');
  }
  async function reviewKyc(id, decision) {
    reviewModal(`${decision === 'APPROVED' ? 'قبول' : 'رفض'} طلب التوثيق`, async note => {
      const { error } = await PF.sb.rpc('admin_review_kyc',{p_kyc_id:id,p_decision:decision,p_reason:note || null}); if(error) throw error;
      PF.toast('تم تحديث حالة التوثيق.'); await Promise.all([loadKyc(),loadStats()]);
    }, decision === 'REJECTED');
  }
  function reviewModal(title, callback, required) {
    PF.modal({title,body:`<div class="field"><label for="reviewNote">${required ? 'سبب الرفض' : 'ملاحظة للإدارة (اختياري)'}</label><textarea class="textarea" id="reviewNote" ${required?'required':''} placeholder="اكتب ملاحظة واضحة تظهر للعميل"></textarea></div>`,actions:'<button class="btn btn-secondary" data-close-modal>إلغاء</button><button class="btn btn-primary" id="confirmReview">تأكيد القرار</button>'});
    document.getElementById('confirmReview').onclick = async () => { const note=document.getElementById('reviewNote').value.trim(); if(required&&!note)return PF.toast('اكتب سبب الرفض.','error'); const b=document.getElementById('confirmReview');PF.setButtonLoading(b,true,'جاري التنفيذ...');try{await callback(note);PF.closeModal();}catch(e){PF.toast(PF.normalizeError(e),'error');PF.setButtonLoading(b,false);} };
  }
  async function viewProof(bucket,path){ if(!path)return PF.toast('الملف غير متاح.','error'); try{const url=await PF.signedFileUrl(bucket,path);const content=/\.pdf$/i.test(path)?`<iframe src="${url}" title="الملف المرفوع" style="width:100%;height:68vh;border:0;border-radius:12px;background:white"></iframe>`:`<img class="proof-image" src="${url}" alt="إثبات مرفوع">`;PF.modal({title:'عرض الملف',body:content,size:'780px'});}catch(e){PF.toast(PF.normalizeError(e),'error');} }
  async function toggleUser(id,active){ try{const{error}=await PF.sb.rpc('admin_set_user_status',{p_user_id:id,p_active:!active});if(error)throw error;PF.toast(active?'تم تجميد الحساب.':'تم تفعيل الحساب.');await loadUsers();}catch(e){PF.toast(PF.normalizeError(e),'error');} }
  function archiveUser(id){const name=dataState.users.find(u=>u.user_id===id)?.full_name||'';PF.modal({title:'حذف وأرشفة الحساب',body:`<div class="notice"><i class="fa-solid fa-triangle-exclamation"></i><div>سيتم تجميد حساب <strong>${PF.escapeHtml(name)}</strong> وإخفاؤه مع الإبقاء على السجل المالي لأغراض التدقيق.</div></div><div class="field" style="margin-top:15px"><label for="archiveReason">سبب الأرشفة</label><textarea class="textarea" id="archiveReason" required></textarea></div>`,actions:'<button class="btn btn-secondary" data-close-modal>إلغاء</button><button class="btn btn-danger" id="confirmArchive">حذف وأرشفة</button>'});document.getElementById('confirmArchive').onclick=async()=>{const reason=document.getElementById('archiveReason').value.trim();if(!reason)return PF.toast('اكتب سبب الأرشفة.','error');try{const{error}=await PF.sb.rpc('admin_archive_user',{p_user_id:id,p_reason:reason});if(error)throw error;PF.closeModal();PF.toast('تمت أرشفة الحساب.');await loadUsers();}catch(e){PF.toast(PF.normalizeError(e),'error');}};}
  function methodModal(methodId){const m=dataState.methods.find(x=>x.method_id===methodId)||{};PF.modal({title:methodId?'تعديل طريقة الدفع':'إضافة طريقة دفع',body:`<div class="field"><label>الاسم</label><input class="input" id="methodName" value="${PF.escapeHtml(m.name||'')}" required></div><div class="field"><label>الاستخدام</label><select class="select" id="methodCategory"><option value="BOTH">إيداع واستلام</option><option value="DEPOSIT">إيداع فقط</option><option value="WITHDRAW">استلام فقط</option></select></div><div class="field"><label>اسم الحساب</label><input class="input" id="methodAccountName" value="${PF.escapeHtml(m.account_name||'')}"></div><div class="field"><label>رقم الحساب/الهاتف</label><input class="input ltr" id="methodAccountNumber" value="${PF.escapeHtml(m.account_number||'')}"></div><div class="field"><label>تعليمات للعميل</label><textarea class="textarea" id="methodInstructions">${PF.escapeHtml(m.instructions||'')}</textarea></div>`,actions:'<button class="btn btn-secondary" data-close-modal>إلغاء</button><button class="btn btn-primary" id="saveMethod">حفظ</button>'});document.getElementById('methodCategory').value=m.category||'BOTH';document.getElementById('saveMethod').onclick=async()=>{const payload={name:document.getElementById('methodName').value.trim(),category:document.getElementById('methodCategory').value,account_name:document.getElementById('methodAccountName').value.trim()||null,account_number:document.getElementById('methodAccountNumber').value.trim()||null,instructions:document.getElementById('methodInstructions').value.trim()||null,is_active:m.is_active??true,sort_order:m.sort_order??dataState.methods.length+1};if(!payload.name)return PF.toast('اكتب اسم طريقة الدفع.','error');try{const query=methodId?PF.sb.from('payment_methods').update(payload).eq('method_id',methodId):PF.sb.from('payment_methods').insert(payload);const{error}=await query;if(error)throw error;PF.closeModal();PF.toast('تم حفظ طريقة الدفع.');await loadSettings();}catch(e){PF.toast(PF.normalizeError(e),'error');}};}
  async function toggleMethod(id,active){try{const{error}=await PF.sb.from('payment_methods').update({is_active:!active,updated_at:new Date().toISOString()}).eq('method_id',id);if(error)throw error;await loadSettings();}catch(e){PF.toast(PF.normalizeError(e),'error');}}
  window.Admin={reviewOperation,reviewKyc,viewProof,toggleUser,archiveUser,editMethod:methodModal,toggleMethod};
});
