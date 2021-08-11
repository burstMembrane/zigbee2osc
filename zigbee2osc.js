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

    logger.info("Loading Zigbee2OSC..");
  }
  async loadConfig(configPath) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        const data = await fsPromises.readFile(configPath);
        const config = JSON.parse(data);
        this.logger.info(`Zigbee2OSC: loaded config from ${configPath}`);
        // this.logger.info(`Zigbee2OSC: devices ${config.devices.length}`);
        this.config = config;
        resolve(config);
      } catch (err) {
        this.logger.error(`Error loading config.json ${err}`);
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

    this.oscPort = new osc.UDPPort({
      localAddress: this.config.oscHost,
      localPort: this.config.localPort,
      remoteAddress: this.config.oscHost,
      remotePort: this.config.remotePort,
      broadcast: this.config.broadcast,
    });

    this.oscPort.on("ready", () => {
      this.logger.info(
        `Zigbee2OSC: Started OSC Server on ${this.config.oscHost}:${this.config.remotePort}`
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
    this.logger.info("Zigbee2Osc:  message received");
    this.sendOscMessage(data, resolvedEntity);
    if (this.config.verbose) {
      // console.dir(type);
    }
  }

  sendOscMessage(data, resolvedEntity) {
    // currently checking for specific values
    // TODO: search through data for specific keys
    // then type check their values and send as osc message

    if (
      resolvedEntity.name == "human_body_sensor" ||
      data.endpoint.deviceIeeeAddress == this.config.device[0].id
    ) {
      const occupancy = data.data.occupancy;
      this.logger.info(`Received occupancy data:  ${occupancy}`);

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
        `Sending OSC Message ${oscMessage.address} "${
          occupancy ? true : false
        }"`
      );

      this.oscPort.send(oscMessage);
    }
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
    this.eventBus.removeListenersExtension(this.constructor.name);
  }
}

module.exports = Zigbee2OSC;
