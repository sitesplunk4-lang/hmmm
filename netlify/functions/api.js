const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const makeHeaders = (cookie) => ({
    'Cookie': `.ROBLOSECURITY=${cookie.trim()}`,
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': 'https://www.roblox.com/'
});

const router = express.Router();

async function fetchDeepData(userId, headers) {
    let data = { 
        ageDays: 0, isBanned: false, robux: null, premium: false, rap: 0, limitedCount: 0, 
        topLimited: [], topGames: [], outfits: [], animations: [], 
        emailStatus: 'Unknown', twoFactor: 'Unknown', ageVerified: false, birthdate: null 
    };
    
    try { const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`, { headers }); const j = await r.json(); if (j.data?.length > 0) data.avatarUrl = j.data[0].imageUrl; } catch(e) {}
    try { const r = await fetch(`https://users.roblox.com/v1/users/${userId}`, { headers }); const j = await r.json(); data.ageDays = Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000); data.isBanned = j.isBanned; } catch(e) {}
    try { const r = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, { headers }); if(r.ok) data.robux = (await r.json()).robux; } catch(e) {}
    try { const r = await fetch(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`, { headers }); if(r.ok) data.premium = (await r.json()) === true; } catch(e) {}
    try { const r = await fetch(`https://accountsettings.roblox.com/v1/account/settings`, { headers }); const j = await r.json(); data.emailStatus = j.emailStatus; data.twoFactor = j.twoStepVerification; } catch(e) {}
    try { const r = await fetch(`https://users.roblox.com/v1/birthdate`, { headers }); const j = await r.json(); data.birthdate = j.birthMonth ? `${j.birthMonth}/${j.birthDay}/${j.birthYear}` : 'Hidden'; } catch(e) {}
    try { const r = await fetch(`https://users.roblox.com/v1/age-verification`, { headers }); const j = await r.json(); data.ageVerified = j.verified; } catch(e) {}

    try {
        const r = await fetch(`https://inventory.roblox.com/v2/users/${userId}/inventory/3?limit=100&sortOrder=Desc`, { headers });
        const j = await r.json();
        const assets = j.data || [];
        for (let i = 0; i < assets.length; i += 10) {
            const batch = assets.slice(i, i + 10);
            await Promise.all(batch.map(async (a) => {
                try {
                    const det = await fetch(`https://economy.roblox.com/v2/assets/${a.assetId}/details`, { headers });
                    const d = await det.json();
                    if (d.IsLimited || d.IsLimitedUnique) {
                        data.limitedCount++;
                        let itemRap = 0;
                        try { const rr = await fetch(`https://economy.roblox.com/v1/assets/${a.assetId}/resale-data`, { headers }); itemRap = (await rr.json()).recentAveragePrice || 0; } catch(e) {}
                        data.rap += itemRap;
                        if (data.topLimited.length < 6) {
                            let imgUrl = `https://www.roblox.com/asset-thumbnail/image?assetId=${a.assetId}&width=150&height=150&format=png`;
                            try { const t = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${a.assetId}&size=150x150&format=Png`, { headers }); const tj = await t.json(); if(tj.data?.length>0) imgUrl = tj.data[0].imageUrl; } catch(e) {}
                            data.topLimited.push({ name: d.Name, rap: itemRap, image: imgUrl });
                        }
                    }
                } catch(e) {}
            }));
        }
    } catch(e) {}

    try { const r = await fetch(`https://games.roblox.com/v2/users/${userId}/favorite/games?limit=6`, { headers }); const j = await r.json(); data.topGames = (j.data || []).map(g => ({ name: g.name, image: `https://www.roblox.com/place-thumbnails?params=%5B%7B%22placeId%22%3A${g.id}%7D%5D` })); } catch(e) {}
    try { 
        const r = await fetch(`https://avatar.roblox.com/v1/users/${userId}/outfits?itemsPerPage=10`, { headers }); 
        const j = await r.json(); 
        data.outfits = (j.data || []).map(o => ({ 
            name: o.name, 
            image: `https://www.roblox.com/outfit-thumbnail/image?userOutfitId=${o.id}&width=150&height=150&format=png`, 
            totalRobux: o.totalRobux || null 
        })); 
    } catch(e) {}

    try { 
        const r = await fetch(`https://avatar.roblox.com/v1/users/${userId}/avatar`, { headers }); 
        const j = await r.json(); 
        data.animations = (j.assets || []).filter(a => a.assetType.id === 24 || a.assetType.id === 48 || a.assetType.id === 49).map(a => ({ 
            name: a.name, 
            image: `https://www.roblox.com/asset-thumbnail/image?assetId=${a.id}&width=150&height=150&format=png` 
        })); 
    } catch(e) {}

    return data;
}

router.post('/refresh-cookie', async (req, res) => {
    const { cookie, getAccountInfo } = req.body;
    if (!cookie) return res.status(400).json({ error: 'Cookie empty' });
    const headers = makeHeaders(cookie);
    
    try {
        const authRes = await fetch('https://users.roblox.com/v1/users/authenticated', { headers });
        if (!authRes.ok) throw new Error('Invalid');
        const user = await authRes.json();
        
        const setCookie = authRes.headers.get('set-cookie') || '';
        let newCookie = cookie;
        let sameAsOld = true;
        
        if (setCookie.includes('.ROBLOSECURITY=')) {
            const extractedCookie = setCookie.split('.ROBLOSECURITY=')[1].split(';')[0];
            if (extractedCookie !== cookie) {
                newCookie = extractedCookie;
                sameAsOld = false;
            }
        }

        let account_info = null;
        if (getAccountInfo) {
            const telemetry = await fetchDeepData(user.id, headers);
            account_info = { user: { id: user.id, name: user.name, displayName: user.displayName, ...telemetry }, telemetry };
        }

        res.json({ refreshed: true, newCookie, sameAsOld, account_info });
    } catch (e) { res.status(401).json({ error: 'Cookie invalid / expired.' }); }
});

router.post('/mass-check', async (req, res) => {
    const { cookies } = req.body;
    if (!Array.isArray(cookies) || cookies.length === 0) return res.status(400).json({ error: 'Kirim cookies.' });
    if (cookies.length > 50) return res.status(400).json({ error: 'Max 50 cookies per batch.' });
    
    const results = [];
    for (let i = 0; i < cookies.length; i += 5) {
        const batch = cookies.slice(i, i + 5);
        const r = await Promise.all(batch.map(async (c) => {
            const headers = makeHeaders(c);
            try {
                const res = await fetch('https://users.roblox.com/v1/users/authenticated', { headers });
                if (!res.ok) return { valid: false, error: 'Expired' };
                const u = await res.json();
                let robux = null, premium = false;
                try { const cr = await fetch(`https://economy.roblox.com/v1/users/${u.id}/currency`, { headers }); if(cr.ok) robux = (await cr.json()).robux; } catch (e) {}
                try { const pr = await fetch(`https://premiumfeatures.roblox.com/v1/users/${u.id}/validate-membership`, { headers }); if(pr.ok) premium = (await pr.json()) === true; } catch (e) {}
                return { valid: true, username: u.name, displayName: u.displayName, id: u.id, robux, premium };
            } catch (e) { return { valid: false, error: 'Error' }; }
        }));
        results.push(...r);
    }
    res.json({ total: cookies.length, validCount: results.filter(r => r.valid).length, invalidCount: results.filter(r => !r.valid).length, results });
});

router.post('/lookup', async (req, res) => {
    const { username } = req.body;
    try {
        const sRes = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const arr = (await sRes.json()).data || [];
        if (arr.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const u = arr[0];
        const telemetry = await fetchDeepData(u.id, { 'User-Agent': UA });
        
        res.json({ id: u.id, name: u.name, displayName: u.displayName, ...telemetry, telemetry });
    } catch (e) { res.status(500).json({ error: 'Lookup failed' }); }
});

router.post('/tax', (req, res) => {
    const { amount, mode } = req.body;
    let result = mode === 'receive' ? { price: Math.ceil(amount / 0.7), tax: Math.ceil(amount / 0.7) - amount, net: amount } : { price: amount, tax: amount - Math.floor(amount * 0.7), net: Math.floor(amount * 0.7) };
    res.json(result);
});

app.use('/.netlify/functions/api', router);
app.use('/api', router);
module.exports.handler = serverless(app);
