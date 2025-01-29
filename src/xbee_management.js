const SerialPort = require('serialport');
const xbee_api = require('xbee-api');
const dotenv = require('dotenv');
dotenv.config();

const C = xbee_api.constants;
const BROADCAST_ADDRESS = "FFFFFFFFFFFFFFFF";

class XBeeManager {
    constructor() {
        this.serialPort = null;
        this.xbeeAPI = null;
        this.port = process.env.SERIAL_PORT;
        this.baudRate = parseInt(process.env.SERIAL_BAUDRATE) || 9600;
        this.listeners = new Map();

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
        console.log('I received a frame:', frame);
        for (const [type, handler] of this.listeners) {
            if (frame.type === type) {
                try {
                    handler(frame);
                } catch (error) {
                    console.error(`Error in frame handler for type ${type}:`, error);
                }
            }
        }

        // When a remote command response is received :
        if (C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE === frame.type) {
            console.log('Remote Command Response:', frame);
            const nodeIdentifier = frame.commandData.toString();
            this.nodes.push(nodeIdentifier);
        }
        // hen someone joins the network :
        if (C.FRAME_TYPE.NODE_IDENTIFICATION === frame.type) {
            console.log('Node Identification:', frame);
            const nodeIdentifier = frame.nodeIdentifier.toString();
            const address64 = frame.sender64.toString('hex');
            this.nodes.push({
                nodeIdentifier,
                address64
            })
        }
        // I received a frame: {
        // type: 144,
        //     remote64: '0013a20041582fbb',
        //         remote16: '1a47',
        //             receiveOptions: 2,
        //                 data: <Buffer 61 7a 61 61 61 61 61 61 61 61 61 >

        if (C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET === frame.type) { // Type 144
            console.log('Zigbee Receive Packet:', frame);
            const decodedData = frame.data.toString();
            console.log('Decoded Data:', decodedData);
        }


        // type 146

        if (C.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS === frame.type) {
            console.log('Zigbee Transmit Status:', frame);
        }
    }

    send(frame) {
        return new Promise((resolve, reject) => {
            if (!this.xbeeAPI || !this.serialPort) {
                reject(new Error('XBee connection not established'));
                return;
            }

            try {
                console.log('S=========');
                console.log('Sending XBee frame:', frame);
                console.log('S=========');
                this.xbeeAPI.builder.write(frame);
                resolve();
            } catch (error) {
                console.error('Error sending XBee frame:', error);
                reject(error);
            }
        });
    }

    // sendRemoteNIRequest() {
    //     const remoteNIRequest = {
    //         type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    //         destination64: BROADCAST_ADDRESS,
    //         command: "NI",
    //         commandParameter: [],
    //     };
    //     return this.send(remoteNIRequest);
    // }

    addListener(frameType, callback) {
        if (!this.xbeeAPI) {
            throw new Error('XBee connection not established');
        }
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

    // GETTER

    getNodes() {
        return this.nodes;
    }
}

module.exports = XBeeManager;