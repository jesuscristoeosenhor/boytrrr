#!/usr/bin/env node

/**
 * CT LK Futevôlei WhatsApp Bot
 * Complete bot with all requested features
 */

import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  delay
} from '@whiskeysockets/baileys';
import TelegramBot from 'node-telegram-bot-api';
import NodeCache from 'node-cache';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import schedule from 'node-schedule';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import config from './config.js';

// Global variables
let sock;
let telegramBots = {};
let cache;
let logger;
let metrics = {
  messagesReceived: 0,
  experimentalBookings: 0,
  menusShown: 0,
  humanTakeovers: 0
};

// Data storage
let vagasRecreiro = { dates: {} };
let vagasBangu = { dates: {} };
let pausedChats = new Map(); // chatId -> { pausedAt, reason }
let rateLimitMap = new Map(); // userId -> { count, resetTime }
let userSessions = new Map(); // chatId -> { state, data }

// Initialize logging system
function initLogger() {
  logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'ct-lk-bot' },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }),
      new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d'
      })
    ]
  });

  logger.info('Logger initialized');
}

// Initialize cache system
function initCache() {
  cache = new NodeCache({
    stdTTL: config.cache.stdTTL,
    checkperiod: config.cache.checkperiod
  });
  
  // Pre-populate cache with menu data
  cache.set('main_menu', getMainMenuText());
  cache.set('recreio_info', getRecreroInfo());
  cache.set('bangu_info', getBanguInfo());
  cache.set('schedules', getSchedulesText());
  cache.set('prices', getPricesText());
  
  logger.info('Cache system initialized');
}

// Initialize Telegram bots
function initTelegramBots() {
  try {
    telegramBots.recreio = new TelegramBot(config.telegram.recreio.token, { polling: true });
    telegramBots.bangu = new TelegramBot(config.telegram.bangu.token, { polling: true });
    
    // Setup Telegram command handlers
    setupTelegramCommands();
    
    logger.info('Telegram bots initialized');
  } catch (error) {
    logger.warn('Failed to initialize Telegram bots (network unavailable):', error.message);
    // Continue without Telegram - WhatsApp bot will still work
    telegramBots.recreio = null;
    telegramBots.bangu = null;
  }
}

// Setup Telegram command handlers
function setupTelegramCommands() {
  if (!telegramBots.recreio || !telegramBots.bangu) {
    logger.warn('Telegram bots not available, skipping command setup');
    return;
  }
  
  const recreioBot = telegramBots.recreio;
  const banguBot = telegramBots.bangu;

  // Commands for both bots
  [recreioBot, banguBot].forEach((bot, index) => {
    const unit = index === 0 ? 'recreio' : 'bangu';
    
    bot.onText(/\/vagas(?:\s+(\d{4}-\d{2}-\d{2}))?/, (msg, match) => {
      const chatId = msg.chat.id;
      const date = match[1] || getTodayString();
      const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
      
      let response = `📅 *Vagas ${unit.toUpperCase()} - ${date}*\n\n`;
      
      if (vagas.dates[date]) {
        vagas.dates[date].forEach((booking, i) => {
          response += `${i + 1}. ${booking.name} - ${booking.time}\n`;
          if (booking.companion) response += `   + Acompanhante: ${booking.companion}\n`;
        });
      } else {
        response += 'Nenhuma reserva para esta data.';
      }
      
      bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/cancelar\s+(\d+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const bookingId = parseInt(match[1]) - 1;
      const date = getTodayString();
      const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
      
      if (vagas.dates[date] && vagas.dates[date][bookingId]) {
        const canceled = vagas.dates[date].splice(bookingId, 1)[0];
        saveBookingData();
        bot.sendMessage(chatId, `✅ Reserva cancelada: ${canceled.name} - ${canceled.time}`);
      } else {
        bot.sendMessage(chatId, '❌ Reserva não encontrada');
      }
    });

    bot.onText(/\/cancelar_nome\s+(.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const name = match[1];
      const date = getTodayString();
      const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
      
      if (vagas.dates[date]) {
        const index = vagas.dates[date].findIndex(booking => 
          booking.name.toLowerCase().includes(name.toLowerCase())
        );
        
        if (index !== -1) {
          const canceled = vagas.dates[date].splice(index, 1)[0];
          saveBookingData();
          bot.sendMessage(chatId, `✅ Reserva cancelada: ${canceled.name} - ${canceled.time}`);
        } else {
          bot.sendMessage(chatId, '❌ Reserva não encontrada para este nome');
        }
      } else {
        bot.sendMessage(chatId, '❌ Nenhuma reserva encontrada para hoje');
      }
    });

    bot.onText(/\/reset\s+(\d{4}-\d{2}-\d{2})/, (msg, match) => {
      const chatId = msg.chat.id;
      const date = match[1];
      const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
      
      delete vagas.dates[date];
      saveBookingData();
      bot.sendMessage(chatId, `✅ Reservas resetadas para ${date}`);
    });

    bot.onText(/\/relatorio/, (msg) => {
      const chatId = msg.chat.id;
      const report = generateReport();
      bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
    });
  });
}

// Rate limiting check
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + config.rateLimit.windowMs });
    return true;
  }
  
  if (userLimit.count >= config.rateLimit.maxMessages) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

// Auto-pause system
function checkAutoPause(message) {
  const chatId = message.key.remoteJid;
  
  // Check if message is from human attendant (not from me)
  if (!message.key.fromMe && pausedChats.has(chatId)) {
    // Already paused, do nothing
    return true;
  }
  
  if (!message.key.fromMe) {
    // Human responded, pause bot for this chat
    pausedChats.set(chatId, {
      pausedAt: Date.now(),
      reason: 'human_takeover'
    });
    
    metrics.humanTakeovers++;
    logger.info(`Bot paused for chat ${chatId} - human takeover detected`);
    
    // Schedule auto-reactivation
    setTimeout(() => {
      pausedChats.delete(chatId);
      logger.info(`Bot auto-reactivated for chat ${chatId}`);
    }, config.autoPause.reactivationTimeMs);
    
    return true;
  }
  
  return false;
}

// Check if chat is paused
function isChatPaused(chatId) {
  return pausedChats.has(chatId);
}

// Reactivate chat manually
function reactivateChat(chatId) {
  if (pausedChats.has(chatId)) {
    pausedChats.delete(chatId);
    logger.info(`Bot manually reactivated for chat ${chatId}`);
    return true;
  }
  return false;
}

// Menu and response text functions
function getMainMenuText() {
  return `🏐 *CT LK FUTEVÔLEI* 🏐

Escolha uma opção:

1️⃣ Informações das Unidades
2️⃣ Horários das Aulas  
3️⃣ Valores e Planos
4️⃣ Agendar Aula Experimental
5️⃣ Plataformas de Check-in
6️⃣ Localização das Quadras
7️⃣ Níveis das Turmas
8️⃣ Perguntas Frequentes
9️⃣ Falar com Atendente

Digite o *número* da opção desejada ou *MENU* para voltar aqui.`;
}

function getRecreroInfo() {
  return `🏢 *UNIDADE RECREIO*

📍 *Endereço:*
Av. das Américas, 15500 - Recreio dos Bandeirantes

⏰ *Horários de Funcionamento:*
Segunda a Sexta: 6h às 22h
Sábado: 8h às 18h
Domingo: 8h às 16h

📞 *Contato:*
(21) 3325-4567

🏐 *Modalidades:*
• Futevôlei
• Beach Tennis
• Vôlei de Praia

✨ *Diferenciais:*
• 4 quadras de areia
• Vestiário completo
• Lanchonete
• Estacionamento gratuito`;
}

function getBanguInfo() {
  return `🏢 *UNIDADE BANGU*

📍 *Endereço:*
Rua Coronel Tamarindo, 950 - Bangu

⏰ *Horários de Funcionamento:*
Segunda a Sexta: 6h às 22h
Sábado: 8h às 18h
Domingo: 8h às 16h

📞 *Contato:*
(21) 2401-8765

🏐 *Modalidades:*
• Futevôlei
• Beach Tennis
• Vôlei de Praia

✨ *Diferenciais:*
• 3 quadras de areia
• Vestiário completo
• Lanchonete
• Fácil acesso de transporte público`;
}

function getSchedulesText() {
  return `⏰ *HORÁRIOS DAS AULAS*

🏢 *RECREIO:*
🌅 Manhã: 7h, 8h, 9h, 10h
🌞 Tarde: 14h, 15h, 16h, 17h, 18h
🌙 Noite: 19h, 20h, 21h

🏢 *BANGU:*
🌅 Manhã: 7h, 8h, 9h, 10h
🌞 Tarde: 14h, 15h, 16h, 17h, 18h
🌙 Noite: 19h, 20h, 21h

📅 *Aulas Experimentais:*
• Recreio: 17:30, 18:30, 19:30
• Bangu: Todos os horários disponíveis

⚠️ *Observações:*
• Chegue 15 minutos antes
• Traga água e toalha
• Use roupas esportivas`;
}

function getPricesText() {
  return `💰 *VALORES E PLANOS*

🎯 *AULA AVULSA:*
• R$ 45,00 (1 aula)

📅 *PLANOS MENSAIS:*
• 4 aulas: R$ 160,00
• 8 aulas: R$ 300,00  
• 12 aulas: R$ 420,00
• Ilimitado: R$ 580,00

🏆 *PLANOS TRIMESTRAIS:*
• 8 aulas/mês: R$ 810,00 (10% desc.)
• 12 aulas/mês: R$ 1.134,00 (10% desc.)
• Ilimitado: R$ 1.566,00 (10% desc.)

🎁 *PROMOÇÕES:*
• Aula experimental: GRÁTIS
• Matricule um amigo: 20% desc. no primeiro mês
• Estudante: 15% desc. (com comprovante)

💳 *Formas de Pagamento:*
• Dinheiro, PIX, Cartão
• Débito automático disponível`;
}

function getExperimentalClassText() {
  return `🎯 *AULA EXPERIMENTAL GRATUITA*

Venha conhecer o futevôlei! Nossa aula experimental é 100% gratuita.

🏢 *Escolha a unidade:*
A - Recreio dos Bandeirantes
B - Bangu

⏰ *Horários disponíveis:*

*RECREIO:* 17:30, 18:30, 19:30
(Máximo 2 pessoas por horário)

*BANGU:* Todos os horários
(Conforme disponibilidade)

Digite *A* para Recreio ou *B* para Bangu.`;
}

// Booking functions
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function saveBookingData() {
  try {
    fs.writeJsonSync('/home/runner/work/boytrrr/boytrrr/vagas_recreio.json', vagasRecreiro);
    fs.writeJsonSync('/home/runner/work/boytrrr/boytrrr/vagas_bangu.json', vagasBangu);
    logger.info('Booking data saved successfully');
  } catch (error) {
    logger.error('Error saving booking data:', error);
  }
}

function loadBookingData() {
  try {
    if (fs.existsSync('/home/runner/work/boytrrr/boytrrr/vagas_recreio.json')) {
      vagasRecreiro = fs.readJsonSync('/home/runner/work/boytrrr/boytrrr/vagas_recreio.json');
    }
    if (fs.existsSync('/home/runner/work/boytrrr/boytrrr/vagas_bangu.json')) {
      vagasBangu = fs.readJsonSync('/home/runner/work/boytrrr/boytrrr/vagas_bangu.json');
    }
    logger.info('Booking data loaded successfully');
  } catch (error) {
    logger.error('Error loading booking data:', error);
  }
}

function checkVagasLimit(unit, date, time) {
  const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
  
  if (unit === 'recreio') {
    if (!vagas.dates[date]) vagas.dates[date] = [];
    const bookingsAtTime = vagas.dates[date].filter(booking => booking.time === time);
    return bookingsAtTime.length < config.limits.recreio.maxPerSlot;
  }
  
  return true; // Bangu has no limit
}

function addBooking(unit, date, time, name, phone, companion = null) {
  const vagas = unit === 'recreio' ? vagasRecreiro : vagasBangu;
  
  if (!vagas.dates[date]) vagas.dates[date] = [];
  
  const booking = {
    id: Date.now(),
    name,
    phone,
    time,
    companion,
    createdAt: new Date().toISOString()
  };
  
  vagas.dates[date].push(booking);
  saveBookingData();
  
  // Send Telegram notification
  const bot = unit === 'recreio' ? telegramBots.recreio : telegramBots.bangu;
  const chatId = config.telegram[unit].chatId;
  
  if (bot) { // Only send if Telegram bot is available
    let message = `🎯 *Nova Reserva Experimental - ${unit.toUpperCase()}*\n\n`;
    message += `👤 *Nome:* ${name}\n`;
    message += `📱 *Telefone:* ${phone}\n`;
    message += `📅 *Data:* ${date}\n`;
    message += `⏰ *Horário:* ${time}\n`;
    if (companion) message += `👥 *Acompanhante:* ${companion}\n`;
    message += `\n🔢 *ID:* ${booking.id}`;
    
    try {
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.warn('Failed to send Telegram notification:', error.message);
    }
  }
  
  metrics.experimentalBookings++;
  logger.info(`New booking added: ${unit} - ${name} - ${date} ${time}`);
  
  return booking;
}

function generateReport() {
  const today = getTodayString();
  const recreioToday = vagasRecreiro.dates[today] || [];
  const banguToday = vagasBangu.dates[today] || [];
  
  let report = `📊 *RELATÓRIO DIÁRIO*\n\n`;
  report += `📅 *Data:* ${today}\n\n`;
  report += `📈 *Métricas Gerais:*\n`;
  report += `• Mensagens recebidas: ${metrics.messagesReceived}\n`;
  report += `• Agendamentos experimentais: ${metrics.experimentalBookings}\n`;
  report += `• Menus exibidos: ${metrics.menusShown}\n`;
  report += `• Interferências humanas: ${metrics.humanTakeovers}\n\n`;
  report += `🏢 *Reservas Hoje:*\n`;
  report += `• Recreio: ${recreioToday.length}\n`;
  report += `• Bangu: ${banguToday.length}\n\n`;
  report += `⏸️ *Chats pausados:* ${pausedChats.size}`;
  
  return report;
}

// Message handling functions
async function handleMessage(message) {
  const chatId = message.key.remoteJid;
  const userId = message.key.participant || chatId;
  const messageText = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || '';
  
  // Skip if no text content
  if (!messageText) return;
  
  metrics.messagesReceived++;
  
  // Check auto-pause system
  if (checkAutoPause(message)) return;
  
  // Check if chat is paused
  if (isChatPaused(chatId)) {
    // Check for reactivation commands
    if (messageText.toUpperCase() === 'MENU' || messageText === '/reativar') {
      reactivateChat(chatId);
      await sendMessage(chatId, getMainMenuText());
      return;
    }
    return; // Don't respond if paused
  }
  
  // Check rate limiting
  if (!checkRateLimit(userId)) {
    await sendMessage(chatId, '⚠️ Muitas mensagens! Aguarde um momento antes de enviar outra.');
    return;
  }
  
  // Handle user input
  await processUserInput(chatId, messageText.trim(), userId);
}

async function processUserInput(chatId, input, userId) {
  const upperInput = input.toUpperCase();
  const session = userSessions.get(chatId) || { state: 'menu', data: {} };
  
  // Handle session-based flows
  if (session.state !== 'menu') {
    await handleSessionFlow(chatId, input, session);
    return;
  }
  
  // Main menu commands
  if (upperInput === 'MENU' || upperInput === 'INICIO' || upperInput === 'OLÁ' || upperInput === 'OI') {
    userSessions.delete(chatId); // Reset session
    metrics.menusShown++;
    await sendMessage(chatId, cache.get('main_menu') || getMainMenuText());
    return;
  }
  
  // Menu options
  switch (input) {
    case '1':
      await sendMessage(chatId, `🏢 *NOSSAS UNIDADES*\n\nA - Recreio dos Bandeirantes\nB - Bangu\n\nDigite *A* ou *B* para mais informações.`);
      break;
      
    case 'A':
      await sendMessage(chatId, cache.get('recreio_info') || getRecreroInfo());
      break;
      
    case 'B':
      await sendMessage(chatId, cache.get('bangu_info') || getBanguInfo());
      break;
      
    case '2':
      await sendMessage(chatId, cache.get('schedules') || getSchedulesText());
      break;
      
    case '3':
      await sendMessage(chatId, cache.get('prices') || getPricesText());
      break;
      
    case '4':
      userSessions.set(chatId, { state: 'booking_unit', data: {} });
      await sendMessage(chatId, getExperimentalClassText());
      break;
      
    case '5':
      await sendMessage(chatId, `💳 *PLATAFORMAS DE CHECK-IN*\n\n🔸 *Gympass*\n🔸 *TotalPass*\n🔸 *Wellhub*\n🔸 *Vivo Metrópoles*\n\nApresente seu cartão na recepção para realizar o check-in.`);
      break;
      
    case '6':
      await sendMessage(chatId, `📍 *LOCALIZAÇÃO DAS QUADRAS*\n\n🏢 *RECREIO:*\nhttps://maps.google.com/?q=-23.0186,-43.4681\nAv. das Américas, 15500\n\n🏢 *BANGU:*\nhttps://maps.google.com/?q=-22.8808,-43.4659\nRua Coronel Tamarindo, 950`);
      break;
      
    case '7':
      await sendMessage(chatId, `🏆 *NÍVEIS DAS TURMAS*\n\n🥉 *INICIANTE:*\n• Primeiro contato com o esporte\n• Fundamentos básicos\n• Foco na diversão\n\n🥈 *INTERMEDIÁRIO:*\n• Domínio dos fundamentos\n• Táticas básicas\n• Jogos recreativos\n\n🥇 *AVANÇADO:*\n• Alto nível técnico\n• Estratégias complexas\n• Competições\n\n🏅 *PROFISSIONAL:*\n• Atletas de alto rendimento\n• Preparação para torneios\n• Treinos específicos`);
      break;
      
    case '8':
      await sendMessage(chatId, `❓ *PERGUNTAS FREQUENTES*\n\n*Preciso levar algum equipamento?*\nApenas roupa esportiva e água. Fornecemos a bola.\n\n*Posso fazer aula experimental?*\nSim! É gratuita. Digite *4* no menu.\n\n*Qual a idade mínima?*\n12 anos, com autorização dos pais.\n\n*Tem estacionamento?*\nSim, gratuito nas duas unidades.\n\n*Posso cancelar minha aula?*\nSim, até 2h antes do horário.\n\n*Como funciona o plano ilimitado?*\nVocê pode frequentar quantas aulas quiser no mês.`);
      break;
      
    case '9':
      await sendMessage(chatId, `👨‍💼 *ATENDIMENTO HUMANO*\n\nVocê será atendido por nossa equipe em breve.\n\nEnquanto isso, pode continuar navegando pelo menu digitando *MENU*.\n\n📞 *Ou ligue diretamente:*\n• Recreio: (21) 3325-4567\n• Bangu: (21) 2401-8765`);
      
      // Pause bot for this chat (human takeover requested)
      pausedChats.set(chatId, {
        pausedAt: Date.now(),
        reason: 'user_requested'
      });
      break;
      
    default:
      await sendMessage(chatId, `Não entendi sua mensagem. 😅\n\nDigite *MENU* para ver as opções disponíveis ou um número de 1 a 9.`);
      break;
  }
}

async function handleSessionFlow(chatId, input, session) {
  const upperInput = input.toUpperCase();
  
  // Allow menu return at any time
  if (upperInput === 'MENU') {
    userSessions.delete(chatId);
    await sendMessage(chatId, cache.get('main_menu') || getMainMenuText());
    return;
  }
  
  switch (session.state) {
    case 'booking_unit':
      if (upperInput === 'A') {
        session.data.unit = 'recreio';
        session.state = 'booking_date';
        userSessions.set(chatId, session);
        await sendMessage(chatId, `📅 *ESCOLHA A DATA*\n\nPara qual data deseja agendar?\n\nDigite no formato DD/MM/AAAA\nExemplo: 25/12/2024\n\nOu digite *HOJE* para hoje.`);
      } else if (upperInput === 'B') {
        session.data.unit = 'bangu';
        session.state = 'booking_date';
        userSessions.set(chatId, session);
        await sendMessage(chatId, `📅 *ESCOLHA A DATA*\n\nPara qual data deseja agendar?\n\nDigite no formato DD/MM/AAAA\nExemplo: 25/12/2024\n\nOu digite *HOJE* para hoje.`);
      } else {
        await sendMessage(chatId, `Por favor, digite *A* para Recreio ou *B* para Bangu.`);
      }
      break;
      
    case 'booking_date':
      let date;
      if (upperInput === 'HOJE') {
        date = getTodayString();
      } else {
        date = parseDate(input);
        if (!date) {
          await sendMessage(chatId, `Data inválida. Use DD/MM/AAAA ou digite *HOJE*.`);
          return;
        }
      }
      
      session.data.date = date;
      session.state = 'booking_time';
      userSessions.set(chatId, session);
      
      if (session.data.unit === 'recreio') {
        const availableTimes = getAvailableRecreioTimes(date);
        if (availableTimes.length === 0) {
          await sendMessage(chatId, `❌ Não há horários disponíveis para ${formatDate(date)} na unidade Recreio.\n\nDigite *MENU* para voltar ao início.`);
          userSessions.delete(chatId);
          return;
        }
        await sendMessage(chatId, `⏰ *HORÁRIOS DISPONÍVEIS - RECREIO*\n\n${availableTimes.map((time, i) => `${i + 1}. ${time}`).join('\n')}\n\nDigite o *número* do horário desejado.`);
      } else {
        await sendMessage(chatId, `⏰ *ESCOLHA O HORÁRIO - BANGU*\n\nDigite o horário desejado no formato HH:MM\nExemplo: 18:30\n\nHorários disponíveis:\n7:00, 8:00, 9:00, 10:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00, 20:00, 21:00`);
      }
      break;
      
    case 'booking_time':
      let time;
      if (session.data.unit === 'recreio') {
        const availableTimes = getAvailableRecreioTimes(session.data.date);
        const timeIndex = parseInt(input) - 1;
        if (timeIndex >= 0 && timeIndex < availableTimes.length) {
          time = availableTimes[timeIndex];
        } else {
          await sendMessage(chatId, `Opção inválida. Digite um número de 1 a ${availableTimes.length}.`);
          return;
        }
      } else {
        time = validateTime(input);
        if (!time) {
          await sendMessage(chatId, `Horário inválido. Use o formato HH:MM.`);
          return;
        }
      }
      
      session.data.time = time;
      session.state = 'booking_name';
      userSessions.set(chatId, session);
      await sendMessage(chatId, `👤 *SEU NOME COMPLETO*\n\nPor favor, digite seu nome completo:`);
      break;
      
    case 'booking_name':
      if (input.length < 3) {
        await sendMessage(chatId, `Nome muito curto. Digite seu nome completo.`);
        return;
      }
      
      session.data.name = input;
      session.state = 'booking_phone';
      userSessions.set(chatId, session);
      await sendMessage(chatId, `📱 *SEU TELEFONE*\n\nDigite seu telefone com DDD:\nExemplo: (21) 99999-9999`);
      break;
      
    case 'booking_phone':
      const phone = validatePhone(input);
      if (!phone) {
        await sendMessage(chatId, `Telefone inválido. Use o formato (XX) XXXXX-XXXX.`);
        return;
      }
      
      session.data.phone = phone;
      session.state = 'booking_companion';
      userSessions.set(chatId, session);
      await sendMessage(chatId, `👥 *ACOMPANHANTE*\n\nVai levar acompanhante?\n\nDigite *SIM* ou *NÃO*:`);
      break;
      
    case 'booking_companion':
      if (upperInput === 'SIM') {
        session.state = 'booking_companion_name';
        userSessions.set(chatId, session);
        await sendMessage(chatId, `👤 *NOME DO ACOMPANHANTE*\n\nDigite o nome completo do acompanhante:`);
      } else if (upperInput === 'NÃO' || upperInput === 'NAO') {
        await completeBooking(chatId, session);
      } else {
        await sendMessage(chatId, `Digite *SIM* ou *NÃO*.`);
      }
      break;
      
    case 'booking_companion_name':
      if (input.length < 3) {
        await sendMessage(chatId, `Nome muito curto. Digite o nome completo do acompanhante.`);
        return;
      }
      
      session.data.companion = input;
      await completeBooking(chatId, session);
      break;
  }
}

async function completeBooking(chatId, session) {
  const { unit, date, time, name, phone, companion } = session.data;
  
  // Check availability one more time
  if (!checkVagasLimit(unit, date, time)) {
    await sendMessage(chatId, `❌ Este horário já está lotado. Tente outro horário.\n\nDigite *MENU* para voltar ao início.`);
    userSessions.delete(chatId);
    return;
  }
  
  // Add booking
  const booking = addBooking(unit, date, time, name, phone, companion);
  
  // Confirmation message
  let confirmation = `✅ *AGENDAMENTO CONFIRMADO!*\n\n`;
  confirmation += `🏢 *Unidade:* ${unit.charAt(0).toUpperCase() + unit.slice(1)}\n`;
  confirmation += `📅 *Data:* ${formatDate(date)}\n`;
  confirmation += `⏰ *Horário:* ${time}\n`;
  confirmation += `👤 *Nome:* ${name}\n`;
  confirmation += `📱 *Telefone:* ${phone}\n`;
  if (companion) confirmation += `👥 *Acompanhante:* ${companion}\n`;
  confirmation += `\n🎯 *Sua aula experimental é GRATUITA!*\n\n`;
  confirmation += `📋 *INSTRUÇÕES:*\n`;
  confirmation += `• Chegue 15 minutos antes\n`;
  confirmation += `• Traga roupa esportiva\n`;
  confirmation += `• Leve água e toalha\n`;
  confirmation += `• Não esqueça de um documento\n\n`;
  confirmation += `💬 Digite *MENU* para outras opções.`;
  
  await sendMessage(chatId, confirmation);
  userSessions.delete(chatId);
}

function parseDate(dateStr) {
  const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match = dateStr.match(regex);
  
  if (!match) return null;
  
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() != year || date.getMonth() != month - 1 || date.getDate() != day) {
    return null;
  }
  
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function getAvailableRecreioTimes(date) {
  const times = config.limits.recreio.timeSlots;
  return times.filter(time => checkVagasLimit('recreio', date, time));
}

function validateTime(timeStr) {
  const regex = /^(\d{1,2}):(\d{2})$/;
  const match = timeStr.match(regex);
  
  if (!match) return null;
  
  const hour = parseInt(match[1]);
  const minute = parseInt(match[2]);
  
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function validatePhone(phoneStr) {
  const cleaned = phoneStr.replace(/\D/g, '');
  
  if (cleaned.length === 10 || cleaned.length === 11) {
    const ddd = cleaned.substring(0, 2);
    const number = cleaned.substring(2);
    
    if (cleaned.length === 11) {
      return `(${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`;
    } else {
      return `(${ddd}) ${number.substring(0, 4)}-${number.substring(4)}`;
    }
  }
  
  return null;
}

async function sendMessage(chatId, text) {
  try {
    await sock.sendMessage(chatId, { text });
    logger.debug(`Message sent to ${chatId}`);
  } catch (error) {
    logger.error('Error sending message:', error);
  }
}

// Backup and recovery functions
async function createBackup() {
  try {
    const backup = {
      timestamp: new Date().toISOString(),
      vagasRecreiro,
      vagasBangu,
      metrics,
      pausedChats: Array.from(pausedChats.entries())
    };
    
    await fs.writeJson('/home/runner/work/boytrrr/boytrrr/sessions_backup.json', backup);
    logger.info('Backup created successfully');
  } catch (error) {
    logger.error('Error creating backup:', error);
  }
}

async function loadBackup() {
  try {
    if (await fs.pathExists('/home/runner/work/boytrrr/boytrrr/sessions_backup.json')) {
      const backup = await fs.readJson('/home/runner/work/boytrrr/boytrrr/sessions_backup.json');
      
      if (backup.vagasRecreiro) vagasRecreiro = backup.vagasRecreiro;
      if (backup.vagasBangu) vagasBangu = backup.vagasBangu;
      if (backup.metrics) metrics = { ...metrics, ...backup.metrics };
      if (backup.pausedChats) {
        pausedChats = new Map(backup.pausedChats);
      }
      
      logger.info('Backup loaded successfully');
    }
  } catch (error) {
    logger.error('Error loading backup:', error);
  }
}

// WhatsApp connection functions
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('wa_sessions');
  
  sock = makeWASocket({
    auth: state,
    logger: logger.child({ module: 'baileys' }),
    markOnlineOnConnect: config.whatsapp.markOnlineOnConnect,
  });

  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      qrcode.generate(qr, { small: true });
      logger.info('QR Code generated. Scan with WhatsApp.');
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info('Connection closed due to', lastDisconnect?.error, ', reconnecting', shouldReconnect);
      
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      logger.info('WhatsApp connection opened successfully');
    }
  });
  
  sock.ev.on('messages.upsert', async (m) => {
    const message = m.messages[0];
    if (!message.key.fromMe && m.type === 'notify') {
      await handleMessage(message);
    }
  });
}

// Scheduled tasks
function scheduleBackups() {
  // Daily backup at 3 AM
  schedule.scheduleJob('0 3 * * *', createBackup);
  
  // Save booking data every 5 minutes
  schedule.scheduleJob('*/5 * * * *', saveBookingData);
  
  logger.info('Scheduled backup tasks initialized');
}

// Initialize all systems
async function initialize() {
  console.log('🏐 CT LK Futevôlei WhatsApp Bot Starting...\n');
  
  // Create necessary directories
  await fs.ensureDir('logs');
  await fs.ensureDir('wa_sessions');
  
  // Initialize systems
  initLogger();
  initCache();
  initTelegramBots();
  
  // Load existing data
  loadBookingData();
  await loadBackup();
  
  // Schedule tasks
  scheduleBackups();
  
  // Connect to WhatsApp
  await connectToWhatsApp();
  
  logger.info('🚀 CT LK Futevôlei Bot fully initialized and ready!');
}

// Start the bot
initialize().catch((error) => {
  console.error('Failed to initialize bot:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down bot...');
  await createBackup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down bot...');
  await createBackup();
  process.exit(0);
});