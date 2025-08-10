const crypto = require('crypto');

module.exports = async (req, res) => {
  console.log('INSTALL FUNCTION CALLED');
  console.log('ENV CHECK:', JSON.stringify({
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? 'loaded' : 'missing'
  }));
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
  // Prefer explicit APP_URL (set this in Vercel to production domain)
  const configuredBaseUrl = process.env.APP_URL || `${protocol}://${host}`;
  const expectedProdCallback = 'https://wholesale-shipping-rules.vercel.app/api/auth/callback';

  const state = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + 10 * 60 * 1000).toUTCString();
  res.setHeader('Set-Cookie', `shopify_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${expires}`);

  const scopes = 'read_customers,read_orders,read_shipping,write_shipping,read_products';
  const redirectUriRaw = `${configuredBaseUrl}/api/auth/callback`;
  const clientId = process.env.SHOPIFY_API_KEY;
  if (!clientId) {
    console.error('[install] Missing SHOPIFY_API_KEY environment variable');
    res.statusCode = 500;
    return res.end('Server not configured: missing client_id');
  }
  // Build OAuth URL without double-encoding redirect_uri or scopes
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&redirect_uri=${redirectUriRaw}`;

  // Debug logging
  console.log('[install] params', JSON.stringify({ shop, configuredBaseUrl, redirectUriRaw, scopes, state }));
  console.log('[install] client_id', JSON.stringify(clientId));
  console.log('REDIRECTING TO:', JSON.stringify(installUrl));
  if (redirectUriRaw !== expectedProdCallback) {
    console.warn('[install] redirect_uri does not match expected production callback', JSON.stringify({
      redirectUriRaw,
      expectedProdCallback
    }));
  }

  res.statusCode = 302;
  res.setHeader('Location', installUrl);
  return res.end();
};


