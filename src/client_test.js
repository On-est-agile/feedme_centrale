/* 
Client sample for web app example to send instructions to the feedme and receive sensor data
*/

const MQTTManager = require('./mqtt_manager');

const CLIENT_SECRET = "Pipenv-not-found";

async function main() {
    const mqttClient = new MQTTManager();

    try {
        await mqttClient.connect();

        await mqttClient.subscribe(`feedme/${CLIENT_SECRET}/sensors/balance_bottom/weight`, (message) => {
            console.log('Balance bottom weight update:', message);
        });

        await mqttClient.publish(`feedme/${CLIENT_SECRET}/commands/feeder/dispense`, {
            amount: 50
        });

        // Set feeding schedule
        // I don't know how to put it, to think about it
        await mqttClient.publish(`feedme/${CLIENT_SECRET}/commands/feeder/schedule`, {
            schedule: [
                { time: '07:00', amount: 50 },
                { time: '19:00', amount: 50 } 
            ],
        });

    } catch (error) {
        console.error('MQTT Test Error:', error);
    } finally {
        await mqttClient.disconnect();
    }
}

main().catch(console.error);