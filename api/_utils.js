const https = require('https');

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

function hubspotRequest(method, apiPath, data) {
    return new Promise((resolve, reject) => {
        if (!HUBSPOT_TOKEN) {
            return reject(new Error('HUBSPOT_TOKEN is not configured'));
        }

        const options = {
            hostname: 'api.hubapi.com',
            path: apiPath,
            method: method,
            headers: {
                'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )
}

module.exports = {
    hubspotRequest,
    setCors
};
