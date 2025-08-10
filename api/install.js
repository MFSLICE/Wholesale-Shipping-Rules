const crypto = require('crypto');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }

  const { shop } = req.query || {};
  if (!shop || typeof shop !== 'string' || !shop.endsWith('.myshopify.com')) {
    res.statusCode = 400;
    return res.end('Missing or invalid shop parameter. Example: your-shop.myshopify.com');
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const baseUrl = process.env.APP_URL || `${protocol}://${host}`;

  const state = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + 10 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', `shopify_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${expires}`);

  const scopes = 'read_customers,read_orders,read_shipping,write_shipping,read_products';
  const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback`);
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&redirect_uri=${redirectUri}`;

  res.statusCode = 302;
  res.setHeader('Location', installUrl);
  return res.end();
};


