document.addEventListener('DOMContentLoaded', async () => {
  const PF = window.PayFlow;
  const params = new URLSearchParams(location.search);
  const isRecovery = location.hash.includes('type=recovery') || params.get('type') === 'recovery';
  PF.sb.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    setTimeout(() => {
      PF.modal({
        title: 'تعيين كلمة مرور جديدة',
        body: '<div class="field"><label for="recoveryPassword">كلمة المرور الجديدة</label><input class="input ltr" id="recoveryPassword" type="password" minlength="8" placeholder="8 أحرف على الأقل"></div>',
        actions: '<button class="btn btn-primary" id="saveRecoveryPassword">حفظ كلمة المرور</button>'
      });
      document.getElementById('saveRecoveryPassword').onclick = async () => {
        const password = document.getElementById('recoveryPassword').value;
        if (password.length < 8) return PF.toast('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.', 'error');
        const button = document.getElementById('saveRecoveryPassword');
        PF.setButtonLoading(button, true, 'جاري الحفظ...');
        const { error } = await PF.sb.auth.updateUser({ password });
        if (error) { PF.toast(PF.normalizeError(error), 'error'); PF.setButtonLoading(button, false); return; }
        PF.closeModal(); PF.toast('تم تحديث كلمة المرور.');
        location.replace('dashboard.html');
      };
    }, 0);
  });
  if (!isRecovery) await PF.redirectIfSignedIn();
  if (params.get('inactive')) PF.toast('الحساب مجمد. تواصل مع خدمة العملاء.', 'error');
  if (params.get('profile')) PF.toast('تعذر العثور على ملف الحساب. راجع إعداد قاعدة البيانات.', 'error');

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!loginForm.reportValidity()) return;
      const button = document.getElementById('loginButton');
      PF.setButtonLoading(button, true, 'جاري تسجيل الدخول...');
      try {
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;
        const { data, error } = await PF.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const profile = await PF.sb.from('users').select('role,is_active,deleted_at').eq('auth_user_id', data.user.id).single();
        if (profile.error) throw profile.error;
        if (Number(profile.data.is_active) !== 1 || profile.data.deleted_at) {
          await PF.sb.auth.signOut();
          throw new Error('account_inactive');
        }
        const requested = params.get('next');
        const safeNext = /^[a-z0-9-]+\.html$/i.test(requested || '') ? requested : null;
        location.replace(safeNext || (String(profile.data.role).toUpperCase() === 'ADMIN' ? 'admin.html' : 'dashboard.html'));
      } catch (error) {
        PF.toast(PF.normalizeError(error), 'error');
        PF.setButtonLoading(button, false);
      }
    });

    document.getElementById('forgotPassword').addEventListener('click', async (event) => {
      event.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      if (!email) return PF.toast('اكتب بريدك الإلكتروني أولاً.', 'error');
      try {
        const redirectTo = new URL('login.html', location.href).href;
        const { error } = await PF.sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        PF.toast('أرسلنا رابط استعادة كلمة المرور إلى بريدك.');
      } catch (error) { PF.toast(PF.normalizeError(error), 'error'); }
    });
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!registerForm.reportValidity()) return;
      const button = document.getElementById('registerButton');
      PF.setButtonLoading(button, true, 'جاري إنشاء الحساب...');
      try {
        const fullName = document.getElementById('regName').value.trim();
        const phone = document.getElementById('regPhone').value.trim().replace(/\s+/g, '');
        const email = document.getElementById('regEmail').value.trim().toLowerCase();
        const password = document.getElementById('regPassword').value;
        if (fullName.length < 3) throw new Error('أدخل الاسم الكامل بشكل صحيح.');
        if (!/^\+?[0-9]{8,15}$/.test(phone)) throw new Error('أدخل رقم هاتف صحيحًا مع رمز الدولة عند الحاجة.');
        const { data, error } = await PF.sb.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: new URL('login.html', location.href).href,
            data: { full_name: fullName, phone_number: phone }
          }
        });
        if (error) throw error;
        if (data.session) {
          PF.toast('تم إنشاء الحساب بنجاح.');
          location.replace('dashboard.html');
        } else {
          PF.modal({
            title: 'أكد بريدك الإلكتروني',
            body: '<div style="text-align:center;padding:12px"><div class="feature-icon" style="margin:0 auto 14px"><i class="fa-regular fa-envelope"></i></div><p class="muted" style="line-height:1.8">أرسلنا رابط تأكيد إلى بريدك. افتح الرابط ثم عد لتسجيل الدخول.</p></div>',
            actions: '<a class="btn btn-primary" href="login.html">الانتقال لتسجيل الدخول</a>'
          });
        }
      } catch (error) {
        PF.toast(PF.normalizeError(error), 'error');
        PF.setButtonLoading(button, false);
      }
    });
  }
});
