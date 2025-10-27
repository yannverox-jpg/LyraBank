/**
 * Lyra Banque - Express server avec wallet interne et PSP Singpay
 * Wallet interne : 1 quatrillon €
 * PSP Singpay : pont pour Airtel Money et Moov Money
 * Ping automatique Render Free Plan
 */

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Variables d'environnement
const GATEWAY_BASE = process.env.GATEWAY_BASE || 'https://gateway.singpay.ga/v1';
const WALLET_ID = process.env.WALLET_ID || '68fbef1277c46023214afd6d';
const MERCHANT_MOOV = process.env.MERCHANT_MOOV || '24162601406';
const ENABLE_WITHDRAWAL = (process.env.ENABLE_WITHDRAWAL || 'true') === 'true';
const APP_NAME = process.env.APP_NAME || 'Lyra Banque';
const RENDER_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;

// ------------------ Wallet interne ------------------
let lyraWalletBalance = 1_000_000_000_000_000; // 1 quatrillon €

function formatBalance(amount){
  return Number(amount);
}

// ------------------ Headers pour Singpay ------------------
function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${WALLET_ID}`,
    'X-Merchant-Id': MERCHANT_MOOV,
    'X-App-Name': APP_NAME
  };
}

// Normaliser numéro
function normalizePhone(phone){
  if(!phone) return null;
  return String(phone).trim().replace(/\s+/g,'');
}

// Fetch wallet info Singpay
async function fetchWalletInfo(){
  const endpoint = `${GATEWAY_BASE}/portefeuille/api/${WALLET_ID}`;
  try {
    const r = await fetch(endpoint, { method:'GET', headers: buildHeaders(), timeout:15000 });
    const j = await r.json().catch(()=>null);
    if(!r.ok) throw new Error('Failed to fetch wallet info: '+(j && j.message ? j.message : r.status));
    return j;
  } catch(err) {
    console.warn('⚠️ Singpay wallet fetch failed:', err.message);
    return null;
  }
}

// ------------------ USSD Helper ------------------
async function launchUSSDWithLogs(code, amount, phone){
  const payload = {
    amount: Number(amount),
    currency: 'XAF',
    phone,
    merchant: MERCHANT_MOOV,
    wallet_id: WALLET_ID,
    reference: `lyra_ussd_${Date.now()}`,
    note: `${APP_NAME} - USSD ${code}`
  };
  
  console.log(`💡 Lancement USSD code ${code} avec payload:`, payload);

  try {
    const endpoint = `${GATEWAY_BASE}/${code}/paiement`;
    const r = await fetch(endpoint, {
      method:'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      timeout:30000
    });
    const j = await r.json().catch(()=>null);
    console.log(`📥 Réponse USSD code ${code}:`, j);
    return {ok: r.ok, status: r.status, body: j};
  } catch(e){
    console.error('❌ USSD request failed:', e.message);
    return {ok:false, status:500, body:{error:e.message}};
  }
}

// ------------------ Routes ------------------

// GET /api/balance
app.get('/api/balance', async (req,res)=>{
  const pspWallet = await fetchWalletInfo();
  res.json({
    wallet: pspWallet || {},
    balance: formatBalance(lyraWalletBalance)
  });
});

// ------------------ Retraits ------------------
async function processWithdrawal(amount, phone, code=null){
  amount = Number(amount);
  if(amount <= 0) throw new Error('Invalid amount');
  if(amount > lyraWalletBalance) throw new Error('Insufficient Lyra balance');

  // 1️⃣ Déduire wallet interne
  lyraWalletBalance -= amount;
  console.log(`💰 Lyra wallet debited: ${amount}, new balance: ${lyraWalletBalance}`);

  // 2️⃣ Envoyer au PSP
  let result;
  if(code) {
    result = await launchUSSDWithLogs(code, amount, phone);
  } else {
    const payload = {
      amount,
      currency:'XAF',
      wallet_id: WALLET_ID,
      merchant_reference: `lyra_${Date.now()}`,
      destination:{phone},
      note: `${APP_NAME} - retrait`
    };
    console.log('💡 Envoi retrait Singpay:', payload);
    try {
      const r = await fetch(`${GATEWAY_BASE}/payouts`, {
        method:'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
        timeout:30000
      });
      const j = await r.json().catch(()=>null);
      result = {ok: r.ok && j?.status==='success', status: r.status, body:j};
    } catch(e){
      result = {ok:false, status:500, body:{error:e.message}};
    }
  }

  // 3️⃣ Si PSP échoue, re-créditer le wallet interne
  if(!result.ok){
    lyraWalletBalance += amount;
    console.warn(`⚠️ PSP failed, amount re-credited: ${amount}, balance: ${lyraWalletBalance}`);
  }

  return result;
}

// POST /api/retrait/74 (Airtel)
app.post('/api/retrait/74', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});
    const result = await processWithdrawal(amount, p, '74');
    const walletInfo = await fetchWalletInfo();
    res.json({message: result.ok ? 'ussd launched' : 'failed', psp: result.body, balance: lyraWalletBalance, wallet: walletInfo});
  }catch(err){
    console.error('retrait 74 error', err);
    res.status(500).json({message:'internal error', error:err.message});
  }
});

// POST /api/retrait/62 (Moov)
app.post('/api/retrait/62', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});
    const result = await processWithdrawal(amount, p, '62');
    const walletInfo = await fetchWalletInfo();
    res.json({message: result.ok ? 'ussd launched' : 'failed', psp: result.body, balance: lyraWalletBalance, wallet: walletInfo});
  }catch(err){
    console.error('retrait 62 error', err);
    res.status(500).json({message:'internal error', error:err.message});
  }
});

// POST /api/retrait/singpay (generic)
app.post('/api/retrait/singpay', async (req,res)=>{
  if(!ENABLE_WITHDRAWAL) return res.status(403).json({message:'withdrawals disabled'});
  try{
    const { amount, phone } = req.body;
    const p = normalizePhone(phone);
    if(!amount || !p) return res.status(400).json({message:'amount and phone required'});
    const result = await processWithdrawal(amount, p, null);
    const walletInfo = await fetchWalletInfo();
    res.json({message: result.ok ? 'payout initiated' : 'failed', psp: result.body, balance: lyraWalletBalance, wallet: walletInfo});
  }catch(err){
    console.error('singpay payout error', err);
    res.status(500).json({message:'internal error', error:err.message});
  }
});

// Status route
app.get('/api/status',(req,res)=>{
  res.json({ app: APP_NAME, withdrawals_enabled: ENABLE_WITHDRAWAL, gateway: GATEWAY_BASE, lyra_wallet: lyraWalletBalance });
});

// Test route
app.get('/api/test', (req,res)=>{
  res.status(200).json({status:'success', message:'✅ Lyra Banque API is connected successfully to Render', timestamp: new Date().toISOString()});
});

// ------------------ Ping automatique Render ------------------
if(RENDER_HOSTNAME){
  setInterval(() => {
    fetch(`https://${RENDER_HOSTNAME}/api/test`).catch(()=>{});
    console.log(`⏱ Ping automatique envoyé à ${RENDER_HOSTNAME}`);
  }, 13*60*1000); // toutes les 13 minutes
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Lyra Banque server running on port ${PORT}`));