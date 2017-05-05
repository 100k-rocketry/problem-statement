var fs = require('fs');
var spawn = require('child_process');
var globals = require('./globals');
var pstream = require('./persistentstream');
var spawn = require('child_process');

var panelFd = -1;
var numSustainerErrors = 0;
var numBoosterErrors = 0;
var armed = false;


function tryOpenPanelDevice() {

	console.log("Trying to make connection to panel.");

	if (panelFd !== -1) {
		try {
			fs.closeSync(panelFd);
			panelFd = -1;
		} catch (err) {
			console.log("Error closing panel fd.");
			console.log(err);
		}
	}

	try {
		spawn.spawnSync('/dev/stty', ['-F', globals.panelDeviceName, globals.panelBaud, 'raw']);
		fs.open(globals.panelDeviceName, 'r+', function(err, fd) {
			if (!err) {
				panelFd = fd;
			} else {
				panelFd = -1;
			}
		});
	} catch (err) {
		console.log("Cannot open panel device " + globals.panelDeviceName);
		setTimeout(tryOpenPanelDevice, 1000);
	}
}

tryOpenPanelDevice();

pstream.createPersistentReadStream(globals.panelDeviceName, globals.panelBaud, function(d) {
	var now = (new Date()).getTime();
	var send = false;
	var length = 0;

	for (var i = 0; i < d.length; i++) {
		if (d[i] === 97 || d[i] === 65) {
			var code = "";
			if (d[i] === 97 && armed === true) {
				send = true;
				armed = false;
				// sustainer code on top, booster on bottom
				code = Buffer.from([
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x5A, 0xD2, 0x0B, 0x01, 0x01, 0xD0,
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x01, 0x1B]);
				length = 34;

			} else if (d[i] === 65 && armed === false) {
				send = true;
				armed = true;
				code = Buffer.from([
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x5A, 0xD2, 0x0B, 0x01, 0x02, 0xCF,
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x02, 0x1A]);
						//0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x5A, 0xD2, 0x0B, 0x01, 0x02, 0xCE,
						//0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x5A, 0xD2, 0x0B, 0x01, 0x02, 0xCE,
						//0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x02, 0x1A,
						//0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x02, 0x1A]);


				length = 34;
			}

			try {
				if (send) {
					fs.open(globals.deviceName, 'w', function(err, fd) {
						if (!err) {
							fs.write(fd, code, 0, length, function(err, written, buffer) {
								//console.log("Write callback");
							});
							
							fs.close(fd);
		
						} else {
							console.log(err);
						}

					});
				}
			} catch (err) {
				console.log("Could not send arm code");
				console.log(err);
			}
		}
	}
});


function writeHandler(err, written, buffer) {
	if (err) {
		console.log("Write handler error.");
		console.log(err);
		panelFd = -1;
		tryOpenPanelDevice();
	}
}


function pollArm() {
	try {
		fs.write(panelFd, "arm\n");
	} catch (err) {
		console.log(err);
	}
}

setInterval(pollArm, 500);

module.exports = {
	// Sets the appropriate light to the appropriate state.
	// lightName: scomm, signition, serror, bcomm, bignition, berror, alarm
	// state: on, off
	setLight: function (lightName, state) {
		if (panelFd != -1) {
			try {
				var lightString = lightName + ' ' + state + '\n';
				fs.write(panelFd, lightString, writeHandler);
			} catch (err) {
				console.log("Error in setLight.");
				console.log(err);
				panelFd = -1;
				tryOpenPanelDevice();
			}
		}
	},

	// Sets the text of the line number
	// line number: 1 - 4
	// msg: no longer than 20 characters (or it will wrap to the next line).
	// Automatically pads msg to fill up the line so old characters are erased
	setLine: function (lineNumber, msg) {
		if (panelFd != -1) {
			try {
				msg = ('' + msg).substring(0, 20);
				var stringToSend = 'line' + lineNumber + '="' + msg + ' '.repeat(20 - msg.length) + '\n';
				fs.write(panelFd, stringToSend, writeHandler);
			} catch(err) {
				console.log("Error in setLine.");
				console.log(err);
				panelFd = -1;
				tryOpenPanelDevice();
			}
		}
	},

	addSustainerError: function() {
		numSustainerErrors++;
		if (numSustainerErrors === 1) {
			setLight("serror", "on");
			console.log("Setting error");
		}
	},


	addBoosterError: function() {
		numBoosterErrors++;
		if (numBoosterErrors === 1) {
			setLight("berror", "on");
		}
	},

	removeBoosterError: function() {
		numBoosterErrors--;
		if (numBoosterErrors < 0) {
			console.log("Removed nonexistant error indicator.");
			numBoosterErrors = 0;
		}
		if (numBoosterErrors === 0) {
			setLight("berror", "off");
		}
	},


	removeSustainerError: function() {
		numSustainerErrors--;
		if (numSustainerErrors < 0) {
			console.log("Removed nonexistant error indicator.");
			numSustainerErrors = 0;
		}
		if (numSustainerErrors === 0) {
			setLight("berror", "off");
		}
	},

	addError: function() { console.log("S");addSustainerError(); console.log("B");addBoosterError(); },
	removeError: function() { removeBoosterError(); removeSustainerError(); }
}
