const https = require('https');

const FLEX_INSTANCE_SID = 'GObc617f97259f4b7580c9fbfda6f01680';

function flexRequest(method, path, body, accountSid, authToken) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'flex-api.twilio.com',
      path: `/v4/Instances/${FLEX_INSTANCE_SID}${path}`,
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function (context, event, callback) {
  const { ACCOUNT_SID, AUTH_TOKEN } = context;
  const { flex_user_sid } = event;

  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (!flex_user_sid) {
    response.setStatusCode(400);
    response.setBody({ error: 'flex_user_sid is required' });
    return callback(null, response);
  }

  try {
    // Mint an authentication token for the given Flex user.
    // https://www.twilio.com/docs/flex/developer/flex-sdk/authentication#mint-an-authentication-token
    const mint = await flexRequest('POST', `/Users/${flex_user_sid}/Tokens`, { ttl: 3600 }, ACCOUNT_SID, AUTH_TOKEN);

    if (mint.status !== 200 && mint.status !== 201) {
      console.error('Token mint failed:', JSON.stringify(mint.body));
      response.setStatusCode(mint.status || 500);
      response.setBody({ error: 'Failed to mint Flex token', detail: mint.body });
      return callback(null, response);
    }

    response.setBody({ token: mint.body.access_token, flex_user_sid });
    return callback(null, response);
  } catch (err) {
    console.error('token.js error:', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
