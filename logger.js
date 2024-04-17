const fs = require("fs");
const path = require("path");

const logFilePath = path.join(__dirname, "app.log");

const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

const originalStdoutWrite = process.stdout.write;

process.stdout.write = function (data, ...args) {
  originalStdoutWrite.apply(process.stdout, [data, ...args]);

  logStream.write(data);
};

module.exports = {
  logStream,
  originalStdoutWrite,
};
