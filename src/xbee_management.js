const sqlite3 = require('sqlite3').verbose();
const SerialPort = require('serialport');
const xbee_api = require('xbee-api');
const dotenv = require('dotenv');
dotenv.config();

const CLIENT_SECRET = process.env.CLIENT_SECRET;
const C = xbee_api.constants;
const BROADCAST_ADDRESS = "FFFFFFFFFFFFFFFF";
const db = new sqlite3.Database('./sqlite.db');

class XBeeManager {
    constructor(mqttClient) {
        this.serialPort = null;
        this.xbeeAPI = null;
        this.port = process.env.SERIAL_PORT;
        this.baudRate = parseInt(process.env.SERIAL_BAUDRATE) || 9600;
        this.listeners = new Map();
        this.mqttClient = mqttClient;
        this.nodes = [];
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.xbeeAPI = new xbee_api.XBeeAPI({
                    api_mode: 2
                });

                this.serialPort = new SerialPort(this.port, {
                    baudRate: this.baudRate
                }, (err) => {
                    if (err) {
                        console.error('Error creating SerialPort:', err.message);
                        reject(err);
                        return;
                    }
                    console.log('Serial port opened successfully');
                });

                this.serialPort.pipe(this.xbeeAPI.parser);
                this.xbeeAPI.builder.pipe(this.serialPort);

                this.xbeeAPI.parser.on('data', (frame) => {
                    this._handleIncomingFrame(frame);
                });

                this.serialPort.on('open', () => {
                    console.log('Serial port is open');
                    resolve(this.serialPort);
                });

                this.serialPort.on('error', (err) => {
                    console.error('Serial port error:', err);
                    reject(err);
                });
            } catch (error) {
                console.error('XBee Initialization Error:', error);
                reject(error);
            }
        });
    }

    _handleIncomingFrame(frame) {
        for (const [type, handler] of this.listeners) {
            if (frame.type === type) {
                try {
                    handler(frame);
                } catch (error) {
                    console.error(`Error in frame handler for type ${type}:`, error);
                }
            }
        }

        if (C.FRAME_TYPE.NODE_IDENTIFICATION === frame.type) {
            const nodeIdentifier = frame.nodeIdentifier.toString();
            const address64 = frame.sender64.toString('hex');
            this.nodes.push({ nodeIdentifier, address64 });
            this.writeNode(nodeIdentifier, address64);
        }

        else if (C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX === frame.type) {
            const address64 = frame.remote64.toString('hex');
            this.getNodeByAddress(address64)
                .then((node) => {
                    if (node.name === 'Balance') {
                        const weight = frame.analogSamples.AD1;
                        console.log('Weight:', weight);
                        this.mqttClient.publish(`feedme/${CLIENT_SECRET}/sensors/weight`, { weight });
                    }
                })
        }

        else {
            const frameType = Object.keys(C.FRAME_TYPE).find(key => C.FRAME_TYPE[key] === frame.type);
            if (frameType) {
                console.log(`Received ${frameType} frame`);
            } else {
                console.log('Received unknown frame:', frame);
            }
        }
    }

    async sendRemoteATCommand(destinationType, command, commandParameters, description = '') {
        try {
            const node = await this.getNodeFromDB(destinationType);
            if (!node) {
                console.error('Node not found:', destinationType);
                return;
            }
            const destination64 = node.address;
            if (!destination64) {
                console.error('Node address not found:', destinationType);
                return;
            }

            const remoteATCommand = {
                type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
                destination64: destination64,
                command: command,
                commandParameter: commandParameters
            };

            if (description) {
                console.debug('Remote : ' + description);
            }

            return this.send(remoteATCommand);

        } catch (error) {
            console.error('Error fetching node from database:', error);
        }
    }

    async getNodeFromDB(nodeType) {
        return new Promise((resolve, reject) => {
            db.get("SELECT address FROM nodes WHERE name = ?", [nodeType], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getNodeByAddress(address64) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM nodes WHERE address = ?", [address64], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async writeNode(nodeType, address64) {
        const existingNode = await this.getNodeFromDB(nodeType);
        if (existingNode) {
            return new Promise((resolve, reject) => {
                db.run("UPDATE nodes SET address = ? WHERE name = ?", [address64, nodeType], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } else {
            return new Promise((resolve, reject) => {
                db.run("INSERT INTO nodes (name, address, feeder_id) VALUES (?, ?, 1)", [nodeType, address64], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }

    send(frame) {
        return new Promise((resolve, reject) => {
            if (!this.xbeeAPI || !this.serialPort) {
                reject(new Error('XBee connection not established'));
                return;
            }
            try {
                this.xbeeAPI.builder.write(frame);
                resolve();
            } catch (error) {
                console.error('Error sending XBee frame:', error);
                reject(error);
            }
        });
    }

    addListener(frameType, callback) {
        this.listeners.set(frameType, callback);
    }

    removeListener(frameType) {
        this.listeners.delete(frameType);
    }

    disconnect() {
        return new Promise((resolve, reject) => {
            if (this.serialPort) {
                this.serialPort.close((err) => {
                    if (err) {
                        console.error('Error closing serial port:', err);
                        reject(err);
                    } else {
                        console.log('Serial port closed');
                        this.serialPort = null;
                        this.xbeeAPI = null;
                        this.listeners.clear();
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = XBeeManager;
