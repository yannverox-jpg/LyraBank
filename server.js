require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// === CONFIG ===
const PORT = process.env.PORT || 3000;
const WALLET_ID = process.env.WALLET_ID || '74';
const SERVER_API_URL = process.env.SERVER_API_URL;
const PASSWORD1 = process.env.PASSWORD1;
const PASSWORD2 = process.env.PASSWORD2;
const SESSION_SECRET = process.env.SESSION_SECRET;
const walletInternal = { balance: 1_000_000_000_000_000 }; // 1 quadrillion €

// === SESSION ===
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24*60*60*1000 }
}));

// === RATE LIMIT ===
const limiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: 'Trop de tentatives' });

// === Middleware auth ===
function requireAuth(req,res,next){
  if(req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

// === LOGIN STEP 1 ===
app.get('/login', (req,res)=>{
  res.sendFile(path.join(__dirname,'public/login.html'));
});

app.post('/login', limiter, (req,res)=>{
  const { password } = req.body;
  if(password === PASSWORD1){
    req.session.step1 = true;
    return res.redirect('/login2');
  }
  res.redirect('/login?error=1');
});

// === LOGIN STEP 2 ===
app.get('/login2', (req,res)=>{
  if(!req.session.step1) return res.redirect('/login');
  res.sendFile(path.join(__dirname,'public/login2.html'));
});

app.post('/login2', limiter, (req,res)=>{
  const { password } = req.body;
  if(password === PASSWORD2 && req.session.step1){
    req.session.authenticated = true;
    return res.redirect('/panel');
  }
  res.redirect('/login2?error=1');
});

// === LOGOUT ===
app.post('/logout', requireAuth, (req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// === PANEL ===
app.get('/panel', requireAuth, (req,res)=>{
  res.sendFile(path.join(__dirname,'public/panel.html'));
});

// === API ===

// GET BALANCE
app.get('/api/balance', requireAuth, (req,res)=>{
  res.json({ balance: walletInternal.balance, currency:'EUR' });
});

// POST RETRAIT
app.post('/api/retrait', requireAuth, async (req,res)=>{
  const { amount, receiver, operator } = req.body;
  if(!amount || !receiver || !operator) return res.status(400).json({status:'error',message:'Paramètres manquants'});
  if(amount > walletInternal.balance) return res.status(400).json({status:'error',message:'Solde insuffisant'});

  walletInternal.balance -= Number(amount); // débit immédiat

  try {
    // OAuth 2.0 token
    const tokenResp = await axios.post(`${SERVER_API_URL}/oauth/token`, {
      grant_type:'client_credentials',
      client_id: process.env.SINGPAY_CLIENT_ID,
      client_secret: process.env.SINGPAY_CLIENT_SECRET,
      scope:'wallet:write wallet:read'
    });
    const token = tokenResp.data.access_token;

    // transfert vers Airtel/Moov
    const retraitResp = await axios.post(`${SERVER_API_URL}/api/retrait/${WALLET_ID}`, {
      amount, receiver, operator, currency:'EUR'
    }, { headers: { Authorization:`Bearer ${token}` }});

    res.json({ status:'success', tx: retraitResp.data.transaction_id });

  } catch(e){
    walletInternal.balance += Number(amount); // rollback
    console.error(e);
    res.status(500).json({status:'error',message:'Erreur lors du transfert'});
  }
});

// === STATIC ===
app.use(express.static(path.join(__dirname,'public')));
app.get('/', (req,res)=>res.redirect('/login'));

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));