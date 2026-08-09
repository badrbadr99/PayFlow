document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  let offset = 0;
  const pageSize = 10;
  try {
    await PF.requireAuth();
    PF.initShell('لوحة الحساب', 'رصيدك وعملياتك في مكان واحد');
    const profile = PF.state.profile;
    document.getElementById('welcomeTitle').textContent = `مرحبًا، ${(profile.full_name || '').split(' ')[0] || 'بك'}`;
    document.getElementById('usdtBalance').innerHTML = `${PF.money(profile.balance_usdt, '', 2)} <small style="font-size:13px">USDT</small>`;
    document.getElementById('supportLink').href = `https://wa.me/${PF.config.supportWhatsApp}`;
    setKyc(profile.kyc_status);
    document.getElementById('allNotifications').onclick = () => document.getElementById('notificationButton').click();
    await Promise.all([loadRates(), loadPending(), loadNotifications(), loadTransactions(true)]);
  } catch (error) {
    if (!String(error.message).includes('auth_required')) console.error(error);
  }

  function setKyc(status) {
    const value = String(status || 'NOT_SUBMITTED').toUpperCase();
    const copy = {
      APPROVED: ['حسابك موثّق', 'تم التحقق من هويتك ويمكنك استخدام جميع الخدمات.', 'عرض التفاصيل'],
      PENDING: ['طلب التوثيق قيد المراجعة', 'سنرسل لك إشعارًا فور انتهاء المراجعة.', 'متابعة الطلب'],
      REJECTED: ['يحتاج طلب التوثيق إلى تعديل', 'راجع سبب الرفض وأعد إرسال المستندات.', 'إعادة التقديم'],
      NOT_SUBMITTED: ['أكمل توثيق حسابك', 'التوثيق مطلوب للسحب ويحمي حسابك.', 'بدء التوثيق']
    }[value] || ['أكمل توثيق حسابك', 'التوثيق مطلوب للسحب ويحمي حسابك.', 'بدء التوثيق'];
    document.getElementById('kycTitle').textContent = copy[0];
    document.getElementById('kycDescription').textContent = copy[1];
    document.getElementById('kycAction').textContent = copy[2];
  }

  async function loadRates() {
    const { data } = await PF.sb.from('exchange_rates').select('*').order('rate_id').limit(1).maybeSingle();
    if (!data) return;
    document.getElementById('buyRate').textContent = PF.money(data.buy_rate, 'YER', 0);
    document.getElementById('sellRate').textContent = PF.money(data.sell_rate, 'YER', 0);
    document.getElementById('rateUpdated').textContent = PF.dateTime(data.updated_at);
  }

  async function loadPending() {
    const { count } = await PF.sb.from('transactions').select('transaction_id', { count: 'exact', head: true }).eq('user_id', PF.state.profile.user_id).in('status', ['PENDING', 'PROCESSING']);
    document.getElementById('pendingCount').textContent = count || 0;
  }

  async function loadNotifications() {
    const { data } = await PF.sb.from('notifications').select('*').eq('user_id', PF.state.profile.user_id).eq('audience', 'USER').order('created_at', { ascending: false }).limit(5);
    const holder = document.getElementById('dashboardNotifications');
    if (!data?.length) return holder.innerHTML = '<div class="table-empty">لا توجد إشعارات حتى الآن.</div>';
    holder.innerHTML = data.map(n => `<article class="notification-item"><span class="notification-dot"><i class="fa-solid ${n.icon || 'fa-bell'}"></i></span><div><strong>${PF.escapeHtml(n.title)}</strong><p>${PF.escapeHtml(n.message)}</p><p>${PF.dateTime(n.created_at)}</p></div></article>`).join('');
  }

  async function loadTransactions(reset = false) {
    if (reset) { offset = 0; document.getElementById('transactionsBody').innerHTML = ''; }
    const { data, error, count } = await PF.sb
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', PF.state.profile.user_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      document.getElementById('transactionsBody').innerHTML = `<tr><td class="table-empty" colspan="5">${PF.escapeHtml(PF.normalizeError(error))}</td></tr>`;
      return;
    }
    document.getElementById('transactionTotal').textContent = `${count || 0} عملية`;
    if (!data?.length && reset) document.getElementById('transactionsBody').innerHTML = '<tr><td class="table-empty" colspan="5">لا توجد عمليات بعد. ابدأ بأول إيداع لك.</td></tr>';
    else document.getElementById('transactionsBody').insertAdjacentHTML('beforeend', data.map(txRow).join(''));
    offset += data?.length || 0;
    document.getElementById('loadMoreWrap').style.display = offset < (count || 0) ? 'block' : 'none';
  }

  // ==========================================
  // دالة txRow المعدلة لحل مشكلة قص النصوص في الجوال
  // ==========================================
  function txRow(tx) {
    const meta = PF.transactionType(tx.type);
    const currency = tx.currency || 'USDT';
    const amount = currency === 'YER' ? tx.amount_yer : tx.amount_usdt;
    const sign = ['DEPOSIT', 'TRANSFER_IN'].includes(String(tx.type).toUpperCase()) ? '+' : ['WITHDRAW','YER_PAYOUT','TRANSFER_OUT'].includes(String(tx.type).toUpperCase()) ? '−' : '';
    
    // تنظيف النصوص وتأمينها
    const safeDesc = PF.escapeHtml(tx.description || '');
    const safeRef = PF.escapeHtml(tx.reference || '');

    // إرجاع صف الجدول مع إضافة min-widths واختصار النصوص الطويلة مع title
    return `<tr>
      <td>
        <div class="tx-type" style="min-width:140px;">
          <span class="type-icon ${meta.color}"><i class="fa-solid ${meta.icon}"></i></span>
          <div>
            <strong>${meta.label}</strong>
            <span title="${safeDesc}">${safeDesc.length > 28 ? safeDesc.substring(0, 28) + '...' : safeDesc}</span>
          </div>
        </div>
      </td>
      <td><span class="ref" title="${safeRef}">${safeRef.length > 16 ? safeRef.substring(0, 16) + '...' : safeRef}</span></td>
      <td class="mono nowrap ${sign === '+' ? 'text-primary' : ''}" style="min-width:70px;">${sign}${PF.money(amount, currency)}</td>
      <td class="nowrap" style="min-width:80px;">${PF.dateTime(tx.created_at)}</td>
      <td style="min-width:60px;">${PF.statusBadge(tx.status)}</td>
    </tr>`;
  }

  document.getElementById('loadMoreButton')?.addEventListener('click', () => loadTransactions(false));
});