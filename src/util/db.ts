// public modules
import sqlite3 from "sqlite3";
import { appLogger, childLogger } from "./logger";

// needed types
import { 
    buyActionType,
    sellActionType,
} from "./types";
export const buyActions: buyActionType[] = [];
export const sellActions: sellActionType[] = [];

const sqlite3Verbose = sqlite3.verbose();


// Open a database connection
const db = new sqlite3Verbose.Database("./trading.db", (err) => {
    const log = childLogger(appLogger, 'DB');
    if (err) {
      return log.error('Connection error', err);
    }
    log.info("Connected to SQLite database");
}); // In-memory database for demonstration, you can specify a file path for persistent storage

// Create a table
db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS buys (id INTEGER PRIMARY KEY, contractAddress TEXT, purchasedPrice FLOAT, priceFactor INTEGER, platform TEXT, chain TEXT, date TEXT);`,
      (err: any, row: any) => {
        if (err) {
          childLogger(appLogger, 'DB').error('Create table buys error', err.message);
        }
        //   console.log(row.id + "\t" + row.contractAddress);
      }
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS lastsignal (id INTEGER PRIMARY KEY, signalId INTEGER, date TEXT);`,
      (err: any, row: any) => {
        if (err) {
          childLogger(appLogger, 'DB').error('Create table lastsignal error', err.message);
        }
        //   console.log(row.id + "\t" + row.contractAddress);
      }
    );
    // Track seen signals for persistence of initial vs update classification
    db.run(
      `CREATE TABLE IF NOT EXISTS signal_seen (
        action TEXT NOT NULL,
        contractAddress TEXT NOT NULL,
        count INTEGER NOT NULL,
        firstAt TEXT NOT NULL,
        lastAt TEXT NOT NULL,
        PRIMARY KEY (action, contractAddress)
      );`,
      (err: any) => {
        if (err) {
          childLogger(appLogger, 'DB').error('Create table signal_seen error', err.message);
        }
      }
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS lookuptables (id INTEGER PRIMARY KEY, lutAddress TEXT);`,
      (err: any, row: any) => {
        if (err) {
          childLogger(appLogger, 'DB').error('Create table lookuptables error', err.message);
        }
      }
    )
});

// Create
export const addBuy = async () => {
    return new Promise((resolve, reject) => {
        const purchasedTime = new Date().toISOString();
    
        const data = buyActions.map((buyAction) => [
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
        const placeholders = buyActions.map(() => "(?, ?, ?, ?, ?, ?)").join(', ');
    
        const sql = `INSERT INTO buys (contractAddress, purchasedPrice, priceFactor, platform, chain, date) VALUES ${placeholders}`;
    
        //Insert all recored to database at once
        db.run(sql, flatData, function(err) {
            if (err) {
            childLogger(appLogger, 'DB').error('Bulk insert error', err);
            reject(err);
            }
            else {
            childLogger(appLogger, 'DB').info("Bulk insert successful");
            resolve(this.lastID);
            }
        });
    });
}

const getSolanaTokenAddresses = async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT contractAddress from buys WHERE chain = 'solana'", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    })
}

// Read
export const getSolanaBuys = async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM buys WHERE chain = 'solana'", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Update
const updateBuy = async (id: number, priceFactor: number) => {
    return new Promise((resolve, reject) => {
        db.run(
            "UPDATE buys SET priceFactor = ? WHERE id = ?",
            [priceFactor, id],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes); // Returns the number of rows affected
                }
            }
        );
    });
}


// Delete
const deleteBuy = async (id: number) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM buys WHERE id = ?", [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes); // Returns the number of rows affected
            }
        });
    });
}

export const updateSells = async () => {
    return new Promise((resolve, reject) => {
        try {
            const toDeleteIds: number[] = [];
            const toUpdateIds: number[] = [];

            for (const s of sellActions) {
                const pf = Number(s.priceFactor ?? 0);
                if (pf >= 2) toDeleteIds.push(s.id);
                else toUpdateIds.push(s.id);
            }

            childLogger(appLogger, 'DB').debug("update/delete id sets", { toUpdateIds, toDeleteIds });

            let pending = 0;
            const done = () => { if (--pending === 0) resolve("success update sell!"); };

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
                        childLogger(appLogger, 'DB').error('Update buys error', err);
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
                        childLogger(appLogger, 'DB').error('Delete buys error', err);
                        return reject(err);
                    }
                    done();
                });
            }

            if (pending === 0) resolve("nothing to update");
        } catch (err) {
            childLogger(appLogger, 'DB').error('updateSells error', err);
            reject(err);
        }
    })
}




// Danger: delete all buy rows
export const clearAllBuys = async () => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM buys", [], function (err) {
            if (err) {
                childLogger(appLogger, 'DB').error('Clear all buys error', err);
                reject(err);
            } else {
                childLogger(appLogger, 'DB').info(`Cleared buys table, rows affected: ${this.changes}`);
                resolve(this.changes);
            }
        });
    });
}

// Delete buys whose contractAddress is NOT in the provided list
export const clearBuysNotIn = async (mints: string[]) => {
    return new Promise((resolve, reject) => {
        try {
            if (!Array.isArray(mints) || mints.length === 0) {
                // If nothing is held, delete all rows (all are non-held)
                db.run("DELETE FROM buys", [], function (err) {
                    if (err) {
                        childLogger(appLogger, 'DB').error('Clear non-held (all) error', err);
                        return reject(err);
                    }
                    childLogger(appLogger, 'DB').info(`Cleared non-held buys (all), rows affected: ${this.changes}`);
                    resolve(this.changes);
                });
                return;
            }

            const placeholders = mints.map(() => '?').join(',');
            const sql = `DELETE FROM buys WHERE contractAddress NOT IN (${placeholders})`;
            db.run(sql, mints, function (err) {
                if (err) {
                    childLogger(appLogger, 'DB').error('Clear non-held buys error', err);
                    reject(err);
                } else {
                    childLogger(appLogger, 'DB').info(`Cleared non-held buys, rows affected: ${this.changes}`);
                    resolve(this.changes);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

  

  
// Persistent signal_seen helpers
export type SignalSeenRow = { action: 'buy' | 'sell', contractAddress: string, count: number, firstAt: string, lastAt: string };

export const loadAllSignalSeen = async (): Promise<SignalSeenRow[]> => {
  return new Promise((resolve, reject) => {
    db.all("SELECT action, contractAddress, count, firstAt, lastAt FROM signal_seen", (err, rows) => {
      if (err) return reject(err);
      resolve((rows || []).map((r: any) => ({
        action: r.action,
        contractAddress: r.contractAddress,
        count: Number(r.count),
        firstAt: String(r.firstAt),
        lastAt: String(r.lastAt),
      })));
    });
  });
}

export const upsertSignalSeen = async (action: 'buy' | 'sell', contractAddress: string, atISO: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO signal_seen (action, contractAddress, count, firstAt, lastAt)
                 VALUES (?, ?, 1, ?, ?)
                 ON CONFLICT(action, contractAddress)
                 DO UPDATE SET count = count + 1, lastAt = excluded.lastAt`;
    db.run(sql, [action, contractAddress, atISO, atISO], function (err) {
      if (err) return reject(err);
      resolve();
    });
  });
}

  
