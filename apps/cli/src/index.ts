#!/usr/bin/env node

import { printDoctorReport } from "./commands/doctor.ts";
import { printStartHelp, printUsage } from "./commands/help.ts";
import { loadCliEnvFiles } from "./envFiles.ts";

loadCliEnvFiles();

const [, , command = "help"] = process.argv;

switch (command) {
  case "start":
    printStartHelp();
    break;
  case "doctor":
    printDoctorReport();
    break;
  default:
    printUsage();
}
