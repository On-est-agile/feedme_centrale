const mqtt = require('mqtt');
const dotenv = require('dotenv');
dotenv.config();

class MQTTManager {
    constructor() {
        dotenv.config();

        this.broker = process.env.MQTT_BROKER || 'localhost';
        this.port = process.env.MQTT_PORT || 1883;

        this.clientOptions = {
            reconnectPeriod: 1000,
            connectTimeout: 5000
        };

        this.subscriptions = new Map();

        this.client = null;
    }

    connect() {
        const connectionUrl = `mqtt://${this.broker}:${this.port}`;
        
        return new Promise((resolve, reject) => {
            try {
                this.client = mqtt.connect(connectionUrl, this.clientOptions);

                this.client.on('connect', () => {
                    console.log(`Connected to MQTT Broker: ${connectionUrl}`);
                    resolve(this.client);
                });

                this.client.on('error', (error) => {
                    console.error('MQTT Connection Error:', error);
                    reject(error);
                });

                this.client.on('message', (topic, message) => {
                    const handler = this.subscriptions.get(topic);
                    
                    if (handler) {
                        try {
                            const parsedMessage = JSON.parse(message.toString());
                            handler(parsedMessage);
                        } catch (error) {
                            handler(message.toString());
                        }
                    }
                });
            } catch (error) {
                console.error('MQTT Initialization Error:', error);
                reject(error);
            }
        });
    }

    publish(topic, payload) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error('MQTT Client not connected'));
                return;
            }

            const message = JSON.stringify(payload);

            this.client.publish(topic, message, (error) => {
                if (error) {
                    console.error(`Publish error on topic ${topic}:`, error);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    subscribe(topic, callback) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error('MQTT Client not connected'));
                return;
            }

            this.client.subscribe(topic, (error) => {
                if (error) {
                    console.error(`Subscription error for topic ${topic}:`, error);
                    reject(error);
                } else {
                    this.subscriptions.set(topic, callback);
                    console.log(`Subscribed to topic: ${topic.replace(`${process.env.CLIENT_SECRET}`, '******')}`);
                    resolve();
                }
            });
        });
    }

    disconnect() {
        return new Promise((resolve, reject) => {
            if (this.client) {
                this.client.end(false, () => {
                    console.log('MQTT Client disconnected');
                    this.client = null;
                    this.subscriptions.clear();
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = MQTTManager;