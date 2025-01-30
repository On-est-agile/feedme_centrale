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
                        db.get("SELECT * FROM nodes WHERE address = ?", address64, (err, row) => {
                            if (err) {
                                console.error('Error fetching node:', err);
                            }
                            else if (row) {
                                const feeder = row.feeder_id;
                                db.get("SELECT * FROM feeders WHERE id = ?", feeder, (err, row) => {
                                    if (err) {
                                        console.error('Error fetching feeder:', err);
                                    } else {
                                        const amount = frame.analogSamples.AD1;
                                        db.get("SELECT * FROM tenants WHERE id = ?", row.tenant_id, (err, row) => {
                                            if (err) {
                                                console.error('Error fetching tenant:', err);
                                            } else {
                                                console.log('Publish to :', `feedme/${row.name}/${feeder}/sensors/balance_bottom`);
                                                this.mqttClient.publish(`feedme/${row.name}/${feeder}/sensors/balance_bottom`, { amount });
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
        } else if (C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET === frame.type) {
            const data = frame.data.toString();
            const address64 = frame.remote64.toString('hex');
            this.getNodeByAddress(address64)
                .then((node) => {
                    if (node.name === 'Puce') {
                        // console.log('Received address:', address64);
                        try {
                            let uid = data.split('-')[0].split(':')[1].trim();
                            uid = uid.replace(/ /g, '');
                            const isValide = uid.length === 8 ? true : false;
                            if (isValide) {
                                console.log('UID:', uid);
                                db.get("SELECT * FROM feeders WHERE uid = ?", uid, (err, row) => {
                                    if (err) {
                                        console.error('Error fetching feeder:', err);
                                    }
                                    else {
                                        db.get("SELECT * FROM nodes WHERE address = ?", address64, (err, row) => {
                                            if (err) {
                                                console.error('Error fetching node:', err);
                                            } else {
                                                db.get("SELECT * FROM feeders WHERE id = ?", row.feeder_id, (err, row) => {
                                                    if (err) {
                                                        console.error('Error fetching feeder:', err);
                                                    } else {
                                                        let catName = '';
                                                        if (row.uid === uid) {
                                                            console.log('Feeding the cat');
                                                            catName = row.name
                                                        }
                                                        else {
                                                            catName = 'Mauvais chat';
                                                        }
                                                        db.get("SELECT * FROM nodes WHERE feeder_id = ? AND name = ?", row.id, 'Trappe', (err, row) => {
                                                            if (err) {
                                                                console.error('Error fetching node:', err);
                                                            }
                                                            else {
                                                                const trappeAddress64 = row.address;
                                                                console.log('Trappe address:', trappeAddress64);
                                                                const data = `DEBUTNOM | ${catName} | FINNOM`;
                                                                const frame = {
                                                                    type: C.FRAME_TYPE.ZIGBEE_TRANSMIT_REQUEST,
                                                                    destination64: trappeAddress64,
                                                                    data: data
                                                                };

                                                                try {
                                                                    this.send(frame);
                                                                    console.log('Feed command sent to trappe:', trappeAddress64);
                                                                } catch (error) {
                                                                    console.error('Error sending feed command:', error);
                                                                }
                                                            }
                                                        });
                                                    }
                                                    // else {
                                                    //     console.log('Wrong cat');
                                                    // }
                                                    // }
                                                });
                                            }
                                        }
                                        );

                                    }
                                });
                            } else {
                                // console.log('UID not valid');
                            }
                        } catch (error) {
                            // console.error('Error parsing data:', error);
                        }
                    }
                })
        } else if (C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE === frame.type) {
            // console.log('Remote AT Command Response:', frame);
        }

        else {
            const frameType = Object.keys(C.FRAME_TYPE).find(key => C.FRAME_TYPE[key] === frame.type);
            if (frameType) {
                console.log(`Received ${frameType} frame`);
                console.log(frame);
            } else {
                console.log('Received unknown frame:', frame);
            }
        }
    }

    async sendRemoteATCommand(destination, command, commandParameters, description = '') {
        try {
            // const node = await this.getNodeFromDB(destinationType);
            // if (!node) {
            //     console.error('Node not found:', destination);
            //     return;
            // }
            // const destination64 = node.address;
            // if (!destination64) {
            //     console.error('Node address not found:', destinationType);
            //     return;
            // }

            const remoteATCommand = {
                type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
                destination64: destination,
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

    // async writeNode(nodeType, address64) {
    //     const existingNode = await this.getNodeFromDB(nodeType);
    //     if (existingNode) {
    //         return new Promise((resolve, reject) => {
    //             db.run("UPDATE nodes SET address = ? WHERE name = ?", [address64, nodeType], (err) => {
    //                 if (err) reject(err);
    //                 else resolve();
    //             });
    //         });
    //     } else {
    //         return new Promise((resolve, reject) => {
    //             db.run("INSERT INTO nodes (name, address, feeder_id) VALUES (?, ?, 1)", [nodeType, address64], (err) => {
    //                 if (err) reject(err);
    //                 else resolve();
    //             });
    //         });
    //     }
    // }

    async writeNode(nodeType, address64, maxRetries = 5, delay = 100) {
        const retry = async (operation, retriesLeft) => {
            try {
                return await operation();
            } catch (error) {
                // SQLite busy error code
                if (error.errno === 5 && retriesLeft > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return retry(operation, retriesLeft - 1);
                }
                throw error;
            }
        };

        const existingNode = await this.getNodeFromDB(nodeType);

        if (existingNode) {
            return retry(() => {
                return new Promise((resolve, reject) => {
                    db.run(
                        "UPDATE nodes SET address = ? WHERE name = ?",
                        [address64, nodeType],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }, maxRetries);
        } else {
            return retry(() => {
                return new Promise((resolve, reject) => {
                    db.run(
                        "INSERT INTO nodes (name, address, feeder_id) VALUES (?, ?, 1)",
                        [nodeType, address64],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }, maxRetries);
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
