// Copy these fields to config.js after preparing the NEW independent project.
// This file is public. Only sb_publishable_* or legacy anon JWT keys belong here.
// Public keys require audited owner-scoped RLS and Storage policies.
// Never use service_role JWTs, sb_secret_* keys, database passwords, or access tokens.
window.TALLER_CONFIG = Object.freeze({
    supabaseUrl: '', // HTTPS project origin from the new project's dashboard.
    supabaseKey: '' // Public publishable key (preferred) or legacy anon key.
});
