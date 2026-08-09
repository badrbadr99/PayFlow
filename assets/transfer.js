document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  let recipientData = null;
  try {
    await PF.requireAuth();
    PF.initShell('تحويل داخلي', 'تحويل فوري وآمن داخل PayFlow');
    document.getElementById('transferBalance').textContent = PF.money(PF.state.profile.balance_usdt, 'USDT');
  } catch (error) { if (!String(error.message).includes('auth_required')) console.error(error); }

  function calculate() {
    const amount = Number(document.getElementById('transferAmount').value || 0);
    document.getElementById('transferSummary').textContent = PF.money(amount, 'USDT');
    document.getElementById('transferNet').textContent = PF.money(amount, 'USDT');
  }
  async function checkRecipient(showErrors = true) {
    const identifier = document.getElementById('recipient').value.trim();
    if (!identifier) { if (showErrors) PF.toast('اكتب بريد المستلم أو رقم هاتفه.', 'error'); return null; }
    const button = document.getElementById('checkRecipient');
    PF.setButtonLoading(button, true, 'جاري التحقق...');
    try {
      const { data, error } = await PF.sb.rpc('lookup_transfer_recipient', { p_identifier: identifier });
      if (error) throw error;
      recipientData = PF.parseRpcRow(data);
      if (!recipientData) throw new Error('recipient_not_found');
      document.getElementById('recipientPreview').innerHTML = `<div style="display:flex;align-items:center;gap:11px"><span class="avatar">${PF.escapeHtml((recipientData.full_name || 'م').slice(0,2))}</span><div><strong>${PF.escapeHtml(recipientData.full_name)}</strong><div class="muted ltr" style="font-size:11px;margin-top:3px">${PF.escapeHtml(recipientData.masked_identifier || '')}</div></div><i class="fa-solid fa-circle-check text-primary" style="margin-right:auto"></i></div>`;
      document.getElementById('recipientPreview').classList.remove('hidden');
      return recipientData;
    } catch (error) {
      recipientData = null;
      document.getElementById('recipientPreview').classList.add('hidden');
      if (showErrors) PF.toast(PF.normalizeError(error), 'error');
      return null;
    } finally { PF.setButtonLoading(button, false); }
  }
  document.getElementById('recipient').addEventListener('input', () => { recipientData = null; document.getElementById('recipientPreview').classList.add('hidden'); });
  document.getElementById('checkRecipient').onclick = () => checkRecipient(true);
  document.getElementById('transferAmount').addEventListener('input', calculate);
  document.getElementById('transferForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const amount = Number(document.getElementById('transferAmount').value || 0);
    if (amount <= 0 || amount > Number(PF.state.profile.balance_usdt || 0)) return PF.toast('تحقق من المبلغ ورصيدك المتاح.', 'error');
    if (!recipientData) recipientData = await checkRecipient(true);
    if (!recipientData) return;
    PF.modal({
      title: 'تأكيد التحويل',
      body: `<div style="text-align:center;padding:8px"><span class="avatar" style="margin:0 auto 11px">${PF.escapeHtml((recipientData.full_name || 'م').slice(0,2))}</span><p class="muted">أنت على وشك التحويل إلى</p><h3>${PF.escapeHtml(recipientData.full_name)}</h3><div class="method-card" style="margin-top:14px"><span class="muted">المبلغ</span><strong class="mono text-primary" style="display:block;font-size:24px;margin-top:6px">${PF.money(amount, 'USDT')}</strong></div><p class="text-danger" style="font-size:11px;margin-top:14px">التحويل الداخلي فوري ولا يمكن التراجع عنه.</p></div>`,
      actions: '<button class="btn btn-secondary" data-close-modal>إلغاء</button><button class="btn btn-primary" id="confirmTransfer"><i class="fa-solid fa-check"></i> تأكيد وإرسال</button>'
    });
    document.getElementById('confirmTransfer').onclick = () => executeTransfer(amount);
  });

  async function executeTransfer(amount) {
    const button = document.getElementById('confirmTransfer');
    PF.setButtonLoading(button, true, 'جاري التحويل...');
    try {
      const { data, error } = await PF.sb.rpc('internal_transfer', {
        p_identifier: document.getElementById('recipient').value.trim(),
        p_amount_usdt: amount,
        p_note: document.getElementById('transferNote').value.trim() || null
      });
      if (error) throw error;
      const result = PF.parseRpcRow(data);
      PF.closeModal();
      PF.modal({ title: 'تم التحويل بنجاح', body: `<div style="text-align:center;padding:10px"><span class="feature-icon" style="margin:0 auto 14px"><i class="fa-solid fa-check"></i></span><h3>${PF.money(amount, 'USDT')}</h3><p class="muted">وصل التحويل إلى ${PF.escapeHtml(recipientData.full_name)}.</p><div class="method-card"><span class="muted">الرقم المرجعي</span><strong class="ref" style="display:block;margin-top:7px;font-size:14px">${PF.escapeHtml(result?.reference || '')}</strong></div></div>`, actions: '<a class="btn btn-primary" href="dashboard.html">العودة إلى الحساب</a>' });
      document.getElementById('transferForm').reset(); calculate();
    } catch (error) { PF.toast(PF.normalizeError(error), 'error'); PF.setButtonLoading(button, false); }
  }
});
