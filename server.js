/**
 * Lyra Banque - Express server with balance refresh after each payout
 * Endpoints:
 *  - GET  /api/balance                 -> fetches wallet info from Singpay
 *  - POST /api/retrait/74              -> launch Airtel USSD (code 74)
 *  - POST /api/retrait/62              -> launch Moov USSD (code 62)
 *  - POST /api/retrait/singpay         -> generic payout (optional)
 *
 * Env vars (.env):
 *  GATEWAY_BASE, WALLET_ID, MERCHANT_MOOV, APP_NAME, ENABLE_WITHDRAWAL, PORT
 */
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const GATEWAY_BASE = process.env.GATEWAY_BASE || 'https://gateway.singpay.ga/v1';
const WALLET_ID = process.env.WALLET_ID || '68fbef1277c46023214afd6d';
const MERCHANT_MOOV = process.env.MERCHANT_MOOV || '24162601406';
const ENABLE_WITHDRAWAL = (process.env.ENABLE_WITHDRAWAL || 'true') === 'true';
const APP_NAME = process.env.APP_NAME || 'Lyra Banque';

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${WALLET_ID}`,
    'X-Merchant-Id': MERCHANT_MOOV,
    'X-App-Name': APP_NAME
  };
}

function normalizePhone(phone){
  if(!phone) return null;
  let p = String(phone).trim().replace(/\s+/g,'');
  return p;
}

async function fetchWalletInfo(){
  const endpoint = `${GATEWAY_BASE}/portefeuille/api/${WALLET_ID}`;
  const r = await fetch(endpoint,{ method:'GET', headers: buildHeaders() , timeout: 15000 });
  const j = await r.json().catch(()=>null);
  if(!r.ok) throw new Error('Failed to fetch wallet info: '+ (j && j.message ? j.message : r.status));
  return j;
}

// GET /api/balance
app.get('/api/balance', async (req,res)=>{
  try{
    const info = await fetchWalletInfo();
    // Try to extract balance field (depends on Singpay response structure)
    // We'll attempt common keys: balance, solde, montant, availableBalance
    let balance = null;
    if(info){
      balance = info.balance || info.solde || info.montant || info.availableBalance || null;
    }
    res.json({wallet: info, balance});
  }catch(err){
    console.error('Balance error', err);
    res.status(502).json({message:'failed to fetch balance', error: err.message});
  }
});

// Generic helper to launch USSD payout
async function launchUSSD(code, amount, phone){
  const endpoint = `${GATEWAY_BASE}/${code}/paiement`;
  const payload = {
    amount: Number(amount),
    currency: 'XAF',
    phone,
    merchant: MERCHANT_MOOV,
    wallet_id: WALLET_ID,
    reference: `lyra_ussd_${Date.now()}`,
    note: `${APP_NAME} - USSD ${code}`
  };
  const r = await fetch(endpoint, {
    method:'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    timeout: 30000
  });
  const j = await r.json().catch(()=>null);
  return {ok: r.ok, status: r.status, body: j};
}

// POST /api/retrait/74  (Airtel)
app.post('/api/retrait/74', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});

    const result = await launchUSSD('74', amount, p);
    if(!result.ok){
      return res.status(result.status || 500).json({message:'psp ussd error', psp: result.body});
    }

    // On success, refresh balance and return it
    try {
      const walletInfo = await fetchWalletInfo();
      let balance = walletInfo.balance || walletInfo.solde || walletInfo.montant || walletInfo.availableBalance || null;
      return res.json({message:'ussd launched', psp: result.body, balance, wallet: walletInfo});
    } catch(e){
      return res.json({message:'ussd launched, but failed to refresh balance', psp: result.body, error: e.message});
    }
  }catch(err){
    console.error('retrait 74 error', err);
    res.status(500).json({message:'internal error', error: err.message});
  }
});

// POST /api/retrait/62  (Moov)
app.post('/api/retrait/62', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});

    const result = await launchUSSD('62', amount, p);
    if(!result.ok){
      return res.status(result.status || 500).json({message:'psp ussd error', psp: result.body});
    }

    // On success, refresh balance and return it
    try {
      const walletInfo = await fetchWalletInfo();
      let balance = walletInfo.balance || walletInfo.solde || walletInfo.montant || walletInfo.availableBalance || null;
      return res.json({message:'ussd launched', psp: result.body, balance, wallet: walletInfo});
    } catch(e){
      return res.json({message:'ussd launched, but failed to refresh balance', psp: result.body, error: e.message});
    }
  }catch(err){
    console.error('retrait 62 error', err);
    res.status(500).json({message:'internal error', error: err.message});
  }
});

// Optional generic payout route
app.post('/api/retrait/singpay', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});

    const endpoint = `${GATEWAY_BASE}/payouts`;
    const payload = {
      amount: Number(amount),
      currency: 'XAF',
      wallet_id: WALLET_ID,
      merchant_reference: `lyra_${Date.now()}`,
      destination: { phone: p },
      note: `${APP_NAME} - retrait`
    };
    const r = await fetch(endpoint,{method:'POST',headers:buildHeaders(),body:JSON.stringify(payload),timeout:30000});
    const j = await r.json().catch(()=>null);
    if(!r.ok) return res.status(r.status||500).json({message:'psp payout error', psp:j});
    try {
      const walletInfo = await fetchWalletInfo();
      let balance = walletInfo.balance || walletInfo.solde || walletInfo.montant || walletInfo.availableBalance || null;
      return res.json({message:'payout initiated', psp:j, balance, wallet: walletInfo});
    } catch(e){
      return res.json({message:'payout initiated but failed to refresh balance', psp:j, error: e.message});
    }
  }catch(err){
    console.error('singpay payout error', err);
    res.status(500).json({message:'internal error', error: err.message});
  }
});

app.get('/api/status',(req,res)=>{
  res.json({ app: APP_NAME, withdrawals_enabled: ENABLE_WITHDRAWAL, gateway: GATEWAY_BASE });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Lyra Banque server running on port ${PORT}`));
