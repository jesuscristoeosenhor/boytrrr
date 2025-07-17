export default {
  // WhatsApp Bot Configuration
  whatsapp: {
    sessionPath: './wa_sessions',
    printQRInTerminal: true,
    markOnlineOnConnect: true,
  },
  
  // Telegram Integration
  telegram: {
    recreio: {
      token: "7637453097:AAEFHT9RYnK28Jp5ZeE_-tDhrTdr14QeSQ4",
      chatId: "1116351270"
    },
    bangu: {
      token: "8127747217:AAFDEUkK4k-ZZkwC29bUamz1m7u9KIWkOAA",
      chatId: "1116351270"
    }
  },

  // Experimental Class Limits
  limits: {
    recreio: {
      maxPerSlot: 2,
      timeSlots: ["17:30", "18:30", "19:30"]
    },
    bangu: {
      maxPerSlot: null // No limit
    }
  },

  // Cache Configuration
  cache: {
    stdTTL: 600, // 10 minutes
    checkperiod: 120 // 2 minutes
  },

  // Rate Limiting
  rateLimit: {
    maxMessages: 10,
    windowMs: 60000 // 1 minute
  },

  // Auto Pause Configuration
  autoPause: {
    reactivationTimeMs: 30 * 60 * 1000 // 30 minutes
  },

  // TotalPass Configuration (keeping existing)
  recreio: {
    partner_api_key: "6q4ixnsf0wkpj88uyoob",
    place_api_key: "UELJ8FL4",
    telegram_token: "7622403986:AAE293hk8sDCc9Agzchavr-U7g8rBswPYe8",
    chat_ids: ["1116351270"]
  },
  california: {
    partner_api_key: "6q4ixnsf0wkpj88uyoob",
    place_api_key: "AOUSECTP",
    telegram_token: "8160838271:AAFPpQuOgyGaNsfA9tmlyGMCCYTiFXoIRGY",
    chat_ids: ["1116351270"]
  }
};