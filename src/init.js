const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sqlite.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS feeders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            tenant_id INTEGER,
            FOREIGN KEY(tenant_id) REFERENCES tenants(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT,
            feeder_id INTEGER,
            FOREIGN KEY(feeder_id) REFERENCES feeders(id)
        )
    `);
});

db.close();