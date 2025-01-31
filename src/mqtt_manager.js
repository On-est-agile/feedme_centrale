const mqtt = require('mqtt');
const dotenv = require('dotenv');
dotenv.config();

class MQTTManager {
    /**
     * Initializes MQTT communication manager
     * Configures broker connection settings from environment variables
     */
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

    /**
     * Establishes connection to MQTT broker
     * Sets up event listeners for connection, errors, and incoming messages
     * @returns {Promise} Resolves with MQTT client on successful connection
     */
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

    /**
     * Publishes a message to a specific MQTT topic
     * @param {string} topic - MQTT topic to publish to
     * @param {Object} payload - Message payload to send
     * @returns {Promise} Resolves when message is published successfully
     */
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
    /**
     * Subscribes to an MQTT topic and registers a callback handler
     * @param {string} topic - MQTT topic to subscribe to
     * @param {Function} callback - Handler function for received messages
     * @returns {Promise} Resolves when subscription is successful
     */
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

    /**
     * Disconnects from MQTT broker
     * Clears client and subscriptions
     * @returns {Promise} Resolves when disconnection is complete
     */
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