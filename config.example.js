// Copy these fields to config.js after preparing the NEW independent project.
// This file is public. supabaseKey holds the public publishable key only:
//   sb_publishable_* from the new project's API settings. A legacy anon JWT still works
//   in config.js, but the deployment build accepts only sb_publishable_* keys.
// Embedding a public publishable key is safe: every read and write is enforced by the
// project's RLS and Storage policies, not by the key.
// Never use service_role JWTs, sb_secret_* keys, database passwords, or access tokens.
window.TALLER_CONFIG = Object.freeze({
    supabaseUrl: '', // HTTPS project origin from the new project's dashboard.
    supabaseKey: '' // Public publishable key, e.g. sb_publishable_<project public key>.
});
