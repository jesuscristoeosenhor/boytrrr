# CT LK Futevôlei WhatsApp Bot

Bot completo para WhatsApp do CT LK Futevôlei com todas as funcionalidades solicitadas.

## 🚀 Funcionalidades

### Sistema Principal
- ✅ **Menu com 9 opções** completas
- ✅ **Sistema de pausa automática** quando atendente humano responde
- ✅ **Controle de vagas experimentais** (Recreio: max 2/horário, Bangu: ilimitado)
- ✅ **Integração Telegram** para notificações administrativas
- ✅ **Cache inteligente** para melhor performance
- ✅ **Rate limiting** anti-spam (10 msgs/min por usuário)
- ✅ **Sistema de logs** com Winston e rotação automática
- ✅ **Backup automático** diário e em caso de reinicialização
- ✅ **Métricas e monitoramento** básico

### Funcionalidades do Menu
1. **Informações das Unidades** - Recreio e Bangu
2. **Horários das Aulas** - Detalhados por unidade
3. **Valores e Planos** - Preços e promoções
4. **Agendamento Experimental** - Fluxo completo com validações
5. **Plataformas Check-in** - Gympass, TotalPass, etc.
6. **Localização** - Links Google Maps
7. **Níveis das Turmas** - Iniciante a Profissional
8. **FAQ** - Perguntas frequentes
9. **Atendente Humano** - Pausa automática do bot

### Comandos Telegram Administrativos
- `/vagas` - Ver reservas de hoje
- `/vagas YYYY-MM-DD` - Ver reservas de data específica
- `/cancelar ID` - Cancelar reserva por ID
- `/cancelar_nome Nome` - Cancelar por nome
- `/reset YYYY-MM-DD` - Resetar reservas do dia
- `/relatorio` - Estatísticas gerais

## 📦 Instalação

```bash
# Clone o repositório
git clone https://github.com/jesuscristoeosenhor/boytrrr.git
cd boytrrr

# Instale as dependências
npm install

# Configure o ambiente (opcional)
cp .env.template .env
# Edite o .env se necessário

# Inicie o bot
npm start
```

## 🔧 Configuração

O bot usa as configurações padrão do `config.js`. Para personalizar, edite:

- **Tokens Telegram**: Já configurados conforme especificação
- **Limites de vagas**: Recreio (2/horário), Bangu (ilimitado)
- **Rate limiting**: 10 mensagens por minuto
- **Reativação automática**: 30 minutos após pausa

## 📱 Como Usar

### Para Usuários (WhatsApp)
1. Escaneie o QR Code quando o bot iniciar
2. Envie qualquer mensagem para ver o menu
3. Digite números de 1-9 para navegar
4. Digite "MENU" para voltar ao menu principal
5. Para agendar experimental: opção 4 → siga o fluxo guiado

### Para Administradores (Telegram)
- Use os bots configurados para receber notificações
- Comandos administrativos disponíveis nos grupos
- Relatórios automáticos e controle de reservas

## 🗂️ Estrutura de Arquivos

```
/
├── bot.js                 # Arquivo principal do bot
├── config.js              # Configurações
├── package.json           # Dependências
├── .env.template          # Template de variáveis
├── .gitignore            # Arquivos ignorados
├── README.md             # Este arquivo
├── vagas_recreio.json    # Dados Recreio (auto-gerado)
├── vagas_bangu.json      # Dados Bangu (auto-gerado)
├── sessions_backup.json  # Backup sessões (auto-gerado)
├── wa_sessions/          # Sessões WhatsApp (auto-gerado)
└── logs/                 # Logs do sistema (auto-gerado)
```

## 🔄 Sistema de Pausa Automática

- **Detecção**: Bot pausa automaticamente quando humano responde
- **Reativação**: 30min automático OU comandos `/reativar` / `MENU`
- **Motivos**: Takeover humano ou solicitação do usuário (opção 9)

## 📊 Monitoramento

O bot gera logs estruturados e métricas básicas:
- Mensagens recebidas
- Agendamentos realizados
- Menus exibidos
- Interferências humanas

## 🛡️ Segurança

- Rate limiting integrado
- Validação de inputs
- Backup automático de dados
- Logs detalhados para auditoria

## 🚀 Produção

Para usar em produção:
1. Configure um processo manager (PM2)
2. Configure backup externo dos dados JSON
3. Monitor logs regularmente
4. Mantenha tokens seguros

## 📞 Suporte

Bot desenvolvido conforme especificações do CT LK Futevôlei.
Funcionalidades completas e prontas para uso.