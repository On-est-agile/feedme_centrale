const MQTTManager = require('./mqtt_manager');
const dotenv = require('dotenv');
dotenv.config();

const CLIENT_SECRET = process.env.CLIENT_SECRET;

const SAMPLE_DISPENSE_CONFIG = {
    RATE: 5,  // Per second qty in gram
    MAX_AMOUNT: 200,  // gmax per dispense
    MIN_AMOUNT: 10,   // gmin per dispense
    SCHEDULE: [] // How to define ? Maybe SQLITE storage by CLIENT_SECRET ?
};

async function main() {
    const mqttClient = new MQTTManager();

    try {
        await mqttClient.connect();

        // Distribution subscription
        await mqttClient.subscribe(`feedme/${CLIENT_SECRET}/commands/feeder/dispense`, async (message) => {
            try {
                // Check amount
                if (message.amount < SAMPLE_DISPENSE_CONFIG.MIN_AMOUNT || 
                    message.amount > SAMPLE_DISPENSE_CONFIG.MAX_AMOUNT) {
                    console.error('Invalid dispense amount:', message.amount);
                    return;
                }

                // Calculate duration
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

        // ==================================================
        // ==================================================

        // Status update
        await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/balance_bottom`, {
            status: 'full',
            weight: 100
        });

        await mqttClient.publish(`feedme/${CLIENT_SECRET}/statuses/trap_top`, {
            status: 'open'
        });

    } catch (error) {
        console.error('MQTT Initialization Error:', error);
    }
}

main().catch(console.error);