import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { MoralisStart } from "./util/helper";
import { appLogger, childLogger } from "./util/logger";
dotenv.config();

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    childLogger(appLogger, 'Bootstrap').error("Bot token is not set in .env");
    process.exit(1);
}
childLogger(appLogger, 'Bootstrap').info("Bot token loaded");
// Create a new Telegram bot using polling to fetch new updates
const bot = new TelegramBot(token, { polling: true });

MoralisStart()
  .then(() => childLogger(appLogger, 'Bootstrap').info("Moralis started"))
  .catch((e) => childLogger(appLogger, 'Bootstrap').error("Moralis start failed", e));

export default bot;
