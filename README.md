# Solana Telegram Signal Trading Bot

Automated Solana token trader that listens to Telegram channels or group messages and executes swaps on Raydium. Supports manual buys, auto buys from chat messages and automated sells based on price targets. A help command shows wallet balances and token holdings.

## Quick Start

```bash
# clone repository
git clone https://github.com/JuanTaco4You/hellyeabrother.git
cd hellyeabrother

# install dependencies
yarn install

# copy environment template
cp test.env_example.2.txt.txt .env

# edit .env and src/config.ts as described below

# build typescript
yarn build

# start bot
yarn start
```

## Configuration

### Environment Variables (`.env`)
- `TELEGRAM_TOKEN` – token from BotFather.
- `TELEGRAM_CHANNEL` – public channel username (e.g. `@YourPublicChannel` or `https://t.me/YourPublicChannel`). If empty and `TELEGRAM_GROUP_ID` is set, Auto Buy listens to messages in that chat.
- `TELEGRAM_GROUP_ID` – numeric chat ID to restrict bot interaction.
- `RPC_URL` – Solana RPC endpoint.
- `WEBSOCKET_URL` – websocket endpoint for the RPC provider.
- `FALCONHIT_API_KEY`, `MORALIS_API_KEY` – API keys for pool data and token prices.

### Local Settings (`src/config.ts`)
- `solanaWallets` – array of base58‑encoded private keys used for trading.
- `solBuyAmountRange` – `[min, max]` random SOL amount for Auto Buy.
- `priceFactor` – multiples used to trigger auto sells.
- `sellInternalDuration` – interval in milliseconds between sell checks.

## Usage

1. Open Telegram and send `/start` to your bot.
2. Use the inline buttons:
   - **🛒 Buy** → choose **Manual Buy** or **Auto Buy**.
     - Manual Buy: enter the SOL amount then the token mint address.
     - Auto Buy: when enabled, the bot scans chat messages for Solana addresses and buys random amounts within `solBuyAmountRange`.
   - **📈 Sell** – run periodic sell checks for positions saved in `trading.db`.
   - **💼 Help** – view balances and SPL token holdings for configured wallets.
   - **🛒 Stop Trading** – stop auto or manual trading.
3. Auto sell executes based on price targets and updates the database.

## Notes

- Only valid Solana token addresses are accepted.
- Swaps are executed on Raydium using the configured wallets.
- Price data is fetched from Moralis.
- Logs are written to the `logs/` directory.

## License

ISC

