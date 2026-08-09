(function () {
  'use strict';

  const sb = window.payflow;
  const config = window.PAYFLOW_CONFIG;
  const state = { session: null, profile: null, notifications: [] };

  const TYPE_META = {
    DEPOSIT: ['إيداع رصيد', 'fa-arrow-down', 'text-primary'],
    WITHDRAW: ['سحب USDT', 'fa-arrow-up', 'text-danger'],
    YER_PAYOUT: ['بيع USDT', 'fa-money-bill-transfer', 'text-amber'],
    TRANSFER_OUT: ['تحويل صادر', 'fa-arrow-left', 'text-danger'],
    TRANSFER_IN: ['تحويل وارد', 'fa-arrow-right', 'text-primary'],
    ADJUSTMENT: ['تسوية رصيد', 'fa-sliders', 'text-amber']
  };

  const STATUS_LABELS = {
    NOT_SUBMITTED: 'غير مقدم',
    PENDING: 'بانتظار الموافقة',
    PROCESSING: 'جاري المعالجة',
    COMPLETED: 'مكتملة',
    APPROVED: 'مقبولة',
    REJECTED: 'مرفوضة',
    FAILED: 'فشلت',
    CANCELLED: 'ملغاة'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeError(error) {
    const text = error?.message || String(error || 'حدث خطأ غير متوقع');
    const map = [
      ['Invalid login credentials', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
      ['Email not confirmed', 'يرجى تأكيد بريدك الإلكتروني أولاً.'],
      ['User already registered', 'هذا البريد مسجل بالفعل.'],
      ['Password should be at least', 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.'],
      ['kyc_required', 'يلزم توثيق الحساب قبل تنفيذ هذه العملية.'],
      ['insufficient_balance', 'رصيدك الحالي غير كافٍ لتنفيذ العملية.'],
      ['account_inactive', 'الحساب مجمد. تواصل مع خدمة العملاء.'],
      ['recipient_not_found', 'لم يتم العثور على المستلم.'],
      ['cannot_transfer_to_self', 'لا يمكنك التحويل إلى حسابك نفسه.'],
      ['request_already_reviewed', 'تمت معالجة هذا الطلب مسبقاً.'],
      ['not_authorized', 'ليس لديك صلاحية لتنفيذ هذا الإجراء.']
    ];
    return map.find(([key]) => text.includes(key))?.[1] || text;
  }

  function toast(message, type = 'success', title) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'error' : ''}`;
    item.innerHTML = `
      <i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
      <div><strong>${escapeHtml(title || (type === 'error' ? 'تعذر إكمال الطلب' : 'تم بنجاح'))}</strong><span>${escapeHtml(message)}</span></div>
      <button type="button" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>`;
    item.querySelector('button').onclick = () => item.remove();
    wrap.appendChild(item);
    setTimeout(() => item.remove(), 5200);
  }

  function setButtonLoading(button, loading, label = 'جاري المعالجة...') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`;
    } else {
      button.disabled = false;
      button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    }
  }

  function money(value, currency = 'USDT', decimals) {
    const amount = Number(value || 0);
    const digits = decimals ?? (currency === 'YER' ? 0 : 2);
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)} ${currency}`;
  }

  function dateTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('ar-YE', {
      dateStyle: 'medium', timeStyle: 'short', hour12: true
    }).format(new Date(value));
  }

  function statusBadge(status) {
    const normalized = String(status || 'PENDING').toUpperCase();
    const styleStatus = normalized === 'NOT_SUBMITTED' ? 'cancelled' : normalized.toLowerCase();
    return `<span class="status status-${styleStatus}">${STATUS_LABELS[normalized] || escapeHtml(normalized)}</span>`;
  }

  function transactionType(type) {
    const normalized = String(type || 'ADJUSTMENT').toUpperCase();
    const meta = TYPE_META[normalized] || [normalized, 'fa-receipt', 'text-primary'];
    return { label: meta[0], icon: meta[1], color: meta[2] };
  }

  function randomFileName(file) {
    const safe = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${crypto.randomUUID()}.${safe || 'bin'}`;
  }

  async function uploadFile(bucket, file, folder = '') {
    if (!file) throw new Error('اختر الملف المطلوب أولاً.');
    if (file.size > 7 * 1024 * 1024) throw new Error('حجم الملف يجب ألا يتجاوز 7 ميجابايت.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      throw new Error('الصيغ المسموحة: JPG وPNG وWEBP وPDF.');
    }
    const userId = state.session?.user?.id;
    const path = [userId, folder, randomFileName(file)].filter(Boolean).join('/');
    const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return path;
  }

  async function signedFileUrl(bucket, path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
  }

  async function getProfile(session) {
    const { data, error } = await sb
      .from('users')
      .select('user_id,auth_user_id,full_name,email,phone_number,balance_usdt,balance_yer,kyc_status,is_active,role,created_at,deleted_at')
      .eq('auth_user_id', session.user.id)
      .single();
    if (error) throw error;
    return data;
  }

  async function requireAuth(options = {}) {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) {
      location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html')}`);
      throw new Error('auth_required');
    }
    state.session = session;
    try {
      state.profile = await getProfile(session);
    } catch (profileError) {
      await sb.auth.signOut();
      location.replace('login.html?profile=missing');
      throw profileError;
    }
    if (Number(state.profile.is_active) !== 1 || state.profile.deleted_at) {
      await sb.auth.signOut();
      location.replace('login.html?inactive=1');
      throw new Error('account_inactive');
    }
    if (options.admin && String(state.profile.role).toUpperCase() !== 'ADMIN') {
      location.replace('dashboard.html');
      throw new Error('not_authorized');
    }
    return state;
  }

  async function redirectIfSignedIn() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    try {
      const profile = await getProfile(session);
      location.replace(String(profile.role).toUpperCase() === 'ADMIN' ? 'admin.html' : 'dashboard.html');
    } catch (_) { /* Leave the page usable if the profile is not ready yet. */ }
  }

  function appNavigation(admin) {
    const base = [
      ['dashboard.html', 'fa-grid-2', 'نظرة عامة', 'dashboard'],
      ['deposit.html', 'fa-arrow-down-to-line', 'إيداع رصيد', 'deposit'],
      ['withdraw.html', 'fa-arrow-up-from-bracket', 'سحب وتحويل خارجي', 'withdraw'],
      ['transfer.html', 'fa-right-left', 'تحويل داخلي', 'transfer'],
      ['kyc.html', 'fa-id-card', 'توثيق الحساب', 'kyc']
    ];
    if (admin) base.push(['admin.html', 'fa-shield-halved', 'إدارة المنصة', 'admin']);
    const page = document.body.dataset.page;
    return base.map(([href, icon, label, key]) => `
      <a class="nav-link ${page === key ? 'active' : ''}" href="${href}">
        <i class="fa-solid ${icon}"></i><span>${label}</span>
      </a>`).join('');
  }

  function initShell(title, subtitle) {
    const admin = String(state.profile.role).toUpperCase() === 'ADMIN';
    const initials = (state.profile.full_name || 'مستخدم').trim().slice(0, 2);
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('topbar');
    sidebar.innerHTML = `
      <a href="dashboard.html" class="brand"><span class="brand-mark">P</span><span>PayFlow</span></a>
      <div class="nav-label">القائمة الرئيسية</div>
      <nav class="nav-menu">${appNavigation(admin)}</nav>
      <div class="sidebar-account">
        <span class="avatar">${escapeHtml(initials)}</span>
        <div class="account-copy"><strong>${escapeHtml(state.profile.full_name)}</strong><span>${escapeHtml(state.profile.email)}</span></div>
        <button class="btn icon-btn btn-secondary btn-sm" type="button" id="sidebarLogout" aria-label="تسجيل الخروج"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
      </div>`;
    topbar.innerHTML = `
      <div style="display:flex;align-items:center;gap:11px">
        <button class="btn icon-btn btn-secondary menu-toggle" id="menuToggle" aria-label="فتح القائمة"><i class="fa-solid fa-bars"></i></button>
        <div class="topbar-title"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || 'إدارة أموالك بكل سهولة وأمان')}</p></div>
      </div>
      <div class="topbar-actions">
        <span class="muted user-short" style="font-size:11px">مرحبًا، ${escapeHtml((state.profile.full_name || '').split(' ')[0])}</span>
        <button class="btn icon-btn btn-secondary" id="notificationButton" type="button" aria-label="الإشعارات"><i class="fa-regular fa-bell"></i><span class="count-badge hidden" id="notificationCount">0</span></button>
      </div>`;
    
    document.getElementById('sidebarLogout').onclick = logout;
    
    const menuToggle = document.getElementById('menuToggle');
    menuToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    // إغلاق القائمة تلقائياً عند النقر على أي رابط أو شعار داخلها
    sidebar.querySelectorAll('.nav-link, .brand').forEach(link => {
      link.addEventListener('click', () => {
        sidebar.classList.remove('open');
      });
    });

    document.addEventListener('click', (event) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && !event.target.closest('#menuToggle')) {
        sidebar.classList.remove('open');
      }
    });
    
    loadNotificationCount();
  }

  async function loadNotificationCount() {
    let query = sb.from('notifications').select('notification_id', { count: 'exact', head: true }).eq('is_read', false);
    if (String(state.profile.role).toUpperCase() === 'ADMIN') query = query.eq('audience', 'ADMIN');
    else query = query.eq('user_id', state.profile.user_id).eq('audience', 'USER');
    const { count } = await query;
    const badge = document.getElementById('notificationCount');
    if (!badge) return;
    badge.textContent = count || 0;
    badge.classList.toggle('hidden', !count);
  }

  async function showNotifications() {
    closeDrawer();
    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.id = 'drawerBackdrop';
    backdrop.onclick = closeDrawer;
    const drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.id = 'notificationDrawer';
    drawer.innerHTML = `
      <div class="drawer-head"><div><strong>الإشعارات</strong><div class="muted" style="font-size:10px;margin-top:3px">آخر تحديثات حسابك</div></div><button class="btn icon-btn btn-secondary btn-sm" onclick="PayFlow.closeDrawer()"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="drawer-body" id="drawerNotifications"><div class="table-empty"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div></div>`;
    document.body.append(backdrop, drawer);
    requestAnimationFrame(() => drawer.classList.add('open'));
    let query = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(30);
    if (String(state.profile.role).toUpperCase() === 'ADMIN') query = query.eq('audience', 'ADMIN');
    else query = query.eq('user_id', state.profile.user_id).eq('audience', 'USER');
    const { data, error } = await query;
    const holder = document.getElementById('drawerNotifications');
    if (error) holder.innerHTML = `<div class="table-empty">${escapeHtml(normalizeError(error))}</div>`;
    else if (!data?.length) holder.innerHTML = '<div class="table-empty">لا توجد إشعارات جديدة.</div>';
    else holder.innerHTML = data.map(n => `
      <article class="notification-item">
        <span class="notification-dot"><i class="fa-solid ${n.icon || 'fa-bell'}"></i></span>
        <div><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.message)}</p><p>${dateTime(n.created_at)}</p></div>
      </article>`).join('');
    const unreadIds = (data || []).filter(n => !n.is_read).map(n => n.notification_id);
    if (unreadIds.length) {
      await sb.rpc('mark_notifications_read', { p_notification_ids: unreadIds });
      loadNotificationCount();
    }
  }

  function closeDrawer() {
    document.getElementById('notificationDrawer')?.remove();
    document.getElementById('drawerBackdrop')?.remove();
  }

  function modal({ title, body, actions = '', size = '' }) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'appModal';
    backdrop.innerHTML = `
      <section class="modal" ${size ? `style="width:${size}"` : ''} role="dialog" aria-modal="true">
        <header class="modal-head"><h3>${escapeHtml(title)}</h3><button class="btn icon-btn btn-secondary btn-sm" type="button" data-close-modal><i class="fa-solid fa-xmark"></i></button></header>
        <div class="modal-body">${body}</div>
        ${actions ? `<footer class="modal-actions">${actions}</footer>` : ''}
      </section>`;
    backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('[data-close-modal]')) closeModal(); });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function closeModal() { document.getElementById('appModal')?.remove(); }

  async function logout() {
    await sb.auth.signOut();
    location.replace('login.html');
  }

  function bindFileLabel(inputId, labelId) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    input?.addEventListener('change', () => { label.textContent = input.files?.[0]?.name || 'لم يتم اختيار ملف'; });
  }

  function parseRpcRow(data) {
    if (Array.isArray(data)) return data[0];
    return data;
  }

  window.PayFlow = {
    sb, config, state, escapeHtml, normalizeError, toast, setButtonLoading, money, dateTime,
    statusBadge, transactionType, uploadFile, signedFileUrl, requireAuth, redirectIfSignedIn,
    initShell, logout, modal, closeModal, closeDrawer, bindFileLabel, parseRpcRow, loadNotificationCount
  };
})();