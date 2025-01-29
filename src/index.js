const MQTTManager = require('./mqtt_manager');
const XBeeManager = require('./xbee_management');
const xbee_api = require('xbee-api');
const dotenv = require('dotenv');
dotenv.config();

const CLIENT_SECRET = process.env.CLIENT_SECRET;

const XBEE_QTY = 3;

if (!CLIENT_SECRET) {
    console.error('Missing CLIENT_SECRET in environment variables');
    process.exit(1);
}

if (!process.env.SERIAL_PORT) {
    console.error('Missing SERIAL_PORT in environment variables');
    process.exit(1);
}

const SAMPLE_DISPENSE_CONFIG = {
    RATE: 5,  // Per second qty in gram
    MAX_AMOUNT: 200,  // gmax per dispense
    MIN_AMOUNT: 10,   // gmin per dispense
    SCHEDULE: [] // How to define ? Maybe SQLITE storage by CLIENT_SECRET ?
};

async function main() {
    const mqttClient = new MQTTManager();
    const xbeeClient = new XBeeManager();

    try {
        await mqttClient.connect();

        await xbeeClient.connect();
        // await xbeeClient.sendRemoteNIRequest();

        // while (xbeeClient.nodes.length < XBEE_QTY) {
        //     await new Promise((resolve) => setTimeout(resolve, 1000));
        // }

        while (xbeeClient.nodes.length < XBEE_QTY) {
            console.log('Waiting for nodes to connect...');
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/all`, {
            nodes: xbeeClient.nodes
        });

        try {
            await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/balance_bottom`, {
                status: 'full',
                weight: 100
            });

        } catch (error) {
            console.error('Get balance command error:', error);
        }

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

                // Status update
                await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/feeder`, {
                    status: 'dispensing',
                    amount: message.amount,
                });

            } catch (error) {
                console.error('Dispense command error:', error);
            }
        });

        await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/balance_bottom`, {
            status: 'full',
            weight: 100
        });

        await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/trap_top`, {
            status: 'open'
        });


    } catch (error) {
        console.error('Initialization Error:', error);
        // Attempt to disconnect cleanly in case of error
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