module.exports = async function handler(req, res) {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    HAS_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
};
