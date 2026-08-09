document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  let rates = { sell_rate: 0, fee_percentage: 0 };
  let methods = [];
  try {
    await PF.requireAuth();
    PF.initShell('إيداع رصيد', 'شراء USDT عبر طرق الدفع المحلية');
    document.getElementById('senderName').value = PF.state.profile.full_name || '';
    document.getElementById('senderPhone').value = PF.state.profile.phone_number || '';
    PF.bindFileLabel('depositProof', 'proofFileName');
    await Promise.all([loadRates(), loadMethods()]);
  } catch (error) { if (!String(error.message).includes('auth_required')) console.error(error); }

  async function loadRates() {
    const { data, error } = await PF.sb.from('exchange_rates').select('*').order('rate_id').limit(1).single();
    if (error) return PF.toast(PF.normalizeError(error), 'error');
    rates = data;
    calculate();
  }

  async function loadMethods() {
    const { data, error } = await PF.sb.from('payment_methods').select('*').eq('is_active', true).in('category', ['DEPOSIT', 'BOTH']).order('sort_order');
    if (error) return PF.toast(PF.normalizeError(error), 'error');
    methods = data || [];
    const select = document.getElementById('paymentMethod');
    select.innerHTML = '<option value="">اختر طريقة الدفع</option>' + methods.map(m => `<option value="${m.method_id}">${PF.escapeHtml(m.name)}</option>`).join('');
  }

  function showMethod() {
    const method = methods.find(m => String(m.method_id) === document.getElementById('paymentMethod').value);
    const holder = document.getElementById('methodDetails');
    if (!method) return holder.classList.add('hidden');
    holder.innerHTML = `<h4>${PF.escapeHtml(method.name)}</h4>${method.account_name ? `<div class="method-detail"><span>اسم الحساب</span><strong>${PF.escapeHtml(method.account_name)}</strong></div>` : ''}${method.account_number ? `<div class="method-detail"><span>رقم الحساب</span><strong>${PF.escapeHtml(method.account_number)}</strong></div>` : ''}${method.instructions ? `<div class="method-detail"><span>تعليمات</span><strong style="direction:rtl;text-align:right">${PF.escapeHtml(method.instructions)}</strong></div>` : ''}`;
    holder.classList.remove('hidden');
  }

  function calculate() {
    const yer = Number(document.getElementById('depositAmount').value || 0);
    const rate = Number(rates.sell_rate || 0);
    const gross = rate > 0 ? yer / rate : 0;
    const equivalentUsdt = gross;
    document.getElementById('summaryYer').textContent = PF.money(yer, 'YER', 0);
    document.getElementById('summaryRate').textContent = rate ? PF.money(rate, 'YER', 0) : '—';
    document.getElementById('summaryFee').textContent = PF.money(equivalentUsdt, 'USDT');
    document.getElementById('summaryNet').textContent = PF.money(yer, 'YER', 0);
  }

  document.getElementById('paymentMethod')?.addEventListener('change', showMethod);
  document.getElementById('depositAmount')?.addEventListener('input', calculate);
  document.getElementById('depositForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const amount = Number(document.getElementById('depositAmount').value);
    if (amount < 1000) return PF.toast('الحد الأدنى للإيداع 1,000 ريال يمني.', 'error');
    if (!Number(rates.sell_rate)) return PF.toast('سعر الصرف غير متاح الآن.', 'error');
    const button = document.getElementById('depositButton');
    PF.setButtonLoading(button, true, 'جاري رفع الإثبات...');
    let uploadedPath = null;
    try {
      uploadedPath = await PF.uploadFile('deposit-proofs', document.getElementById('depositProof').files[0], 'receipts');
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تسجيل الطلب...';
      const { data, error } = await PF.sb.rpc('create_deposit_request', {
        p_amount_yer: amount,
        p_payment_method_id: Number(document.getElementById('paymentMethod').value),
        p_proof_path: uploadedPath,
        p_sender_name: document.getElementById('senderName').value.trim(),
        p_sender_phone: document.getElementById('senderPhone').value.trim()
      });
      if (error) throw error;
      const row = PF.parseRpcRow(data);
      PF.modal({ title: 'تم إرسال طلب الإيداع', body: `<div style="text-align:center;padding:10px"><span class="feature-icon" style="margin:0 auto 14px"><i class="fa-solid fa-clock"></i></span><h3>طلبك بانتظار المراجعة</h3><p class="muted" style="line-height:1.8">سيصلك إشعار فور المعالجة، وعند القبول سيضاف المبلغ إلى رصيد YER.</p><div class="method-card"><span class="muted">الرقم المرجعي</span><strong class="ref" style="display:block;margin-top:7px;font-size:14px">${PF.escapeHtml(row?.reference || '')}</strong></div></div>`, actions: '<a class="btn btn-primary" href="dashboard.html">العودة إلى الحساب</a>' });
      form.reset(); calculate(); showMethod();
    } catch (error) {
      if (uploadedPath) await PF.sb.storage.from('deposit-proofs').remove([uploadedPath]);
      PF.toast(PF.normalizeError(error), 'error');
      PF.setButtonLoading(button, false);
    }
  });
});
