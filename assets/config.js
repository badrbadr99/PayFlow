(function () {
  'use strict';

  const config = {
    supabaseUrl: 'https://dnitbzmtbedrgfkmxszp.supabase.co',
    supabaseAnonKey: 'sb_publishable_5MpSpsrOXjHCSRNTllJO8g_twaTzmbf',
    appName: 'PayFlow',
    supportWhatsApp: '967774837354'
  };

  window.PAYFLOW_CONFIG = config;
  window.payflow = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
})();
