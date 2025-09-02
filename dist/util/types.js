"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addressType = void 0;
var addressType;
(function (addressType) {
    addressType[addressType["SOLANA"] = 0] = "SOLANA";
    addressType[addressType["EVM"] = 1] = "EVM";
    addressType[addressType["INVALID"] = 2] = "INVALID";
})(addressType || (exports.addressType = addressType = {}));
