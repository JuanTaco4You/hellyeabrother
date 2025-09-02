"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const dotenv_1 = __importDefault(require("dotenv"));
const helper_1 = require("./util/helper");
dotenv_1.default.config();
const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error("Bot token is not set in .env");
    process.exit(1);
}
console.log("Bot token:", token);
// Create a new Telegram bot using polling to fetch new updates
const bot = new node_telegram_bot_api_1.default(token, { polling: true });
(0, helper_1.MoralisStart)().then(() => {
    console.log("Moralis started!");
});
exports.default = bot;
