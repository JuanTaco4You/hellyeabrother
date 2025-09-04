# Solana Telegram Signal Trading Bot

## Personal Trading Bot, not public

## Trading Stratergy

## Realtime-Monitor Channel

* **Channel Link** = https://t.me/Maestrosdegen

* **Maestrosdegen Telegram Signal Channel for realtime monitoring**

* we need to distinct solana token address and ethereum token address, etc.

## Buy and Sell Criteria

**I want an automated trading bot on solana, raydium with some criteria:**

* (-) input data: (to buy)
* (+) solana contract from a telegram channel or group ID
* (+) solana contract from data.txt file
* (-) result:
* (+) Instantly buy tokens
* (+) Sell: setup take profit 1, take profit 2, loss
* (-) options:
* (+) Jito fee
* (+) min and max LQ
* (+) Slippage

# Telegram Tokens, RPC_node,  Required APIs

* **TELEGRAM_TOKEN**='...'
* **TELEGRAM_CHANNEL**='@YourPublicChannel' or 'https://t.me/YourPublicChannel'
  - Note: telegram-scraper requires a public channel username. Numeric chat IDs like '-4798590389' are not supported for scraping.
* **TELEGRAM_GROUP_ID**='-4798590389'
  - Optional: restricts bot interactions to this chat ID.
  - If `TELEGRAM_CHANNEL` is empty and `TELEGRAM_GROUP_ID` is set, Auto Buy listens to messages in this chat and buys when a valid Solana mint address appears.

* **RPC_URL**='https://mainnet.helius-rpc.com/?api-key=12e48098-...'
* **WEBSOCKET_URL** = "wss://mainnet.helius-rpc.com/?api-key=12e48098-..."

* **FALCONHIT_API_KEY**=""
* **MORALIS_API_KEY**=""
* **BITQUERY_V2_TOKEN**=""
* **BITQUERY_V1_TOKEN**=""

## Install and Working

1. **yarn install**
2. **yarn start**
3. Find **@tank_...** (in Telegram)
4. **/start** (Telegram)
5. selection buttons ...

## working process

