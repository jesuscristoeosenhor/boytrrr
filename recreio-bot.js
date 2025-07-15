
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import config from './config.js';

const cfg = config["recreio"];
const bot = new TelegramBot(cfg.telegram_token);

let jwt = null;
let lastCheckins = new Set();

async function authenticate() {
  try {
    const { data } = await axios.post("https://api.totalpass.com.br/partner/auth", {
      partner_api_key: cfg.partner_api_key,
      place_api_key: cfg.place_api_key
    });
    jwt = data.access_token;
    console.log("✅ Autenticado:", "recreio");
  } catch (err) {
    console.error("❌ Falha ao autenticar:", err.message);
  }
}

async function checkForTokens() {
  if (!jwt) return;
  try {
    const headers = { Authorization: `Bearer ${jwt}` };
    const { data } = await axios.get("https://api.totalpass.com.br/partner/tokens", { headers });

    for (const token of data) {
      if (lastCheckins.has(token.id)) continue;
      await axios.post(`https://api.totalpass.com.br/partner/token/${token.id}/use`, {}, { headers });
      lastCheckins.add(token.id);

      const msg = `✅ ${token.member.name}\n\n🕒 ${new Date().toLocaleTimeString()}`;
      for (const chat_id of cfg.chat_ids) {
        bot.sendMessage(chat_id, msg);
      }
    }
  } catch (err) {
    if (err.response?.status === 401) await authenticate();
    else console.error("Erro ao verificar tokens:", err.message);
  }
}

(async () => {
  await authenticate();
  setInterval(checkForTokens, 10000);
})();
