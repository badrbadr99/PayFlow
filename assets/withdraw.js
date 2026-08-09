document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  let mode = 'EXTERNAL_USDT';
  let rates = { buy_rate: 0, fee_percentage: 0, withdrawal_fee_usdt: 0 };
  try {
    await PF.requireAuth();
    PF.initShell('السحب والتحويل الخارجي', 'اسحب إلى محفظتك أو استلم بالريال اليمني');
    document.getElementById('availableBalance').textContent = PF.money(PF.state.profile.balance_usdt, 'USDT');
    const verified = String(PF.state.profile.kyc_status).toUpperCase() === 'APPROVED';
    document.getElementById('kycHint').textContent = verified ? 'حسابك موثّق وجاهز للسحب.' : 'يجب إكمال التوثيق قبل إرسال الطلب.';
    if (!verified) document.getElementById('withdrawButton').insertAdjacentHTML('beforebegin', '<a class="btn btn-secondary btn-block" style="margin-top:15px" href="kyc.html">توثيق الحساب الآن</a>');
    await Promise.all([loadRates(), loadPayoutMethods()]);
  } catch (error) { if (!String(error.message).includes('auth_required')) console.error(error); }

  async function loadRates() {
    const { data } = await PF.sb.from('exchange_rates').select('*').order('rate_id').limit(1).single();
    if (data) rates = data;
    calculate();
  }
  async function loadPayoutMethods() {
    const { data } = await PF.sb.from('payment_methods').select('*').eq('is_active', true).in('category', ['WITHDRAW', 'BOTH']).order('sort_order');
    document.getElementById('payoutMethod').innerHTML = '<option value="">اختر طريقة الاستلام</option>' + (data || []).map(m => `<option value="${m.method_id}">${PF.escapeHtml(m.name)}</option>`).join('');
  }
  function setMode(next) {
    mode = next;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('externalFields').classList.toggle('hidden', mode !== 'EXTERNAL_USDT');
    document.getElementById('yerFields').classList.toggle('hidden', mode !== 'YER_PAYOUT');
    document.getElementById('rateRow').classList.toggle('hidden', mode !== 'YER_PAYOUT');
    document.getElementById('summaryMode').textContent = mode === 'YER_PAYOUT' ? 'بيع USDT واستلام YER' : 'إلى محفظة USDT خارجية';
    document.getElementById('netLabel').textContent = mode === 'YER_PAYOUT' ? 'صافي الاستلام' : 'المبلغ المرسل';
    calculate();
  }
  function calculate() {
    const amount = Number(document.getElementById('withdrawAmount').value || 0);
    const fee = mode === 'YER_PAYOUT' ? amount * Number(rates.fee_percentage || 0) / 100 : Number(rates.withdrawal_fee_usdt || 0);
    const netUsdt = Math.max(0, amount - fee);
    document.getElementById('summaryGross').textContent = PF.money(amount, 'USDT');
    document.getElementById('summaryFee').textContent = PF.money(fee, 'USDT');
    document.getElementById('summaryRate').textContent = PF.money(rates.buy_rate, 'YER', 0);
    document.getElementById('summaryNet').textContent = mode === 'YER_PAYOUT' ? PF.money(netUsdt * Number(rates.buy_rate || 0), 'YER', 0) : PF.money(netUsdt, 'USDT');
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
  document.getElementById('withdrawAmount')?.addEventListener('input', calculate);
  document.getElementById('withdrawForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const amount = Number(document.getElementById('withdrawAmount').value || 0);
    if (!event.currentTarget.reportValidity()) return;
    if (String(PF.state.profile.kyc_status).toUpperCase() !== 'APPROVED') return PF.toast('يلزم توثيق الحساب قبل السحب.', 'error');
    if (amount <= 0 || amount > Number(PF.state.profile.balance_usdt || 0)) return PF.toast('تحقق من المبلغ ورصيدك المتاح.', 'error');
    const destination = mode === 'YER_PAYOUT' ? document.getElementById('payoutAccount').value.trim() : document.getElementById('walletAddress').value.trim();
    const beneficiary = mode === 'YER_PAYOUT' ? document.getElementById('payoutName').value.trim() : null;
    const methodId = mode === 'YER_PAYOUT' ? Number(document.getElementById('payoutMethod').value) : null;
    if (!destination || (mode === 'YER_PAYOUT' && (!beneficiary || !methodId))) return PF.toast('أكمل جميع بيانات الاستلام.', 'error');
    if (mode === 'EXTERNAL_USDT' && destination.length < 20) return PF.toast('عنوان المحفظة غير صحيح.', 'error');
    const button = document.getElementById('withdrawButton');
    PF.setButtonLoading(button, true, 'جاري تسجيل الطلب...');
    try {
      const { data, error } = await PF.sb.rpc('create_withdraw_request', {
        p_amount_usdt: amount,
        p_payout_type: mode,
        p_destination: destination,
        p_network: mode === 'EXTERNAL_USDT' ? document.getElementById('network').value : null,
        p_payment_method_id: methodId,
        p_beneficiary_name: beneficiary
      });
      if (error) throw error;
      const row = PF.parseRpcRow(data);
      PF.modal({ title: 'تم إنشاء طلب السحب', body: `<div style="text-align:center;padding:10px"><span class="feature-icon" style="margin:0 auto 14px;color:var(--amber);background:rgba(248,184,78,.1)"><i class="fa-solid fa-hourglass-half"></i></span><h3>الطلب قيد المعالجة</h3><p class="muted" style="line-height:1.8">تم حجز المبلغ من رصيدك لحين موافقة الإدارة. سيعاد تلقائيًا إذا رُفض الطلب.</p><div class="method-card"><span class="muted">الرقم المرجعي</span><strong class="ref" style="display:block;margin-top:7px;font-size:14px">${PF.escapeHtml(row?.reference || '')}</strong></div></div>`, actions: '<a class="btn btn-primary" href="dashboard.html">عرض سجل العمليات</a>' });
      event.currentTarget.reset(); calculate();
    } catch (error) { PF.toast(PF.normalizeError(error), 'error'); PF.setButtonLoading(button, false); }
  });
});
