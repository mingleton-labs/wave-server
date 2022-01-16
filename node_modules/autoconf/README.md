# MQTT Autoconf

## Synopsis

mqtt-autoconf is a tool designed to allow for secure automated provisioning of - presumably, but not necessarily - IoT devices

mqtt-autoconf acts as an MQTT server, with first-class support for MQTT over TLS, allows for flexible detection/fingerprinting of devices, and pushing configuration commands to the devices in response.  

The default module bundled has first-class support for the excellent [Tasmota](https://tasmota.github.io/) project.

## Installation

NPM: `npm install -f autoconf`

Docker: `docker run --init -v /path/to/db:/db issacg/autoconf`

## Examples

Using FileDB and TasmotaClientInfo

This example contains two configured devices using the Sonoff POW module, and configuration of the final TLS-enabled MQTT server, port and credentials to be used once the device is configured.
```json
File: ../db.json

{
    "GLOBAL": {
        "MqttHost": "10.5.3.114",
        "MqttPort": 8883,
        "MqttUser": "tasmota",
        "MqttPassword": "s3cr3t",
        "MqttFingerprint1": "58 F9 F2 CD 1F 4E CE C6 68 3E F6 66 89 A3 03 0C 61 8B A0 2E",
        "OtaUrl": "http://10.5.3.114/tasmota/tasmota.bin",
        "teleperiod": 30
    }, "2C3AE83BB54C": {
        "topic": "WaterHeater",
        "module": 6
    }, "EC4ABC0F8C3A": {
        "topic": "AirConditioner",
        "module": 6
    }
}
```

## Configuration

### Methods
mqtt-autoconf makes use of the excellent [rc](https://github.com/dominictarr/rc) module, so variables can be passed as command line parameters, environment variables or provided via a configuration file named .autoconfrc

For more detailed information about how to set parameters, see the  [rc](https://github.com/dominictarr/rc#standards) page.

### General Options

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| mqtt.port | 1883 | The default port to listen to |
| mqtt.tls_keyfile | None | Path to a PEM-encoded private key file.  Requires also setting mqtt.tls_certfile.  Setting these settings will automatically enable TLS mode (but will not automatically change the port) |
| mqtt.tls_certfile | None | Path to a PEM-encoded x509 certificate (public key) file.  Requires also setting mqtt.tls_keyfile.  Setting these settings will automatically enable TLS mode (but will not automatically change the port) |
| mqtt.tls_passphrase | None | (_Optional_) Passphrase needed to decrypt the private key file specifed by mqtt.tls_keyfile |
| statPrefix | `stat`| The prefix for status responses from end devices |
| cmndPrefix | `cmnd`| The prefix for sending commands to end devices |
| dbDriver.name | `./drivers/PathDB` | Name of the database driver to use.  For drivers that are not built-in, just use the name of the NPM module |
| dbDriver.opts | [See below](#filedb) | Driver-specific options to pass to the database driver |
| clientInfoDriver.name | `./drivers/TasmotaClientInfo` | Name of the device lookup driver to use.  For drivers that are not built-in, just use the name of the NPM module |
| clientInfoDriver.opts | [See below](#tasmotaclientinfo) | Driver-specific options to pass to the device lookup driver |

### Drivers

In order to promote extensibility, mqtt-autoconf uses drivers to abstract detection of end-user devices and to read the configurations to be pushed to detected devices.  Each driver has its own configuration options which are documented below.

#### PathDB

The PathDB driver takes a root path on the filesystem and expects a single file for each device.  The filename should be the name of the detected device, and the filename should end with the extension `.json`.  This is the default-configured database driver.

If there is a file called `GLOBAL.json` (by default - see the `global` configuration option below), that will be added to the configuration to be returned to all devices [IFF](https://simple.wikipedia.org/wiki/If_and_only_if) a device-specific configuration is also found.

The JSON files will be read at run-time, except for the global configuration which will be read once at startup.

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| dbpath | `../db` | (**Required**) Path to a folder on the filesystem containing all configuration files |
| global | `GLOBAL` | (_Optional_) Name of file to treat as global configuration (without the `.json` extension) |

#### FileDB

The FileDB driver expects all device configurations (and an optional global configuration) to be included in a single JSON formatted file.

If there is a section called `GLOBAL` (by default - see the `global` configuration option below), that will be added to the configuration to be returned to all devices [IFF](https://simple.wikipedia.org/wiki/If_and_only_if) a device-specific configuration is also found.

The JSON file will be read once on startup, and currently needs a full restart to pick up changes.

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| dbpath | `../db` | (**Required**) Path of the JSON file to read |
| global | `GLOBAL` | (_Optional_) Name of section to treat as global configuration |

#### TasmotaClientInfo 

The TasmotaClientInfo driver is designed to work with devices with [Tasmota](https://tasmota.github.io/) firmware, and will query the database driver using the MAC address of the device as the database key.  This is the default-congigured device lookup driver.

This driver doesn't accept any additional configuration parameters.

## Rationale

MQTT has been accepted as a popular protocol within the IoT system.  However many popular firmwares require devices to either be configured via custom firmware builds, an embedded insecure webserver on-board the device, proprietary - and often commercial - remote configuration management, or a combination of the above.

In a modern world where small devices on the edge often represent a weak link in network security, all of the above solutions are potentially problematic.

Custom firmware builds require tracking of the upstream project for security patches and rebuilding of firmware when those are available.  However, such builds often introduce significant changes and so, in practice, are often ignored.  This leads to outdated devices at the edge which can, and are, easily targetted as a point of entry when attacking a network or application.  

Many implementations are unable or unwilling to build custom firmware.  This is as true in commercial ecosystems (where the firmware is closed source) as in the do-it-yourself ecosystems (where the firmware is open source, but end-users may not have the technical prowess to build on their own).  As such a very popular configuration option is via an embedded webserver in the device.  To support security, this webserver supports some basic form of authentication.  Unfortunately, TLS-enabled embedded webservers are rarely seen, making such authentication useless, unless on a secured network.  As more edge/IoT devices connect to networks, most networks shouldn't be considered secure - a breach of a single device will allow full access to the network (and often Wi-Fi credentials) and, by extension, all unsecured devices on that network.  

Because of these shortcomings, there are many commercial services available - most notably AWS IoT - which allow for secure remote configuration.  Because TLS-enabled MQTT clients are significantly more popularly available in firmware than TLS-enabled webservers, this is an excellent model from a security standpoint.  However, this is still a proprietary service, and often costs money.

This software aims to allow for an open-source solution to enable run-time  configuration (possibly version-control backed) of end devices with minimal variants of customized firmware.

## License

Copyright 2019 Issac Goldstand <margol@beamartyr.net>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.