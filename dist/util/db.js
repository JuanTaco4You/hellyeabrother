"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSells = exports.getSolanaBuys = exports.addBuy = exports.sellActions = exports.buyActions = void 0;
// public modules
const sqlite3_1 = __importDefault(require("sqlite3"));
const logger_1 = require("./logger");
exports.buyActions = [];
exports.sellActions = [];
const sqlite3Verbose = sqlite3_1.default.verbose();
// Open a database connection
const db = new sqlite3Verbose.Database("./trading.db", (err) => {
    const log = (0, logger_1.childLogger)(logger_1.appLogger, 'DB');
    if (err) {
        return log.error('Connection error', err);
    }
    log.info("Connected to SQLite database");
}); // In-memory database for demonstration, you can specify a file path for persistent storage
// Create a table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS buys (id INTEGER PRIMARY KEY, contractAddress TEXT, purchasedPrice FLOAT, priceFactor INTEGER, platform TEXT, chain TEXT, date TEXT);`, (err, row) => {
        if (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Create table buys error', err.message);
        }
        //   console.log(row.id + "\t" + row.contractAddress);
    });
    db.run(`CREATE TABLE IF NOT EXISTS lastsignal (id INTEGER PRIMARY KEY, signalId INTEGER, date TEXT);`, (err, row) => {
        if (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Create table lastsignal error', err.message);
        }
        //   console.log(row.id + "\t" + row.contractAddress);
    });
    db.run(`CREATE TABLE IF NOT EXISTS lookuptables (id INTEGER PRIMARY KEY, lutAddress TEXT);`, (err, row) => {
        if (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Create table lookuptables error', err.message);
        }
    });
});
// Create
const addBuy = async () => {
    return new Promise((resolve, reject) => {
        const purchasedTime = new Date().toISOString();
        const data = exports.buyActions.map((buyAction) => [
            buyAction.contractAdress,
            buyAction.price,
            0,
            buyAction.platform,
            buyAction.chain,
            purchasedTime
        ]);
        // Flatten the data array to prepare for bulk insertion
        const flatData = data.flat();
        // console.log(flatData);
        // Contruct placeholders for SQL statement
        const placeholders = exports.buyActions.map(() => "(?, ?, ?, ?, ?, ?)").join(', ');
        const sql = `INSERT INTO buys (contractAddress, purchasedPrice, priceFactor, platform, chain, date) VALUES ${placeholders}`;
        //Insert all recored to database at once
        db.run(sql, flatData, function (err) {
            if (err) {
                (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Bulk insert error', err);
                reject(err);
            }
            else {
                (0, logger_1.childLogger)(logger_1.appLogger, 'DB').info("Bulk insert successful");
                resolve(this.lastID);
            }
        });
    });
};
exports.addBuy = addBuy;
const getSolanaTokenAddresses = async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT contractAddress from buys WHERE chain = 'solana'", (err, rows) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(rows);
            }
        });
    });
};
// Read
const getSolanaBuys = async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM buys WHERE chain = 'solana'", (err, rows) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(rows);
            }
        });
    });
};
exports.getSolanaBuys = getSolanaBuys;
// Update
const updateBuy = async (id, priceFactor) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE buys SET priceFactor = ? WHERE id = ?", [priceFactor, id], function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve(this.changes); // Returns the number of rows affected
            }
        });
    });
};
// Delete
const deleteBuy = async (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM buys WHERE id = ?", [id], function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve(this.changes); // Returns the number of rows affected
            }
        });
    });
};
const updateSells = async () => {
    return new Promise((resolve, reject) => {
        const updateData = [];
        const deleteData = [];
        for (const sellAction of exports.sellActions) {
            if (Number(sellAction.priceFactor) >= 2) {
                deleteData.push(sellAction.id);
            }
            else {
                updateData.push([
                    sellAction.priceFactor || 0 + 1,
                    sellAction.id,
                ]);
            }
        }
        const flatUpdateData = updateData.flat();
        const flatDeleteData = deleteData.flat();
        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').debug("update/delete batches", { flatUpdateData, flatDeleteData });
        try {
            if (flatUpdateData.length > 0) {
                const updatePlaceholders = updateData.map(() => "(?)").join(', ');
                const updateSql = `UPDATE buys SET priceFactor = ${updatePlaceholders} where id = ${updatePlaceholders}`;
                db.run(updateSql, flatUpdateData, function (err) {
                    if (err) {
                        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Update buys error', err);
                        reject(err);
                    }
                });
            }
            if (flatDeleteData.length > 0) {
                const deletePlaceholders = deleteData.map(() => "(?)").join(', ');
                const deleteSql = `DELETE FROM buys where id = ${deletePlaceholders}`;
                db.run(deleteSql, flatDeleteData, function (err) {
                    if (err) {
                        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Delete buys error', err);
                        reject(err);
                    }
                });
            }
            resolve("success update sell!");
        }
        catch (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('updateSells error', err);
            reject(err);
        }
    });
};
exports.updateSells = updateSells;
