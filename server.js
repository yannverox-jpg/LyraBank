// server.js — Lyra Banque (version stable avec login2 et panel)

import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Middleware global ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Session sécurisée ===
app.use(session({
  secret: process.env.SESSION_SECRET || "lyra_secret_key",
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // passer à true si HTTPS
    maxAge: 60 * 60 * 1000 // 1h
  }
}));

// === Fichiers statiques ===
app.use(express.static(path.join(__dirname, "public")));

// === Page de démarrage ===
app.get("/", async (req, res) => {
  try {
    const loginPath = path.join(__dirname, "public", "login2.html");
    await fs.access(loginPath);
    res.sendFile(loginPath);
  } catch {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

// === Authentification double mot de passe ===
app.post("/auth", (req, res) => {
  const { password1, password2 } = req.body;

  if (password1 === "Lordverox10" && password2 === "Roseeden7") {
    req.session.authenticated = true;
    return res.redirect("/panel");
  }

  res.status(401).send("⛔ Accès refusé : identifiants invalides.");
});

// === Middleware pour protéger les pages internes ===
app.use((req, res, next) => {
  if (!req.session.authenticated && !req.path.includes("/auth")) {
    return res.redirect("/");
  }
  next();
});

// === Tableau de bord (panel) ===
app.get("/panel", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "panel.html"));
});

// === Exemple d’API wallet (mockée, non visible par Singpay) ===
app.get("/api/wallet", (req, res) => {
  res.json({
    balance: "1 000 000 000 000 000 €",
    owner: "Lyra Banque",
    updated: new Date().toISOString()
  });
});

// === Lancement du serveur Render ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Lyra Banque serveur opérationnel sur le port ${PORT}`);
  console.log(`Session sécurisée : ${process.env.SESSION_SECRET ? "✅ OK" : "⚠️ Manquante"}`);
});