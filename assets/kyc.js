document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  let existingRequest = null;
  try {
    await PF.requireAuth();
    PF.initShell('توثيق الحساب', 'تحقق آمن من الهوية');
    PF.bindFileLabel('documentFront', 'frontFileName');
    PF.bindFileLabel('documentBack', 'backFileName');
    PF.bindFileLabel('selfieFile', 'selfieFileName');
    await loadCurrentKyc();
  } catch (error) { if (!String(error.message).includes('auth_required')) console.error(error); }

  async function loadCurrentKyc() {
    const { data } = await PF.sb.from('kyc_requests').select('*').eq('user_id', PF.state.profile.user_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    existingRequest = data;
    const status = String(data?.status || PF.state.profile.kyc_status || 'NOT_SUBMITTED').toUpperCase();
<<<<<<< HEAD
    const badge = document.getElementById('kycStatusBadge');
    badge.outerHTML = PF.statusBadge(status);
=======
    
    const badge = document.getElementById('kycStatusBadge');
    if (badge) {
      badge.outerHTML = PF.statusBadge(status);
    }

>>>>>>> 23e8d4937bb2a1d3c1270af7990383fd6112a535
    if (!data || status === 'REJECTED') {
      if (status === 'REJECTED') {
        const reason = data.rejection_reason || 'راجع جودة المستندات والبيانات ثم أعد الإرسال.';
        document.getElementById('kycExisting').innerHTML = `<div class="notice" style="margin-bottom:17px"><i class="fa-solid fa-circle-xmark"></i><div><strong style="display:block;margin-bottom:4px">تعذر قبول الطلب السابق</strong>${PF.escapeHtml(reason)}</div></div>`;
        document.getElementById('kycExisting').classList.remove('hidden');
      }
      return;
    }
    const approved = status === 'APPROVED';
    document.getElementById('kycFields').classList.add('hidden');
    document.getElementById('kycExisting').innerHTML = `<div style="text-align:center;padding:28px 10px"><span class="feature-icon" style="margin:0 auto 15px;${approved ? '' : 'color:var(--amber);background:rgba(248,184,78,.1)'}"><i class="fa-solid ${approved ? 'fa-user-check' : 'fa-hourglass-half'}"></i></span><h3>${approved ? 'تم توثيق حسابك' : 'طلبك قيد المراجعة'}</h3><p class="muted" style="line-height:1.8">${approved ? 'يمكنك الآن استخدام جميع مزايا السحب والتحويل.' : 'استلمنا مستنداتك وسنرسل لك إشعارًا فور انتهاء المراجعة.'}</p><div class="method-card" style="margin-top:15px"><div class="method-detail"><span>نوع المستند</span><strong>${PF.escapeHtml(data.document_type)}</strong></div><div class="method-detail"><span>تاريخ التقديم</span><strong>${PF.dateTime(data.created_at)}</strong></div></div></div>`;
    document.getElementById('kycExisting').classList.remove('hidden');
  }

  document.getElementById('kycForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const type = document.getElementById('documentType').value;
    const front = document.getElementById('documentFront').files[0];
    const back = document.getElementById('documentBack').files[0];
    const selfie = document.getElementById('selfieFile').files[0];
    if (type !== 'PASSPORT' && !back) return PF.toast('صورة الوجه الخلفي مطلوبة لهذا المستند.', 'error');
    const button = document.getElementById('kycButton');
    PF.setButtonLoading(button, true, 'جاري رفع المستندات...');
    const paths = [];
    try {
      const frontPath = await PF.uploadFile('kyc-documents', front, 'front'); paths.push(frontPath);
      const backPath = back ? await PF.uploadFile('kyc-documents', back, 'back') : null; if (backPath) paths.push(backPath);
      const selfiePath = await PF.uploadFile('kyc-documents', selfie, 'selfie'); paths.push(selfiePath);
      const { data, error } = await PF.sb.rpc('submit_kyc_request', {
        p_document_type: type,
        p_document_number: document.getElementById('documentNumber').value.trim(),
        p_front_path: frontPath,
        p_back_path: backPath,
        p_selfie_path: selfiePath
      });
      if (error) throw error;
      PF.toast('تم إرسال طلب التوثيق للمراجعة.');
      await loadCurrentKyc();
    } catch (error) {
      if (paths.length) await PF.sb.storage.from('kyc-documents').remove(paths);
      PF.toast(PF.normalizeError(error), 'error');
<<<<<<< HEAD
      PF.setButtonLoading(button, false);
    }
  });
});
=======
    } finally {
      PF.setButtonLoading(button, false);
    }
  });
});
>>>>>>> 23e8d4937bb2a1d3c1270af7990383fd6112a535
