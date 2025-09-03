"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const router_start_1 = __importDefault(require("./router.start"));
const logger_1 = require("../util/logger");
const router = (bot) => {
    (0, router_start_1.default)(bot);
    bot.on('polling_error', (e) => {
        (0, logger_1.childLogger)(logger_1.appLogger, 'Router').error('polling_error', e);
    });
};
exports.default = router;
