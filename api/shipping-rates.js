// Shopify Carrier Service callback – returns rates based on wholesale rules

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim());
  return String(tags).split(',').map((t) => t.trim()).filter(Boolean);
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  try {
    const body = parseBody(req);
    console.log('[shipping-rates] incoming:', JSON.stringify(body));

    const rate = body && body.rate ? body.rate : null;
    if (!rate) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Invalid rate payload' }));
    }

    const items = Array.isArray(rate.items) ? rate.items : [];
    const currency = rate.currency || 'USD';

    const totalPriceCents = items.reduce((sum, item) => {
      const price = Number(item && item.price != null ? item.price : 0);
      const quantity = Number(item && item.quantity != null ? item.quantity : 0);
      return sum + Math.round(price) * Math.max(0, quantity);
    }, 0);

    let tags = [];
    if (rate.customer && (rate.customer.tags || rate.customer.tag)) {
      tags = normalizeTags(rate.customer.tags || rate.customer.tag);
    }

    const isWholesaler = tags.includes('Wholesaler');
    const qualifiesForFree = isWholesaler && totalPriceCents >= 100000; // $1000

    let responseBody;
    if (qualifiesForFree) {
      responseBody = {
        rates: [
          {
            service_name: 'Free Shipping',
            service_code: 'FREE_SHIPPING',
            total_price: '0',
            currency,
            description: 'Free shipping for wholesale orders ≥ $1000',
          },
        ],
      };
    } else if (isWholesaler) {
      responseBody = {
        rates: [
          {
            service_name: 'Standard Shipping',
            service_code: 'STANDARD',
            total_price: '899',
            currency,
            description: 'Standard shipping for wholesale orders under $1000',
          },
          {
            service_name: 'Express Shipping',
            service_code: 'EXPRESS',
            total_price: '1599',
            currency,
            description: 'Express shipping for wholesale orders under $1000',
          },
        ],
      };
    } else {
      // Non-wholesale: let Shopify handle with store-defined rates
      responseBody = { rates: [] };
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(responseBody));
  } catch (err) {
    console.error('[shipping-rates] error:', err && err.message ? err.message : err);
    res.statusCode = 200; // return empty to fallback on Shopify rules
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ rates: [] }));
  }
};


