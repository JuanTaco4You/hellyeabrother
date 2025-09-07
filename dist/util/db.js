"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertSignalSeen = exports.loadAllSignalSeen = exports.clearBuysNotIn = exports.clearAllBuys = exports.updateSells = exports.getSolanaBuys = exports.addBuy = exports.sellActions = exports.buyActions = void 0;
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
    // Track seen signals for persistence of initial vs update classification
    db.run(`CREATE TABLE IF NOT EXISTS signal_seen (
        action TEXT NOT NULL,
        contractAddress TEXT NOT NULL,
        count INTEGER NOT NULL,
        firstAt TEXT NOT NULL,
        lastAt TEXT NOT NULL,
        PRIMARY KEY (action, contractAddress)
      );`, (err) => {
        if (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Create table signal_seen error', err.message);
        }
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
        try {
            const toDeleteIds = [];
            const toUpdateIds = [];
            for (const s of exports.sellActions) {
                const pf = Number(s.priceFactor ?? 0);
                if (pf >= 2)
                    toDeleteIds.push(s.id);
                else
                    toUpdateIds.push(s.id);
            }
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').debug("update/delete id sets", { toUpdateIds, toDeleteIds });
            let pending = 0;
            const done = () => { if (--pending === 0)
                resolve("success update sell!"); };
            if (toUpdateIds.length > 0) {
                pending++;
                const placeholders = toUpdateIds.map(() => '?').join(',');
                const sql = `UPDATE buys
                    SET priceFactor = CASE
                        WHEN priceFactor IS NULL THEN 1
                        WHEN priceFactor < 2 THEN priceFactor + 1
                        ELSE priceFactor
                    END
                    WHERE id IN (${placeholders})`;
                db.run(sql, toUpdateIds, function (err) {
                    if (err) {
                        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Update buys error', err);
                        return reject(err);
                    }
                    done();
                });
            }
            if (toDeleteIds.length > 0) {
                pending++;
                const placeholders = toDeleteIds.map(() => '?').join(',');
                const sql = `DELETE FROM buys WHERE id IN (${placeholders})`;
                db.run(sql, toDeleteIds, function (err) {
                    if (err) {
                        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Delete buys error', err);
                        return reject(err);
                    }
                    done();
                });
            }
            if (pending === 0)
                resolve("nothing to update");
        }
        catch (err) {
            (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('updateSells error', err);
            reject(err);
        }
    });
};
exports.updateSells = updateSells;
// Danger: delete all buy rows
const clearAllBuys = async () => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM buys", [], function (err) {
            if (err) {
                (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Clear all buys error', err);
                reject(err);
            }
            else {
                (0, logger_1.childLogger)(logger_1.appLogger, 'DB').info(`Cleared buys table, rows affected: ${this.changes}`);
                resolve(this.changes);
            }
        });
    });
};
exports.clearAllBuys = clearAllBuys;
// Delete buys whose contractAddress is NOT in the provided list
const clearBuysNotIn = async (mints) => {
    return new Promise((resolve, reject) => {
        try {
            if (!Array.isArray(mints) || mints.length === 0) {
                // If nothing is held, delete all rows (all are non-held)
                db.run("DELETE FROM buys", [], function (err) {
                    if (err) {
                        (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Clear non-held (all) error', err);
                        return reject(err);
                    }
                    (0, logger_1.childLogger)(logger_1.appLogger, 'DB').info(`Cleared non-held buys (all), rows affected: ${this.changes}`);
                    resolve(this.changes);
                });
                return;
            }
            const placeholders = mints.map(() => '?').join(',');
            const sql = `DELETE FROM buys WHERE contractAddress NOT IN (${placeholders})`;
            db.run(sql, mints, function (err) {
                if (err) {
                    (0, logger_1.childLogger)(logger_1.appLogger, 'DB').error('Clear non-held buys error', err);
                    reject(err);
                }
                else {
                    (0, logger_1.childLogger)(logger_1.appLogger, 'DB').info(`Cleared non-held buys, rows affected: ${this.changes}`);
                    resolve(this.changes);
                }
            });
        }
        catch (e) {
            reject(e);
        }
    });
};
exports.clearBuysNotIn = clearBuysNotIn;
const loadAllSignalSeen = async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT action, contractAddress, count, firstAt, lastAt FROM signal_seen", (err, rows) => {
            if (err)
                return reject(err);
            resolve((rows || []).map((r) => ({
                action: r.action,
                contractAddress: r.contractAddress,
                count: Number(r.count),
                firstAt: String(r.firstAt),
                lastAt: String(r.lastAt),
            })));
        });
    });
};
exports.loadAllSignalSeen = loadAllSignalSeen;
const upsertSignalSeen = async (action, contractAddress, atISO) => {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO signal_seen (action, contractAddress, count, firstAt, lastAt)
                 VALUES (?, ?, 1, ?, ?)
                 ON CONFLICT(action, contractAddress)
                 DO UPDATE SET count = count + 1, lastAt = excluded.lastAt`;
        db.run(sql, [action, contractAddress, atISO, atISO], function (err) {
            if (err)
                return reject(err);
            resolve();
        });
    });
};
exports.upsertSignalSeen = upsertSignalSeen;
