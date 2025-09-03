"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const logger_1 = require("./util/logger");
const TOKEN_MINT_ADDRESS = "7NgbAAMf3ozg4NG3Ynt2de5TA2afMZZkfkGpEpC2mXYu";
async function getTokenDetails(mintAddress) {
    const connection = new web3_js_1.Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const mintPublicKey = new web3_js_1.PublicKey(mintAddress);
    // Get mint information using the getMint function
    const mintInfo = await (0, spl_token_1.getMint)(connection, mintPublicKey);
    (0, logger_1.childLogger)(logger_1.appLogger, 'TokenAdd').info("Token Details", mintInfo);
}
// Replace 'TOKEN_MINT_ADDRESS' with the actual mint address of the token you're interested in
getTokenDetails(TOKEN_MINT_ADDRESS);
