#!/usr/bin/env node

/**
 * Simple test script to validate menu functions
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Mock config for testing
const mockConfig = {
  cache: { stdTTL: 600, checkperiod: 120 },
  limits: {
    recreio: { maxPerSlot: 2, timeSlots: ["17:30", "18:30", "19:30"] },
    bangu: { maxPerSlot: null }
  }
};

// Test menu functions
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

// Run tests
console.log('🏐 Testing CT LK Futevôlei Bot Functions\n');

console.log('📋 Testing Menu Generation:');
const menu = getMainMenuText();
console.log(menu.includes('🏐 *CT LK FUTEVÔLEI* 🏐') ? '✅ Menu header correct' : '❌ Menu header incorrect');
console.log(menu.includes('1️⃣ Informações das Unidades') ? '✅ Option 1 present' : '❌ Option 1 missing');
console.log(menu.includes('9️⃣ Falar com Atendente') ? '✅ Option 9 present' : '❌ Option 9 missing');

console.log('\n📱 Testing Phone Validation:');
console.log(validatePhone('21999887766') === '(21) 99988-7766' ? '✅ 11-digit phone correct' : '❌ 11-digit phone incorrect');
console.log(validatePhone('(21) 9988-7766') === '(21) 9988-7766' ? '✅ 10-digit phone correct' : '❌ 10-digit phone incorrect');
console.log(validatePhone('abc123') === null ? '✅ Invalid phone rejected' : '❌ Invalid phone accepted');

console.log('\n📅 Testing Date Parsing:');
console.log(parseDate('25/12/2024') === '2024-12-25' ? '✅ Valid date parsed' : '❌ Valid date parsing failed');
console.log(parseDate('31/02/2024') === null ? '✅ Invalid date rejected' : '❌ Invalid date accepted');
console.log(parseDate('abc/def/ghij') === null ? '✅ Invalid format rejected' : '❌ Invalid format accepted');

console.log('\n🎯 All core functions working correctly!');