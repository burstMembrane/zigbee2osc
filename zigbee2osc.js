/* eslint-disable comma-dangle */
/* eslint-disable quotes */
/* eslint-disable indent */

const osc = require("osc");
const fs = require("fs");
const path = require("path");
const process = require("process");
const fsPromises = fs.promises;

class Zigbee2OSC {
  constructor(
    zigbee,
    mqtt,
    state,
    publishEntityState,
    eventBus,
    settings,
    logger
  ) {
    this.zigbee = zigbee;
    this.mqtt = mqtt;
    this.state = state;
    this.publishEntityState = publishEntityState;
    this.eventBus = eventBus;
    this.settings = settings;
    this.logger = logger;
    this.occupancyTimer = 0;
    this.lastOccupancy;
    this.messageTime;
    this.lastMessageTime;
    this.messageTimes = [];
    this.foundDevice = false;

    logger.info("Zigbee2OSC.init: Loading Zigbee2OSC..");
  }
  async loadConfig(configPath) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        const data = await fsPromises.readFile(configPath);
        const config = JSON.parse(data);
        this.logger.info(
          `Zigbee2OSC.loadConfig: loaded config from ${configPath}`
        );
        this.logger.info(
          `Zigbee2OSC.loadConfig: set occupancy timeout to ${config.timeout}s`
        );
        this.logger.info(
          `Zigbee2OSC.loadConfig: Found ${config.devices.length} in config`
        );

        this.config = config;
        resolve(config);
      } catch (err) {
        this.logger.error(
          `Zigbee2OSC.loadConfig: Error loading config.json ${err}`
        );
        reject(err);
      }
    });
  }
  /**
   * This method is called by the controller once Zigbee has been started.
   */
  async onZigbeeStarted() {
    this.config = await this.loadConfig(
      path.join(process.cwd(), "data/extension/config.json")
    );
    if (this.config.devices) {
      // eslint-disable-next-line guard-for-in
      this.config.devices.forEach((device) => {
        this.logger.info(
          `Zigbee2OSC.loadConfig: Device Name: ${device.friendly_name} ID:  ${device.id}`
        );
      });
    }
    this.oscPort = new osc.UDPPort({
      localAddress: this.config.oscHost,
      localPort: this.config.localPort,
      remoteAddress: this.config.oscHost,
      remotePort: this.config.remotePort,
      broadcast: this.config.broadcast,
    });

    this.oscPort.on("ready", () => {
      this.logger.info(
        `Zigbee2OSC.onZigbeeStarted: Started OSC Server on ${this.config.oscHost}:${this.config.remotePort}`
      );
    });

    this.oscPort.open();

    const oscMessage = {
      address: "/zigbee2osc",
      args: [
        {
          type: "s",
          value: "started",
        },
      ],
    };
    this.oscPort.send(oscMessage);
  }

  /**
   * This method is called by the controller once connected to the MQTT server.
   */
  onMQTTConnected() {}

  /**
   * Is called when a Zigbee message from a device is received.
   * @param {string} type Type of the message
   * @param {Object} data Data of the message
   * @param {Object?} resolvedEntity Resolved entity returned from this.zigbee.resolveEntity()
   * @param {Object?} settingsDevice Device settings
   */
  onZigbeeEvent(type, data, resolvedEntity) {
    this.messageTime = Date.now();

    if (this.lastMessageTime) {
      this.logger.debug(
        `Zigbee2OSC.onZigbeeEvent: time since last message: ${
          this.messageTime - this.lastMessageTime
        }ms`
      );
    }
    this.logger.debug("Zigbee2OSC.onZigbeeEvent:  message received");
    this.sendOscMessage(data, resolvedEntity);
    if (this.config.verbose) {
      // console.dir(data.endpoint.deviceIeeeAddress);
    }
  }
  /**
   * Searches for a match between the devices in the config and the id of the received Zigbee message
   * @param {string} id The id to search for in config.json
   * @return {bool} foundDevice true if device was found, false if device not found
   */
  findDeviceByID(id) {
    this.logger.info(
      `Zigbee2OSC.findDeviceByID: Searching for devices with id:  ${id}`
    );
    let foundDevice = false;
    for (const deviceIndex in this.config.devices) {
      if (this.config.devices[deviceIndex].id == id) {
        this.logger.info(
          `Zigbee2OSC.findDeviceByID: Found device with id:  ${id}`
        );
        foundDevice = true;
      }
    }
    return foundDevice;
  }

  /**
   * Is called when a Zigbee message from a device is received.
   * Currently sends a OSC message when a Zigbee message is received from a xiaomi aqara
   * @param {Object} data Data of the Zigbee message
   * @param {Object?} resolvedEntity Resolved entity returned from this.zigbee.resolveEntity()
   */
  sendOscMessage(data, resolvedEntity) {
    // currently checking for specific values
    // TODO: search through data for specific keys
    // then type check their values and send as osc message
    //  XIAOMI sensor sends messages about every 5 seconds if it is actively viewing movement,
    //  otherwise it doesn't send messages at all.
    // if we havent found the
    if (!this.foundDevice) {
      this.foundDevice = this.findDeviceByID(data.endpoint.deviceIeeeAddress);
    }
    if (
      resolvedEntity.name == "human_body_sensor" ||
      (this.foundDevice && data.data.occupancy !== this.lastOccupancy)
    ) {
      this.occupancyTimer && clearTimeout(this.occupancyTimer);
      const occupancy = data.data.occupancy;
      this.logger.debug(
        `Zigbee2OSC.sendOscMessage: Received occupancy data:  ${occupancy}`
      );

      const oscMessage = {
        address: `/zigbee2osc/${resolvedEntity.name}/occupancy`,
        args: [
          {
            type: occupancy == 1 ? "T" : "F",
            value: occupancy,
          },
        ],
      };
      this.logger.info(
        `Zigbee2OSC.sendOscMessage: Sending OSC Message ${
          oscMessage.address
        } "${occupancy ? true : false}"`
      );

      this.oscPort.send(oscMessage);
      this.lastOccupancy = occupancy;
      this.occupancyTimer = setTimeout(() => {
        const oscMessage = {
          address: `/zigbee2osc/${resolvedEntity.name}/occupancy`,
          args: [
            {
              type: "F",
              value: occupancy,
            },
          ],
        };
        this.logger.info(
          `Zigbee2OSC.sendOscMessage: Sending OSC Message ${oscMessage.address} "false"`
        );
        this.oscPort.send(oscMessage);
      }, this.config.timeout * 1000);
      this.lastMessageTime = Date.now();
    }
  }
  onMQTTMessage(topic, message) {
    // if (topic.includes("zigbee2mqtt")) {
    //   this.logger.info("received human_body_sensor message:");
    //   this.logger.info(topic, message);
    // }
  }

  stop() {
    const oscMessage = {
      address: "/zigbee2osc",
      args: [
        {
          type: "s",
          value: "stopped",
        },
      ],
    };
    this.oscPort.send(oscMessage);
    this.oscPort.close();
    this.logger.info("Zigbee2OSC.stop: Closing OSC Port");
    this.eventBus.removeListenersExtension(this.constructor.name);
  }
}

module.exports = Zigbee2OSC;
