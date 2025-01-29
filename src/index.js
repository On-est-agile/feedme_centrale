const sqlite3 = require('sqlite3').verbose();
const MQTTManager = require('./mqtt_manager');
const XBeeManager = require('./xbee_management');
const xbee_api = require('xbee-api');
const dotenv = require('dotenv');
dotenv.config();

const CLIENT_SECRET = process.env.CLIENT_SECRET;

if (!CLIENT_SECRET) {
    console.error('Missing CLIENT_SECRET in environment variables');
    process.exit(1);
}

if (!process.env.SERIAL_PORT) {
    console.error('Missing SERIAL_PORT in environment variables');
    process.exit(1);
}

const db = new sqlite3.Database('./sqlite.db');

const SAMPLE_DISPENSE_CONFIG = {
    RATE: 5,  // Per second qty in gram
    MAX_AMOUNT: 200,  // gmax per dispense
    MIN_AMOUNT: 10,   // gmin per dispense
    SCHEDULE: [] // How to define ? Maybe SQLITE storage by CLIENT_SECRET ?
};

async function fetchTenants() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM tenants", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function fetchFeeders(tenantId) {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM feeders WHERE tenant_id = ?", [tenantId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function publishTenantFeeders(mqttClient) {
    try {
        const tenants = await fetchTenants();
        for (const tenant of tenants) {
            const feeders = await fetchFeeders(tenant.id);
            await mqttClient.publish(`feedme/${tenant.name}/feeders`, { feeders });
        }
    } catch (error) {
        console.error('Error publishing tenant feeders:', error);
    }
}

async function main() {
    const mqttClient = new MQTTManager();
    const xbeeClient = new XBeeManager(mqttClient);

    try {
        await mqttClient.connect();
        await xbeeClient.connect();

        setInterval(() => publishTenantFeeders(mqttClient), 10000);

        await mqttClient.subscribe(`feedme/${CLIENT_SECRET}/commands/feeder/dispense`, async (message) => {
            try {
                if (message.amount < SAMPLE_DISPENSE_CONFIG.MIN_AMOUNT ||
                    message.amount > SAMPLE_DISPENSE_CONFIG.MAX_AMOUNT) {
                    console.error('Invalid dispense amount:', message.amount);
                    return;
                }

                const duration = Math.round((message.amount / SAMPLE_DISPENSE_CONFIG.RATE) * 1000);
                console.log(`Dispensing ${message.amount}g (${duration}ms)`);

                // TO-DO : implement opening command with motor XBees
                // No implementation for now because no motors are connected

            } catch (error) {
                console.error('Dispense command error:', error);
            }
        });

        await mqttClient.subscribe(`feedme/${CLIENT_SECRET}/feeders/pair`, async (message) => {
            try {
                const { uid, name } = message;
                db.get("SELECT * FROM tenants WHERE name = ?", [CLIENT_SECRET], (err, row) => {
                    if (err) {
                        console.error('Error fetching tenant:', err);
                    } else {
                        db.run("INSERT INTO feeders (name, tenant_id, uid, paired) VALUES (?, ?, ?, 1)", [name, row.id, uid]);
                        console.log('Feeder added:', uid);
                    }
                });
            } catch (error) {
                console.error('Add feeder error:', error);
            }
        });

        // xbeeClient.sendRemoteATCommand('Porte', 'D0', ['04'], 'Turn on the light');
        // xbeeClient.sendRemoteATCommand('Porte', 'D0', ['05'], 'Turn off the light');

    } catch (error) {
        console.error('Initialization Error:', error);
        try {
            await mqttClient.disconnect();
            await xbeeClient.disconnect();
        } catch (disconnectError) {
            console.error('Error during cleanup:', disconnectError);
        }
        process.exit(1);
    }
}

main().catch(console.error);