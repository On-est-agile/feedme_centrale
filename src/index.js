const sqlite3 = require('sqlite3').verbose();
const MQTTManager = require('./mqtt_manager');
const XBeeManager = require('./xbee_management');
const xbee_api = require('xbee-api');
const dotenv = require('dotenv');
dotenv.config();

const C = xbee_api.constants;

if (!process.env.SERIAL_PORT) {
    console.error('Missing SERIAL_PORT in environment variables');
    process.exit(1);
}

const db = new sqlite3.Database('./sqlite.db');

const SAMPLE_DISPENSE_CONFIG = {
    SCHEDULE: [],
    AMOUNT: {
        '1': 1.3,
        '2': 2,
        '3': 2.3,
        '4': 2.6,
        '5': 3,
    }
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

// get address64 of the node by feeder.id
async function getAddress64OfNodes(feederId) {
    return new Promise((resolve, reject) => {
        const query = `
      SELECT nodes.address
      FROM nodes
      INNER JOIN feeders ON nodes.feeder_id = feeders.id
      WHERE feeders.id = ? AND nodes.name = 'Porte'
    `;

        db.all(query, [feederId], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            if (rows.length === 0) {
                reject(new Error('No node found for feeder'));
                return;
            }

            resolve(rows[0].address);
        });
    });
}

async function setupTenantSubscriptions(mqttClient, xbeeClient) {
    try {
        const tenants = await fetchTenants();

        for (const tenant of tenants) {
            for (const feeder of await fetchFeeders(tenant.id)) {
                await mqttClient.subscribe(`feedme/${tenant.name}/${feeder.id}/commands/feeder/dispense`, async (message) => {
                    try {

                        const duration = Math.round((SAMPLE_DISPENSE_CONFIG.AMOUNT[message.amount]) * 1000);

                        let address64 = await getAddress64OfNodes(feeder.id);


                        // xbeeClient.sendRemoteATCommand('Porte', 'D0', ['04'], 'Open top trap');
                        xbeeClient.sendRemoteATCommand(address64, 'D0', ['04'], `Open top trap for ${message.amount} dose(s)`);
                        await new Promise((resolve) => setTimeout(resolve, duration));
                        // xbeeClient.sendRemoteATCommand('Porte', 'D0', ['05'], 'Close top trap');
                        xbeeClient.sendRemoteATCommand(address64, 'D0', ['05'], `Close top trap for ${message.amount} dose(s)`);

                    } catch (error) {
                        console.error(`Dispense command error for tenant ${tenant.name}:`, error);
                    }
                })
            };

            await mqttClient.subscribe(`feedme/${tenant.name}/feeders/add`, async (message) => {
                try {
                    const { name } = message;
                    db.get("SELECT * FROM feeders WHERE name = ? AND tenant_id = ?", [name, tenant.id], (err, row) => {
                        if (err) {
                            console.error(`Error fetching feeder for tenant ${tenant.name}:`, err);
                        } else if (!row) {
                            db.run("INSERT INTO feeders (name, tenant_id, paired) VALUES (?, ?, 0)",
                                [name, tenant.id]);
                            console.log(`Feeder added for tenant ${tenant.name}:`, name);
                        } else {
                            console.log(`Feeder already exists for tenant ${tenant.name}:`, name);
                        }
                    });
                } catch (error) {
                    console.error(`Pending feeder error for tenant ${tenant.name}:`, error);
                }
            });

            await mqttClient.subscribe(`feedme/${tenant.name}/feeders/askForPeer`, async (message) => {
                try {
                    const { name } = message;
                    console.log(`Asking for peer for tenant ${tenant.name}:`, name);
                    db.get("SELECT * FROM feeders WHERE name = ? AND tenant_id = ?", [name, tenant.id], (err, row) => {
                        if (err) {
                            console.error(`Error fetching feeder for tenant ${tenant.name}:`, err);
                        } else if (row) {
                            console.log(`1 Feeder found for tenant ${tenant.name}:`, name);
                            if (!row.paired) {
                                console.log(`2 Feeder not paired for tenant ${tenant.name}:`, name);
                                if (name === 'Miaou1') {
                                    console.log(`3 Asking for peer for tenant ${tenant.name}:`, name);
                                    xbeeClient.addListener(C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET, async (frame) => {
                                        const node = xbeeClient.getNodeByAddress(frame.remote64);
                                        const data = frame.data.toString();
                                        if (node && node.name === 'Puce') {
                                            try {
                                                let uid = data.split('-')[0].split(':')[1].trim();
                                                uid = uid.replace(/ /g, '');
                                                const isValide = uid.length === 8 ? true : false;
                                                if (isValide) {
                                                    await new Promise((resolve, reject) => {
                                                        db.run(`UPDATE feeders SET uid = ?, paired = 1, WHERE name = ?`,
                                                            [node.address64, name],
                                                            (err) => {
                                                                if (err) reject(err);
                                                                else resolve();
                                                            }
                                                        );
                                                    });

                                                    console.log(`Paired feeder ${name} with node Puce (${node.address64})`);

                                                    await mqttClient.publish(`feedme/${tenant.name}/feeders/paired`, {
                                                        feeder: name,
                                                        uid: node.address64,
                                                    });

                                                    xbeeClient.removeListener(C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET);
                                                } else {
                                                    console.log('UID not valid');
                                                }
                                            } catch (error) {
                                                console.error(`Error pairing feeder ${name}:`, error);
                                            }
                                        }
                                    });
                                }
                            }
                        } else {
                            console.log(`Feeder not found for tenant ${tenant.name}:`, name);
                        }
                    });
                } catch (error) {
                    console.error(`Ask for peer error for tenant ${tenant.name}:`, error);
                }
            });
        }
    } catch (error) {
        console.error('Error setting up tenant subscriptions:', error);
        throw error;
    }
}

async function main() {
    const mqttClient = new MQTTManager();
    const xbeeClient = new XBeeManager(mqttClient);

    try {
        await mqttClient.connect();
        await xbeeClient.connect();

        await setupTenantSubscriptions(mqttClient, xbeeClient);
        setInterval(() => publishTenantFeeders(mqttClient), 10000);

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