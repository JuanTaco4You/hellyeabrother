import TelegramBot from "node-telegram-bot-api";
import startRouter from "./router.start";
import { appLogger, childLogger } from "../util/logger";


const router = (bot: TelegramBot) => {
    startRouter(bot);

    bot.on('polling_error', (e) => {
        childLogger(appLogger, 'Router').error('polling_error', e);
    });
}

export default router;
